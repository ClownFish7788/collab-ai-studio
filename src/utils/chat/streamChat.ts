import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source'
import { MAX_CHAT_REQUEST_BYTES, type MessageContent } from './images'
import type { RegionSnapshot } from '../board/snapshot/collectRegionSnapshot'

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
    await fetchEventSource('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal,
        // 防止切换标签页后重发整个生成请求。
        openWhenHidden: true,
        async onopen(response) {
            if (response.status === 401) throw new Error('请先登录后再聊天')
            if (!response.ok) {
                const data = await response.json().catch(() => null)
                throw new Error(typeof data?.error === 'string' ? data.error : '请求失败，请稍后重试')
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
            if (data.error) throw new Error('模型返回错误，请稍后重试')
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
}
