import { boardCreateTool, boardUpdateTool, boardDeleteTool, boardSnapshotTool, boardAskTool } from './boardCreateTool'
import {
    validateBoardToolCall,
    BoardProtocolError,
    ERROR_CODES,
    type BoardCreateReply,
    type BoardToolName,
} from '../utils/boardCreateProtocol'

/** 只携带本模块生成的安全诊断，不转发上游响应正文或连接配置。 */
export class BoardCreateModelError extends BoardProtocolError {
    constructor(message: string) {
        super({ code: ERROR_CODES.INVALID_MODEL_RESPONSE, message })
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
                    ? '已明确的白板任务若缺少必要信息或有多个候选，必须真正调用 ask_user 等待答案；不能仅在 content 中写问题并结束。这是继续当前任务的协议要求。' : ''}`
                : '本次工具阶段已结束。仅用普通文字说明实际结果，不再调用任何工具。' }],
            ...(allowedTools.length ? {
                tools: [boardCreateTool, boardUpdateTool, boardDeleteTool, boardSnapshotTool, boardAskTool].filter(tool => allowedTools.includes(tool.function.name)),
            } : {}),
            tool_choice: allowedTools.length ? 'auto' : 'none',
            parallel_tool_calls: false,
            stream: false,
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
        data = await response.json()
    } catch {
        throw new BoardCreateModelError('模型服务未返回合法 JSON')
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
