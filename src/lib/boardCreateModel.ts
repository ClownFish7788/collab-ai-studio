import { boardCreateTool } from './boardCreateTool'
import {
    validateCreateCall,
    type BoardCreateReply,
} from '../utils/boardCreateProtocol'

/** 只携带本模块生成的安全诊断，不转发上游响应正文或连接配置。 */
export class BoardCreateModelError extends Error {}

/**
 * 后端只构造模型消息，不访问前端 Editor。
 * 输入后端循环持有的历史、模型配置、停止信号及是否开放工具；输出一次模型响应。
 */
export async function requestBoardCreateModel(
    messages: readonly object[],
    config: { apiKey: string; model: string; baseUrl: string },
    signal: AbortSignal,
    allowTools: boolean,
    fetcher: typeof fetch = fetch,
): Promise<BoardCreateReply> {
    const response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
            model: config.model,
            messages,
            tools: [boardCreateTool],
            tool_choice: allowTools ? 'auto' : 'none',
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

    const data = await response.json()
    const choice = data?.choices?.[0]
    const message = choice?.message

    if (!message || choice.finish_reason === 'length') {
        throw new BoardCreateModelError('模型响应不完整，本轮没有执行工具')
    }
    if (message.tool_calls?.length) {
        if (!allowTools || message.tool_calls.length !== 1) {
            throw new BoardCreateModelError('最小闭环每次只允许一次新增工具调用')
        }

        try {
            const raw = message.tool_calls[0]
            // 兼容服务可能附带 index 等传输元数据，只把协议允许的字段交给前端。
            const call = validateCreateCall({
                id: raw.id,
                type: raw.type,
                function: { name: raw.function?.name, arguments: raw.function?.arguments },
            })

            return { kind: 'tool', call }
        } catch {
            throw new BoardCreateModelError('模型返回的新增工具调用格式不合法')
        }
    }
    if (typeof message.content !== 'string' || !message.content.trim() || message.content.length > 8000) {
        throw new BoardCreateModelError('模型没有返回有效内容')
    }

    return { kind: 'text', text: message.content }
}
