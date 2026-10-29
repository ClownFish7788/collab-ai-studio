import { boardCreateTool, boardUpdateTool, boardDeleteTool, boardSnapshotTool, boardAskTool } from './boardCreateTool'
import {
    validateBoardToolCall,
    BoardProtocolError,
    ERROR_CODES,
    type BoardCreateReply,
    type BoardToolName,
} from '../utils/board/agent/boardCreateProtocol'

/** 只携带本模块生成的安全诊断，不转发上游响应正文或连接配置。 */
export class BoardCreateModelError extends BoardProtocolError {
    constructor(message: string) {
        super({ code: ERROR_CODES.INVALID_MODEL_RESPONSE, message })
    }
}

/** 聚合有界 SSE；文字只用于展示，工具分片直到 DONE/结束原因均有效后才交给调用校验。 */
async function readModelStream(response: Response, signal: AbortSignal, onText?: (text: string) => void) {
    if (!response.body) throw new BoardCreateModelError('模型响应流为空')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = '', text = '', role: string | undefined, finish: string | undefined, done = false
    let call: { id: string; type: string; function: { name: string; arguments: string } } | undefined
    const invalid = () => new BoardCreateModelError('模型流不完整、过大或包含非法分片，本轮没有执行工具')
    const consume = (block: string) => {
        if (block.length > 30000) throw invalid()
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) return
        if (data.trim() === '[DONE]') { done = true; return }
        const value = JSON.parse(data)
        if (value.error || !Array.isArray(value.choices)) throw invalid()
        if (!value.choices.length) return // 部分兼容服务在结尾单独发送 usage。
        if (done || finish || value.choices.length !== 1) throw invalid()
        const choice = value.choices[0], delta = choice.delta
        if (choice.index !== 0 || !delta || typeof delta !== 'object' || delta.refusal != null) throw invalid()
        if (delta.role !== undefined) {
            if (delta.role !== 'assistant') throw invalid()
            role = delta.role
        }
        if (delta.content != null) {
            if (typeof delta.content !== 'string') throw invalid()
            text += delta.content
            if (text.length > 8000) throw invalid()
            if (delta.content) onText?.(delta.content)
        }
        if (delta.tool_calls != null) {
            if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length !== 1) throw invalid()
            const fragment = delta.tool_calls[0]
            if (fragment.index !== 0 || fragment.type !== undefined && fragment.type !== 'function'
                || fragment.id !== undefined && (typeof fragment.id !== 'string' || fragment.id && call?.id && call.id !== fragment.id)) throw invalid()
            call ??= { id: '', type: 'function', function: { name: '', arguments: '' } }
            // 兼容服务在后续分片使用空 ID 占位；真实非空 ID 仍必须保持一致。
            if (fragment.id) call.id = fragment.id
            for (const key of ['name', 'arguments'] as const) {
                const part = fragment.function?.[key]
                if (part === undefined) continue
                if (typeof part !== 'string') throw invalid()
                call.function[key] += part
            }
            if (call.id.length > 200 || call.function.name.length > 100 || call.function.arguments.length > 10000) throw invalid()
        }
        if (choice.finish_reason != null) {
            if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw invalid()
            finish = choice.finish_reason
        }
    }
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
        signal.throwIfAborted()
        while (!done) {
            const chunk = await reader.read()
            signal.throwIfAborted()
            pending = (pending + decoder.decode(chunk.value, { stream: !chunk.done })).replace(/\r\n/g, '\n')
            let end: number
            while ((end = pending.indexOf('\n\n')) !== -1) {
                consume(pending.slice(0, end))
                pending = pending.slice(end + 2)
            }
            if (pending.length > 30000) throw invalid()
            if (chunk.done) { if (pending.trim()) consume(pending); break }
        }
        if (!done || !finish || role !== 'assistant') throw invalid()
        return { choices: [{ finish_reason: finish, message: { role, content: text, ...(call ? { tool_calls: [call] } : {}) } }] }
    } finally {
        signal.removeEventListener('abort', cancel)
        await reader.cancel().catch(() => {})
    }
}

/**
 * 后端只构造模型消息，不访问前端 Editor。
 * 输入任务历史、模型配置、停止信号和本轮开放工具名；只返回白名单内的一次完整调用或普通文本。
 */
export async function requestBoardCreateModel(
    messages: readonly object[],
    config: { apiKey: string; model: string; baseUrl: string },
    signal: AbortSignal,
    allowedTools: readonly BoardToolName[],
    fetcher: typeof fetch = fetch,
    onText?: (text: string) => void,
): Promise<BoardCreateReply> {
    const response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
            model: config.model,
            // 用户回答不会建立画布参照点；每轮明确运行状态，避免模型沿用前轮工具或跳过读取。
            messages: [...messages, { role: 'system', content: allowedTools.length
                ? `本轮仅允许这些工具：${allowedTools.join('、')}。其他工具即使出现在历史也不能调用。本任务尚未执行任何写入，读取快照和回答不表示操作完成，历史任务的成功也不算本任务的执行。若当前用户操作已明确且信息齐全，必须实际调用对应写入工具，不能用 content 声称已新增、更新或删除。${allowedTools.includes('get_board_snapshot') && !allowedTools.includes('create_shapes')
                    ? '当前尚未取得首份白板快照，用户回答不等于快照。继续白板操作前必须先调用 get_board_snapshot；禁止直接写入。' : ''}${allowedTools.includes('ask_user')
                    ? '已明确的白板任务若缺少必要信息或有多个候选，必须真正调用 ask_user 等待答案；不能仅在 content 中写问题并结束。用户按描述指定更新或删除目标，而该范围快照 truncated=true 时，即使只返回一个匹配项也不能确认唯一，必须先询问用户是否操作这个已读取对象；用户已明确指定真实 ID 或已明确选定目标时例外。这是继续当前任务的协议要求。' : ''}`
                : '本轮未开放工具。仅用普通文字回复，若已有草稿执行结果则说明实际结果，不再调用工具。' }],
            ...(allowedTools.length ? {
                tools: [boardCreateTool, boardUpdateTool, boardDeleteTool, boardSnapshotTool, boardAskTool].filter(tool => allowedTools.includes(tool.function.name)),
            } : {}),
            tool_choice: allowedTools.length ? 'auto' : 'none',
            parallel_tool_calls: false,
            stream: true,
            enable_thinking: false,
            max_tokens: 1000,
        }),
        signal,
    })

    if (!response.ok) {
        await response.body?.cancel()
        throw new BoardCreateModelError(`模型服务请求失败（HTTP ${response.status}）`)
    }

    let data
    try {
        data = response.headers.get('content-type')?.includes('text/event-stream')
            ? await readModelStream(response, signal, onText) : await response.json()
    } catch {
        signal.throwIfAborted()
        throw new BoardCreateModelError('模型服务未返回完整合法响应，本轮没有执行工具')
    }
    const choice = data?.choices?.[0]
    const message = choice?.message

    if (!data || data.error != null || !Array.isArray(data.choices) || data.choices.length !== 1
        || !message || message.role !== 'assistant' || message.refusal != null
        || !['stop', 'tool_calls'].includes(choice.finish_reason)
        || message.tool_calls != null && !Array.isArray(message.tool_calls)) {
        throw new BoardCreateModelError('模型响应不完整、被拒绝或格式不合法，本轮没有执行工具')
    }
    if (choice.finish_reason === 'tool_calls') {
        if (!allowedTools.length || message.tool_calls?.length !== 1
            || message.content != null && (typeof message.content !== 'string' || message.content.length > 8000)) {
            throw new BoardCreateModelError('每轮只允许一个已开放的完整工具调用')
        }

        try {
            const raw = message.tool_calls[0]
            // 兼容服务可能附带 index 等传输元数据，只把协议允许的字段交给前端。
            const call = validateBoardToolCall({
                id: raw.id,
                type: raw.type,
                function: { name: raw.function?.name, arguments: raw.function?.arguments },
            })

            if (!allowedTools.includes(call.function.name)) throw new Error('工具未开放')
            return { kind: 'tool', call, ...(typeof message.content === 'string' ? { content: message.content } : {}) }
        } catch {
            throw new BoardCreateModelError('模型返回的白板工具调用格式不合法或未开放')
        }
    }
    if (message.tool_calls?.length || typeof message.content !== 'string'
        || !message.content.trim() || message.content.length > 8000) {
        throw new BoardCreateModelError('模型没有返回有效内容')
    }

    return { kind: 'text', text: message.content }
}
