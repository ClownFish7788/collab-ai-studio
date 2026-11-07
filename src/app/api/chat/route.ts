import { MAX_CHAT_REQUEST_BYTES, MAX_IMAGES_PER_MESSAGE, validateImageDataUrl, type MessageContent, type ImagePart, type TextPart } from '@/utils/chat/images'
import { appendChatSnapshot, validateChatSnapshot } from '@/utils/board/snapshot/chatSnapshots'
import type { RegionSnapshot } from '@/agent/adapters/board/tldraw'
import { tldrawPrompt } from '@/prompts/tldrawPrompt'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { traceAgentRequest, type AgentTrace } from '@/lib/agentTraceRequest'
import { observeModelFetch } from '@/lib/modelTrace'
import { CreateAccessError } from '@/agent/adapters/server/access'
import { classifyTraceError } from '@/utils/agent-traces/outcomes'
import type OpenAI from 'openai'
import { createModelClient, ModelRequestError, readModelConfig, requestCompletion } from '@/agent/adapters/model/client'

export const maxDuration = 60

// /api/chat 沿用 src/proxy.ts 的登录校验。
// shortcut: Demo 仅限制单次请求，公开部署前补充用户级共享限流。
export async function POST(request: Request) {
    return traceAgentRequest(request, 'chat', trace => handleChat(request, trace))
}

async function handleChat(request: Request, trace: AgentTrace) {
    const userId = await trace.step('authentication', async () => {
        const session = await getServerSession(authOptions)
        if (!session?.user?.id) throw new CreateAccessError('请先登录后再聊天', 401)
        return session.user.id
    })
    await trace.context({ userId })
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
    } catch (cause) {
        await trace.record('operation_result', { operation: 'request_validation', outcome: 'error', error: classifyTraceError(cause, { operation: 'request_validation' }) })
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
                await trace.record('operation_result', { operation: 'request_validation', outcome: 'error', error: classifyTraceError(error, { operation: 'request_validation' }) })
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
            await trace.record('operation_result', { operation: 'request_validation', outcome: 'error', error: classifyTraceError(error, { operation: 'request_validation' }) })
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

    await trace.record('operation_result', { operation: 'request_validation', outcome: 'success' })
    const config = readModelConfig()
    if (!config) {
        return Response.json({ error: '服务端 AI 接口配置不完整或 MODEL_PROVIDER 不受支持' }, { status: 500 })
    }

    await trace.record('operation_result', { operation: 'configuration', outcome: 'success' })

    const lastContent = messages[messages.length - 1].content
    const prompt = typeof lastContent === 'string' ? lastContent : lastContent.map(part => part.type === 'text' ? part.text : '').filter(Boolean).join('\n')
    await trace.context({ prompt, input: { messages } })
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)])
    const isTimedOut = () => signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    let responseAccepted = false
    const tracedFetch = observeModelFetch(trace.record, fetch, async end => {
        if (!responseAccepted) return
        await trace.end(end.status === 'completed' ? 'completed' : isTimedOut() ? 'timed_out' : end.status,
            end.content, end.status === 'failed' ? '模型响应不完整或返回错误' : undefined)
    })

    try {
        const client = createModelClient(config, signal, tracedFetch)
        const response = await requestCompletion(client, config, {
            messages: modelMessages as OpenAI.ChatCompletionMessageParam[], outputLimit: 1024,
        }, signal)
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
            const error = classifyTraceError({ code: 'INVALID_MODEL_RESPONSE', message: !response.body ? '模型响应体为空' : '模型未返回合法的流式响应' }, { operation: 'model_call' })
            await trace.record('operation_result', { operation: 'model_call', outcome: 'error', error })
            // 告知采集器这是响应拒绝后的清理，而不是用户取消；保留同一错误分类。
            await response.body?.cancel(Object.assign(new Error(error.message), { code: error.code }))
            await trace.end('failed', undefined, error.message)
            return Response.json({ error: error.message }, { status: 502 })
        }
        responseAccepted = true
        return new Response(response.body, {
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            },
        })
    } catch (error) {
        if (error instanceof ModelRequestError && error.httpStatus) {
            const failure = classifyTraceError(error, { operation: 'model_fetch', httpStatus: error.httpStatus })
            await trace.record('operation_result', { operation: 'model_call', outcome: 'error', error: failure })
            await trace.end('failed', undefined, failure.message)
            return Response.json({ error: failure.message }, { status: error.httpStatus === 429 ? 429 : 502 })
        }
        const timedOut = isTimedOut() || error instanceof Error && error.name === 'TimeoutError'
        await trace.end(timedOut ? 'timed_out' : request.signal.aborted ? 'cancelled' : 'failed', undefined,
            timedOut ? '模型响应超时' : request.signal.aborted ? '用户取消请求' : '模型连接失败')
        if (request.signal.aborted) return new Response(null, { status: 499 })
        return Response.json({ error: timedOut ? '模型响应超时，请重试' : '无法连接模型服务，请稍后重试' }, { status: timedOut ? 504 : 502 })
    }
}
