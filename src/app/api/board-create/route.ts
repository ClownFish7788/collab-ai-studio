import { CreateAccessError, readCreatePayload, requireCreateAccess, requireCreateUser } from '@/agent/adapters/server/access'
import { createChatCompletionsModel } from '@/agent/adapters/model/chatCompletions'
import { readModelConfig } from '@/agent/adapters/model/client'
import type { ModelPort } from '@/agent/application/ports'
import { boardToolContractSet } from "../../../agent/adapters/board/contracts"
import { runBoardAgent } from '@/agent/adapters/server/runBoardAgent'
import { beginCreateRun } from '@/agent/adapters/server/browserExecutor'
import { BoardProtocolError } from '../../../agent/adapters/transport/errors'
import { ERROR_CODES, validateBoardCreateRequest, type BoardAgentError, type BoardCreateEvent } from '../../../agent/adapters/transport/boardProtocol'
import { MAX_CHAT_REQUEST_BYTES } from '@/utils/chat/images'
import { traceAgentRequest, type AgentTrace } from '@/lib/agentTraceRequest'
import { classifyTraceError } from '@/utils/agent-traces/outcomes'
import { observeModelFetch } from '@/lib/modelTrace'

export const maxDuration = 180

// shortcut: Demo 进程内限流，多实例公开部署前使用共享限流存储。
const windows = new Map<string, { start: number; count: number }>()

/** 启动一次后端 Agent 循环；响应流保持到完成、出错、取消或任务总超时。 */
export async function POST(request: Request) {
    return traceAgentRequest(request, 'board', trace => handleBoardCreate(request, trace))
}

async function handleBoardCreate(request: Request, trace: AgentTrace) {
    let run: ReturnType<typeof beginCreateRun> | undefined

    try {
        const userId = await trace.step('authentication', requireCreateUser)
        await trace.context({ userId })
        let payload: ReturnType<typeof validateBoardCreateRequest>

        try {
            payload = await trace.step('request_validation', async () => validateBoardCreateRequest(await readCreatePayload(request, MAX_CHAT_REQUEST_BYTES)))
        } catch {
            return Response.json({ error: '白板请求或文字历史不合法，不能提交工具调用或结果' }, { status: 400 })
        }

        await trace.context({ roomId: payload.roomId, prompt: payload.prompt, input: payload })
        await trace.step('access', () => requireCreateAccess(payload.roomId, userId))
        const now = Date.now()

        for (const [id, window] of windows) {
            if (now - window.start >= 60000) windows.delete(id)
        }

        const window = windows.get(userId) ?? { start: now, count: 0 }
        if (window.count >= 6) {
            return Response.json({ error: '白板任务过于频繁，请稍后再试' }, { status: 429 })
        }

        const config = readModelConfig()
        if (!config) {
            return Response.json({ error: '服务端 AI 接口配置不完整或 MODEL_PROVIDER 不受支持' }, { status: 500 })
        }

        await trace.record('operation_result', { operation: 'rate_limit', outcome: 'success' })
        await trace.record('operation_result', { operation: 'configuration', outcome: 'success' })

        run = await trace.step('run_start', () => beginCreateRun(userId, payload.roomId, request.signal, trace.id))
        window.count++
        windows.set(userId, window)

        const tracedFetch = observeModelFetch(trace.record)

        const activeRun = run
        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
            async start(controller) {
                let finalReply: string | undefined
                const emit = (event: BoardCreateEvent) => {
                    if (event.type === 'completed') finalReply = event.text
                    controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
                }
                const adapter = createChatCompletionsModel({
                    config, contracts: boardToolContractSet, fetcher: tracedFetch, record: trace.record,
                    onPreview(source, delta, start) {
                        activeRun.signal.throwIfAborted()
                        emit({ type: 'preview', runId: activeRun.id, source, delta, start })
                    }
                })
                const modelPort: ModelPort = {
                    prepare: adapter.prepare,
                    next: (context, allowedTools, signal) => trace.step('model_call', () => adapter.next(context, allowedTools, signal)),
                }

                try {
                    await runBoardAgent(
                        activeRun,
                        payload,
                        modelPort,
                        emit,
                        () => trace.step('access', () => requireCreateAccess(payload.roomId, userId)),
                        15000,
                        trace.record,
                    )
                    await trace.end('completed', finalReply)
                } catch (cause) {
                    const error: BoardAgentError = activeRun.signal.aborted
                        ? { code: ERROR_CODES.TASK_INACTIVE, message: '任务已取消或超时，已完成的内容仅保留在草稿中' }
                        : cause instanceof BoardProtocolError ? cause.detail
                            : cause instanceof CreateAccessError ? { code: ERROR_CODES.ACCESS_DENIED, message: cause.message }
                                : { code: ERROR_CODES.TASK_FAILED, message: '后端白板任务失败，已完成的内容仅保留在草稿中' }

                    const timedOut = activeRun.signal.reason instanceof Error && activeRun.signal.reason.name === 'TimeoutError' || cause instanceof Error && cause.name === 'TimeoutError'
                    await trace.record('run_error', { ...error, failure: classifyTraceError(cause, { operation: 'run', signal: activeRun.signal, httpStatus: cause instanceof CreateAccessError ? cause.status : undefined }) })
                    await trace.end(timedOut ? 'timed_out' : activeRun.signal.aborted ? 'cancelled' : 'failed', finalReply, error.message)
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
