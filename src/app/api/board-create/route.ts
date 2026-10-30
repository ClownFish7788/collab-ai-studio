import { CreateAccessError, readCreatePayload, requireCreateAccess, requireCreateUser } from '@/lib/boardCreateAccess'
import { requestBoardCreateModel, requestBoardTaskBrief } from '@/lib/boardCreateModel'
import { beginCreateRun, runCreateLoop } from '@/lib/boardCreateRun'
import { BoardProtocolError, ERROR_CODES, validateBoardCreateRequest, type BoardAgentError, type BoardCreateEvent } from '@/utils/board/agent/boardCreateProtocol'
import { MAX_CHAT_REQUEST_BYTES } from '@/utils/chat/images'

export const maxDuration = 60

// shortcut: Demo 进程内限流，多实例公开部署前使用共享限流存储。
const windows = new Map<string, { start: number; count: number }>()

/** 启动一次后端 Agent 循环；整个响应流一直保持到完成、出错、取消或 55 秒总超时。 */
export async function POST(request: Request) {
    let run: ReturnType<typeof beginCreateRun> | undefined

    try {
        const userId = await requireCreateUser()
        let payload: ReturnType<typeof validateBoardCreateRequest>

        try {
            payload = validateBoardCreateRequest(await readCreatePayload(request, MAX_CHAT_REQUEST_BYTES))
        } catch {
            return Response.json({ error: '白板请求或文字历史不合法，不能提交工具调用或结果' }, { status: 400 })
        }

        await requireCreateAccess(payload.roomId, userId)
        const now = Date.now()

        for (const [id, window] of windows) {
            if (now - window.start >= 60000) windows.delete(id)
        }

        const window = windows.get(userId) ?? { start: now, count: 0 }
        if (window.count >= 6) {
            return Response.json({ error: '白板任务过于频繁，请稍后再试' }, { status: 429 })
        }

        const apiKey = process.env.API_KEY?.trim()
        const model = process.env.BASE_MODEL?.trim()
        const baseUrl = process.env.BASE_URL?.trim()

        if (!apiKey || !model || !baseUrl) {
            return Response.json({ error: '服务端尚未配置 AI 接口' }, { status: 500 })
        }

        run = beginCreateRun(userId, payload.roomId, request.signal)
        window.count++
        windows.set(userId, window)

        const activeRun = run
        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
            async start(controller) {
                const emit = (event: BoardCreateEvent) => {
                    controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
                }

                try {
                    await runCreateLoop(
                        activeRun,
                        payload,
                        (messages, allowTools) => requestBoardCreateModel(
                            messages, { apiKey, model, baseUrl }, activeRun.signal, allowTools, fetch,
                            text => emit({ type: 'text', runId: activeRun.id, text }),
                        ),
                        emit,
                        () => requireCreateAccess(payload.roomId, userId),
                        messages => requestBoardTaskBrief(messages, { apiKey, model, baseUrl }, activeRun.signal),
                    )
                } catch (cause) {
                    const error: BoardAgentError = activeRun.signal.aborted
                        ? { code: ERROR_CODES.TASK_INACTIVE, message: '任务已取消或超时，已完成的内容仅保留在草稿中' }
                        : cause instanceof BoardProtocolError ? cause.detail
                            : cause instanceof CreateAccessError ? { code: ERROR_CODES.ACCESS_DENIED, message: cause.message }
                                : { code: ERROR_CODES.TASK_FAILED, message: '后端白板任务失败，已完成的内容仅保留在草稿中' }

                    try { emit({ type: 'error', runId: activeRun.id, error }) } catch { /* 连接已关闭。 */ }
                } finally {
                    try { controller.close() } catch { /* 浏览器已取消响应流。 */ }
                }
            },
            cancel() {
                activeRun.controller.abort(new Error('浏览器已断开任务连接'))
            },
        })

        return new Response(body, {
            headers: {
                'Content-Type': 'application/x-ndjson; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            },
        })
    } catch (cause) {
        run?.controller.abort()
        if (cause instanceof CreateAccessError) {
            return Response.json({ error: cause.message }, { status: cause.status })
        }

        return Response.json({ error: '无法启动白板任务，请检查是否已有任务在运行' }, { status: 409 })
    }
}
