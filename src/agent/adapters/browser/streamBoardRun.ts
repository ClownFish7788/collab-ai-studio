import { isEqual } from '@tldraw/utils'
import { MAX_CHAT_REQUEST_BYTES } from '../../../utils/chat/images'
import { reportAgentOperation } from '../../../utils/agent-traces/client'
import { MAX_BOARD_TOOL_ARGUMENT_CHARS, MAX_BOARD_WRITES_PER_TASK } from '../../../utils/board/boardCapabilities'
import { formatBoardJsonPreview } from '../presentation/jsonPreview'
import { validateBoardCreateEvent, validateBoardToolOutput, toolOutputMatchesCall, ERROR_CODES, type BoardCreateRequest, type BoardToolCall, type BoardToolOutput, type BoardMutationResult } from '../transport/boardProtocol'
import { BoardProtocolError } from '../transport/errors'

const MAX_EVENT_CHARS = 30000 * MAX_BOARD_WRITES_PER_TASK

export type CreateAgentStep = {
    stage: 'request' | 'plan' | 'preview' | 'call' | 'result' | 'summary' | 'text'
    message: string
    data?: BoardToolCall | BoardToolOutput
    runId?: string
}

/**
 * 前端传输层：启动一次后端任务、读取事件、执行本地工具并提交结果。
 * 询问工具可异步等待真实用户回答；继续前再次检查停止信号，读取/回答不计作草稿写入。
 * 不维护模型消息历史，不发起下一轮推理；何时继续/结束全部由后端流决定。
 */
export async function streamBoardRun(
    request: BoardCreateRequest,
    signal: AbortSignal,
    execute: (call: BoardToolCall) => BoardToolOutput | Promise<BoardToolOutput>,
    onStep: (step: CreateAgentStep) => void,
    fetcher: typeof fetch = fetch,
) {
    const controller = new AbortController()
    const transportSignal = AbortSignal.any([signal, controller.signal])
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let traceId: string | undefined
    let runId = ''
    const began = Date.now()
    const inFlight = new Set<Promise<void>>()
    let executionFailure: unknown

    const post = async (url: string, body: object) => {
        transportSignal.throwIfAborted()
        const response = await fetcher(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: transportSignal,
        })
        traceId ??= response.headers.get('X-Agent-Trace-Id') ?? undefined
        transportSignal.throwIfAborted()

        if (!response.ok) {
            const error = await response.json().catch(() => null)
            throw Object.assign(new Error(error?.error ?? '后端白板任务请求失败'), { code: `HTTP_${response.status}` })
        }

        return response
    }

    try {
        if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_CHAT_REQUEST_BYTES) throw new Error('对话附件过多，请减少附件')
        const response = await post('/api/board-create', request)
        if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
            throw new Error('后端未返回任务事件流')
        }

        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        const localResults: BoardMutationResult[] = []
        const callIds = new Set<string>()
        let reads = 0
        let screenshots = 0
        let asks = 0
        let textLength = 0
        let previewSource = ''
        let previewJson = ''
        let previewLength = 0

        while (true) {
            const chunk = await reader.read()
            transportSignal.throwIfAborted()
            pending += decoder.decode(chunk.value, { stream: !chunk.done })

            let newline: number
            while ((newline = pending.indexOf('\n')) !== -1) {
                const line = pending.slice(0, newline)
                pending = pending.slice(newline + 1)
                if (!line.trim()) continue
                if (line.length > MAX_EVENT_CHARS) throw new Error('任务事件过大')

                const event = validateBoardCreateEvent(JSON.parse(line))
                transportSignal.throwIfAborted()

                if (event.type === 'started') {
                    if (runId) {
                        throw new Error('后端任务 ID 不合法')
                    }

                    runId = event.runId
                    if (traceId && traceId !== runId) throw new Error('任务 ID 与响应标识不一致')
                    traceId = runId
                    onStep({ stage: 'request', runId, message: '正在分析并拆分需求…' })
                    continue
                }

                if (!runId || event.runId !== runId) throw new Error('收到其他任务的事件')
                if (event.type === 'preview') {
                    if (event.start) { previewSource = event.source; previewJson = '' }
                    if (previewSource !== event.source) throw new Error('生成预览缺少起始事件')
                    previewJson += event.delta
                    previewLength += event.delta.length
                    if (previewJson.length > (event.source === 'preparation' ? 8000 : MAX_BOARD_TOOL_ARGUMENT_CHARS)
                        || previewLength > 8000 + 6 * MAX_BOARD_TOOL_ARGUMENT_CHARS) throw new Error('生成预览超过上限')
                    onStep({ stage: 'preview', message: formatBoardJsonPreview(event.source, previewJson) })
                    continue
                }
                if (event.type === 'error') {
                    const error = new BoardProtocolError(event.error)
                    error.message = [event.error.message, ...(event.error.issues ?? []).map(issue => `${issue.path}：${issue.message}`)].join('\n')
                    throw error
                }
                if (event.type === 'plan') {
                    onStep({ stage: 'plan', message: event.text })
                    continue
                }
                if (event.type === 'text') {
                    textLength += event.text.length
                    if (textLength > 48000) throw new Error('任务文字超过上限')
                    onStep({ stage: 'text', message: event.text })
                    continue
                }

                if (event.type === 'tool') {
                    if (callIds.has(event.call.id)) throw new Error('收到重复工具事件，已停止执行')

                    const call = event.call
                    if (['create_shapes', 'update_shapes', 'delete_shapes'].includes(call.function.name)
                        && localResults.length >= MAX_BOARD_WRITES_PER_TASK) throw new Error('工具写入预算已用尽')
                    if (call.function.name === 'get_board_snapshot' && ++reads > 2
                        || call.function.name === 'get_board_screenshot' && ++screenshots > 2
                        || call.function.name === 'ask_user' && ++asks > 1) throw new Error('工具调用预算已用尽')
                    callIds.add(call.id)
                    onStep({ stage: 'call', message: `后端请求 ${call.function.name}`, data: call })
                    const task = (async () => {
                        const toolStarted = Date.now()
                        let output: BoardToolOutput
                        let executionError: unknown
                        try { output = validateBoardToolOutput(await execute(call)) } catch (cause) {
                            if (transportSignal.aborted) {
                                void reportAgentOperation(traceId, 'tool_execute', 'cancelled', cause, Date.now() - toolStarted, fetcher)
                                throw cause
                            }
                            executionError = cause
                            output = { ok: false, error: { code: ERROR_CODES.EXECUTION_FAILED, message: cause instanceof Error ? cause.message.slice(0, 1000) : '浏览器工具执行异常' } }
                        }
                        void reportAgentOperation(traceId, 'tool_execute', output.ok ? 'success' : 'error', executionError ?? (!output.ok ? new BoardProtocolError(output.error) : undefined), Date.now() - toolStarted, fetcher)
                        transportSignal.throwIfAborted()
                        if (!toolOutputMatchesCall(call, output)) throw new Error('浏览器工具结果与调用不匹配')
                        if (output.ok) {
                            if ('shapes' in output || 'ids' in output) localResults.push({ callId: call.id, output })
                        }
                        onStep({ stage: 'result', message: '提交真实结果，等待后端确认', data: output })
                        const submitStarted = Date.now()
                        try {
                            await post(`/api/board-create/${runId}/result`, { callId: call.id, output })
                            void reportAgentOperation(traceId, 'result_submit', 'success', undefined, Date.now() - submitStarted, fetcher)
                        } catch (cause) {
                            void reportAgentOperation(traceId, 'result_submit', transportSignal.aborted ? 'cancelled' : 'error', cause, Date.now() - submitStarted, fetcher)
                            throw cause
                        }
                    })().catch(cause => { executionFailure ??= cause; controller.abort(cause) })
                    inFlight.add(task)
                    void task.finally(() => inFlight.delete(task))
                    continue
                }

                if (event.type === 'completed') {
                    await Promise.allSettled([...inFlight])
                    if (executionFailure) throw executionFailure
                    const results = event.results
                    if (!isEqual(localResults, results)) {
                        throw new Error('后端完成结果与本地实际执行结果不一致')
                    }

                    onStep({ stage: 'summary', message: results.length ? '草稿修改完成，等待用户确认' : '本轮未执行白板操作' })
                    void reportAgentOperation(traceId, 'stream_receive', 'success', undefined, Date.now() - began, fetcher)
                    return { text: event.text, results, runId }
                }

                throw new Error('未知任务事件')
            }

            if (pending.length > MAX_EVENT_CHARS) throw new Error('任务事件过大')
            if (chunk.done) throw new Error('任务连接中断，已完成的内容保留在草稿中')
        }
    } catch (cause) {
        void reportAgentOperation(traceId, 'stream_receive', transportSignal.aborted ? 'cancelled' : 'error', cause, Date.now() - began, fetcher)
        throw cause
    } finally {
        controller.abort()
        await reader?.cancel().catch(() => {})
        await Promise.allSettled([...inFlight])
    }
}
