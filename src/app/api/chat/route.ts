export const maxDuration = 60

// /api/chat 沿用 src/proxy.ts 的登录校验。
// shortcut: Demo 仅限制单次请求，公开部署前补充用户级共享限流。
export async function POST(request: Request) {
    let payload: unknown
    try {
        const body = await request.text()
        if (body.length > 64000) return Response.json({ error: '对话过长，请清空后重试' }, { status: 400 })
        payload = JSON.parse(body)
    } catch {
        return Response.json({ error: '请求格式错误' }, { status: 400 })
    }

    if (!payload || typeof payload !== 'object' || !('messages' in payload)
        || !Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 40) {
        return Response.json({ error: '请提供 1～40 条聊天消息' }, { status: 400 })
    }

    const messages: { role: 'user' | 'assistant'; content: string }[] = []
    for (const message of payload.messages) {
        if (!message || typeof message !== 'object'
            || (message.role !== 'user' && message.role !== 'assistant')
            || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 4000) {
            return Response.json({ error: '消息角色或内容不合法，每条消息最多 4000 字' }, { status: 400 })
        }
        messages.push({ role: message.role, content: message.content })
    }
    if (messages[messages.length - 1].role !== 'user') {
        return Response.json({ error: '最后一条消息必须是用户消息' }, { status: 400 })
    }

    const apiKey = process.env.API_KEY?.trim()
    const model = process.env.BASE_MODEL?.trim()
    const baseUrl = process.env.BASE_URL?.trim()
    if (!apiKey || !model || !baseUrl) {
        return Response.json({ error: '服务端尚未配置 AI 接口' }, { status: 500 })
    }

    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages, stream: true, enable_thinking: false, max_tokens: 1024 }),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
        })
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
            await response.body?.cancel()
            return Response.json({ error: `模型服务请求失败（HTTP ${response.status}）` }, { status: response.status === 429 ? 429 : 502 })
        }
        return new Response(response.body, {
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            },
        })
    } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499 })
        const timedOut = error instanceof Error && error.name === 'TimeoutError'
        return Response.json({ error: timedOut ? '模型响应超时，请重试' : '无法连接模型服务，请稍后重试' }, { status: timedOut ? 504 : 502 })
    }
}
