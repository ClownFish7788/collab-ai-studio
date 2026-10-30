import { isEqual } from '@tldraw/utils'
import { MAX_CHAT_REQUEST_BYTES } from '../../chat/images'
import {
    validateBoardCreateEvent,
    validateBoardToolOutput,
    toolOutputMatchesCall,
    type BoardCreateRequest,
    type BoardToolCall,
    type BoardToolOutput,
    type MutationToolSuccess,
} from './boardCreateProtocol'

export type CreateAgentStep = {
    stage: 'request' | 'plan' | 'call' | 'result' | 'summary' | 'text'
    message: string
    data?: BoardToolCall | BoardToolOutput
}

/**
 * 前端传输层：启动一次后端任务、读取事件、执行本地工具并提交结果。
 * 询问工具可异步等待真实用户回答；继续前再次检查停止信号，读取/回答不计作草稿写入。
 * 不维护模型消息历史，不发起下一轮推理；何时继续/结束全部由后端流决定。
 */
export async function streamBoardCreateRun(
    request: BoardCreateRequest,
    signal: AbortSignal,
    execute: (call: BoardToolCall) => BoardToolOutput | Promise<BoardToolOutput>,
    onStep: (step: CreateAgentStep) => void,
    fetcher: typeof fetch = fetch,
) {
    const controller = new AbortController()
    const transportSignal = AbortSignal.any([signal, controller.signal])
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    const post = async (url: string, body: object) => {
        transportSignal.throwIfAborted()
        const response = await fetcher(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: transportSignal,
        })
        transportSignal.throwIfAborted()

        if (!response.ok) {
            const error = await response.json().catch(() => null)
            throw new Error(error?.error ?? '后端白板任务请求失败')
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
        let runId = ''
        let localOutput: MutationToolSuccess | undefined
        const callIds = new Set<string>()
        let reads = 0
        let asks = 0
        let textLength = 0

        while (true) {
            const chunk = await reader.read()
            transportSignal.throwIfAborted()
            pending += decoder.decode(chunk.value, { stream: !chunk.done })

            let newline: number
            while ((newline = pending.indexOf('\n')) !== -1) {
                const line = pending.slice(0, newline)
                pending = pending.slice(newline + 1)
                if (!line.trim()) continue
                if (line.length > 30000) throw new Error('任务事件过大')

                const event = validateBoardCreateEvent(JSON.parse(line))
                transportSignal.throwIfAborted()

                if (event.type === 'started') {
                    if (runId) {
                        throw new Error('后端任务 ID 不合法')
                    }

                    runId = event.runId
                    onStep({ stage: 'request', message: '正在分析并拆分需求…' })
                    continue
                }

                if (!runId || event.runId !== runId) throw new Error('收到其他任务的事件')
                if (event.type === 'error') throw new Error([
                    event.error.message,
                    ...(event.error.issues ?? []).map(issue => `${issue.path}：${issue.message}`),
                ].join('\n'))
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
                    if (localOutput || callIds.has(event.call.id)) throw new Error('收到重复或已结束的工具事件，已停止执行')

                    const call = event.call
                    if (call.function.name === 'get_board_snapshot' && ++reads > 2
                        || call.function.name === 'ask_user' && ++asks > 1) throw new Error('工具调用预算已用尽')
                    callIds.add(call.id)
                    onStep({ stage: 'call', message: `后端请求 ${call.function.name}`, data: call })
                    const output = validateBoardToolOutput(await execute(call))
                    transportSignal.throwIfAborted()
                    if (!toolOutputMatchesCall(call, output)) throw new Error('浏览器工具结果与调用不匹配')
                    if (output.ok) {
                        if ('shapes' in output || 'ids' in output) localOutput = output
                    }
                    onStep({ stage: 'result', message: '提交真实结果，等待后端继续循环', data: output })
                    await post(`/api/board-create/${runId}/result`, { callId: call.id, output })
                    continue
                }

                if (event.type === 'completed') {
                    const output = event.output
                    if (!isEqual(localOutput, output)) {
                        throw new Error('后端完成结果与本地实际执行结果不一致')
                    }

                    onStep({ stage: 'summary', message: output ? '④ 后端已结束循环，等待用户确认' : '后端已结束循环，本轮未执行白板操作' })
                    return { text: event.text, output }
                }

                throw new Error('未知任务事件')
            }

            if (pending.length > 30000) throw new Error('任务事件过大')
            if (chunk.done) throw new Error('任务连接中断，已完成的内容保留在草稿中')
        }
    } finally {
        controller.abort()
        await reader?.cancel().catch(() => {})
    }
}
