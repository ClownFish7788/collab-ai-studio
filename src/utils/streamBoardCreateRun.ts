import {
    validateBoardCreateEvent,
    validateCreateOutput,
    type BoardCreateRequest,
    type CreateToolCall,
    type CreateToolOutput,
} from './boardCreateProtocol'

export type CreateAgentStep = {
    stage: 'request' | 'call' | 'result' | 'summary'
    message: string
    data?: CreateToolCall | CreateToolOutput
}

/**
 * 前端传输层：启动一次后端任务、读取事件、执行本地工具并提交结果。
 * 不维护模型消息历史，不发起下一轮推理；何时继续/结束全部由后端流决定。
 */
export async function streamBoardCreateRun(
    request: BoardCreateRequest,
    signal: AbortSignal,
    execute: (call: CreateToolCall) => CreateToolOutput,
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
            throw new Error(error?.error ?? '后端新增任务请求失败')
        }

        return response
    }

    try {
        const response = await post('/api/board-create', request)
        if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
            throw new Error('后端未返回任务事件流')
        }

        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        let runId = ''
        let localOutput: CreateToolOutput | undefined

        while (true) {
            const chunk = await reader.read()
            transportSignal.throwIfAborted()
            pending += decoder.decode(chunk.value, { stream: !chunk.done })
            if (pending.length > 30000) throw new Error('任务事件过大')

            let newline: number
            while ((newline = pending.indexOf('\n')) !== -1) {
                const line = pending.slice(0, newline)
                pending = pending.slice(newline + 1)
                if (!line.trim()) continue

                const event = validateBoardCreateEvent(JSON.parse(line))
                transportSignal.throwIfAborted()

                if (event.type === 'started') {
                    if (runId) {
                        throw new Error('后端任务 ID 不合法')
                    }

                    runId = event.runId
                    onStep({ stage: 'request', message: '① 后端已启动 Agent，正在调用模型' })
                    continue
                }

                if (!runId || event.runId !== runId) throw new Error('收到其他任务的事件')
                if (event.type === 'error') throw new Error(event.error.message)

                if (event.type === 'tool') {
                    if (localOutput) throw new Error('收到重复的写工具事件，已停止执行')

                    const call = event.call
                    onStep({ stage: 'call', message: '② 后端请求 create_shapes，浏览器执行草稿新增', data: call })
                    const output = validateCreateOutput(execute(call))
                    localOutput = output
                    onStep({ stage: 'result', message: '③ 提交真实结果，等待后端继续循环', data: output })
                    await post(`/api/board-create/${runId}/result`, { callId: call.id, output })
                    continue
                }

                if (event.type === 'completed') {
                    const output = event.output
                    if (localOutput ? !localOutput.ok || !output
                        || localOutput.shapes.length !== output.shapes.length
                        || localOutput.shapes.some((shape, index) =>
                            (Object.keys(shape) as (keyof typeof shape)[]).some(key => shape[key] !== output.shapes[index][key]))
                        : output !== undefined) {
                        throw new Error('后端完成结果与本地实际执行结果不一致')
                    }

                    onStep({ stage: 'summary', message: output ? '④ 后端已结束循环，等待用户确认' : '后端已结束循环，本轮未执行白板操作' })
                    return { text: event.text, output }
                }

                throw new Error('未知任务事件')
            }

            if (chunk.done) throw new Error('任务连接中断，已完成的内容保留在草稿中')
        }
    } finally {
        controller.abort()
        await reader?.cancel().catch(() => {})
    }
}
