import { MAX_CHAT_REQUEST_BYTES, MAX_IMAGES_PER_MESSAGE, validateImageDataUrl, type MessageContent, type ImagePart, type TextPart } from '@/utils/images'
import { appendChatSnapshot, validateChatSnapshot } from '@/utils/chatSnapshots'
import type { RegionSnapshot } from '@/utils/collectRegionSnapshot'
import { tldrawPrompt } from '@/prompts/tldrawPrompt'

export const maxDuration = 60

// /api/chat 沿用 src/proxy.ts 的登录校验。
// shortcut: Demo 仅限制单次请求，公开部署前补充用户级共享限流。
export async function POST(request: Request) {
    let payload: unknown
    try {
        const reader = request.body?.getReader()
        if (!reader) return Response.json({ error: '请求不能为空' }, { status: 400 })
        const decoder = new TextDecoder()
        let body = '', size = 0
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            // 这里只保护请求体占用；图片数量和原始大小在下面逐张校验。
            size += value.byteLength
            if (size > MAX_CHAT_REQUEST_BYTES) {
                await reader.cancel()
                return Response.json({ error: '对话附件过多，请清空后重试' }, { status: 413 })
            }
            body += decoder.decode(value, { stream: true })
        }
        body += decoder.decode()
        payload = JSON.parse(body)
    } catch {
        return Response.json({ error: '请求格式错误' }, { status: 400 })
    }

    if (!payload || typeof payload !== 'object' || !('messages' in payload)
        || !Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 40) {
        return Response.json({ error: '请提供 1～40 条聊天消息' }, { status: 400 })
    }

    const messages: { role: 'user' | 'assistant'; content: MessageContent; snapshot?: RegionSnapshot }[] = []
    for (const message of payload.messages) {
        if (!message || typeof message !== 'object'
            || (message.role !== 'user' && message.role !== 'assistant')) {
            return Response.json({ error: '消息角色不合法' }, { status: 400 })
        }
        let snapshot: RegionSnapshot | undefined
        if (message.snapshot !== undefined) {
            try {
                if (message.role !== 'user') throw new Error('只有用户消息可以附加白板快照')
                validateChatSnapshot(message.snapshot)
                snapshot = message.snapshot
            } catch (error) {
                return Response.json({ error: error instanceof Error ? error.message : '白板快照不合法' }, { status: 400 })
            }
        }
        if (typeof message.content === 'string') {
            if ((!message.content.trim() && !snapshot?.shapes.length) || message.content.length > 4000) {
                return Response.json({ error: '每条消息须包含 1～4000 字' }, { status: 400 })
            }
            messages.push({ role: message.role, content: message.content, snapshot })
            continue
        }
        if (message.role !== 'user' || !Array.isArray(message.content) || !message.content.length) {
            return Response.json({ error: '用户消息须包含文字或图片' }, { status: 400 })
        }
        const images: ImagePart[] = [], texts: TextPart[] = []
        let textLength = 0
        try {
            for (const part of message.content) {
                if (part?.type === 'image_url') {
                    if (images.length >= MAX_IMAGES_PER_MESSAGE) throw new Error('每条消息最多上传 3 张图片')
                    const url = part.image_url?.url
                    validateImageDataUrl(url)
                    images.push({ type: 'image_url', image_url: { url } })
                } else if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
                    textLength += part.text.length
                    if (textLength > 4000) throw new Error('每条消息最多 4000 字')
                    texts.push({ type: 'text', text: part.text })
                } else {
                    throw new Error('消息只能包含文字和 Base64 图片')
                }
            }
        } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : '图片消息不合法' }, { status: 400 })
        }
        messages.push({ role: message.role, content: [...images, ...texts], snapshot })
    }
    if (messages[messages.length - 1].role !== 'user') {
        return Response.json({ error: '最后一条消息必须是用户消息' }, { status: 400 })
    }
    const modelMessages = [
        ...(messages.some(message => message.snapshot?.shapes.length) ? [{ role: 'system', content: tldrawPrompt }] : []),
        ...messages.map(({ role, content, snapshot }) => ({
            role,
            content: snapshot?.shapes.length ? appendChatSnapshot(content, snapshot) : content,
        })),
    ]

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
            body: JSON.stringify({ model, messages: modelMessages, stream: true, enable_thinking: false, max_tokens: 1024 }),
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
