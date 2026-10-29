import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source'
import { MAX_CHAT_REQUEST_BYTES, type MessageContent } from './images'
import type { RegionSnapshot } from '../board/snapshot/collectRegionSnapshot'
import { reportAgentOperation } from '../agent-traces/client'

export async function streamChat(
    messages: { role: 'user' | 'assistant'; content: MessageContent; snapshot?: RegionSnapshot }[],
    signal: AbortSignal,
    onDelta: (delta: string) => void,
) {
    signal.throwIfAborted()
    const body = JSON.stringify({ messages })
    if (new Blob([body]).size > MAX_CHAT_REQUEST_BYTES) throw new Error('本次对话附件过多，请减少附件或清空聊天后重试')
    let done = false
    let receivedText = false
    let traceId: string | undefined
    const began = Date.now()
    try {
        await fetchEventSource('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal,
            // 防止切换标签页后重发整个生成请求。
            openWhenHidden: true,
            async onopen(response) {
                traceId = response.headers.get('X-Agent-Trace-Id') ?? undefined
                if (response.status === 401) throw Object.assign(new Error('请先登录后再聊天'), { code: 'HTTP_401' })
                if (!response.ok) {
                    const data = await response.json().catch(() => null)
                    throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : '请求失败，请稍后重试'), { code: `HTTP_${response.status}` })
                }
                if (!response.headers.get('content-type')?.includes(EventStreamContentType)) {
                    throw new Error('模型未返回流式响应')
                }
            },
            onmessage(event) {
                if (signal.aborted || !event.data.trim()) return
                if (event.data === '[DONE]') {
                    done = true
                    return
                }
                const data = JSON.parse(event.data)
                if (data.error) throw Object.assign(new Error('模型返回错误，请稍后重试'), { code: 'INVALID_MODEL_RESPONSE' })
                const text = data.choices?.[0]?.delta?.content
                if (typeof text === 'string' && text) {
                    receivedText = true
                    onDelta(text)
                }
            },
            onclose() {
                if (!done) throw new Error('连接意外中断，请重新发送')
            },
            onerror(error) {
                // 生成请求不自动重试，避免重复回复和重复计费。
                throw error
            },
        })
        if (!signal.aborted && !receivedText) throw new Error('模型没有返回文本，请重试')
        void reportAgentOperation(traceId, 'stream_receive', signal.aborted ? 'cancelled' : 'success', undefined, Date.now() - began)
    } catch (cause) {
        void reportAgentOperation(traceId, 'stream_receive', signal.aborted ? 'cancelled' : 'error', cause, Date.now() - began)
        throw cause
    }
}
