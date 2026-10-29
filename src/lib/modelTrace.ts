import { classifyTraceError, type TraceFailure } from '../utils/agent-traces/outcomes'

export type TraceRecorder = (type: string, data: unknown, durationMs?: number) => Promise<void>
export type ModelEnd = { status: 'completed' | 'failed' | 'cancelled'; content: string; error?: TraceFailure | null }

const MAX_TEXT = 64 * 1024

function sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
        let text = value.replace(/data:image\/([a-z0-9.+-]+);base64,[a-z0-9+/=]+/gi,
            (_, type: string) => `[image omitted: image/${type}]`)
            .replace(/\bBearer\s+[a-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
            .replace(/((?:https?|postgres(?:ql)?|mysql|rediss?):\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1[redacted]@')
            .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
        for (const secret of [process.env.API_KEY, process.env.ADMIN_TRACE_PASSWORD, process.env.AUTH_GITHUB_SECRET, process.env.NEXTAUTH_SECRET]) {
            if (secret && secret.length >= 4) {
                text = text.split(secret).join('[redacted]')
                if (secret.trim().length >= 4) text = text.split(secret.trim()).join('[redacted]')
            }
        }
        return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n[truncated]' : text
    }
    if (Array.isArray(value)) return value.map(sanitize)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        /^(authorization|cookie|api[-_]?key|password|access_token|refresh_token|secret)$/i.test(key) ? '[redacted]' : sanitize(item),
    ]))
    return value
}

/** Never pass request headers/config here; only model payloads and validated tool data belong in traces. */
export function serializeTraceData(value: unknown) {
    const json = JSON.stringify(sanitize(value)) ?? 'null'
    return json.length <= 1024 * 1024 ? json : JSON.stringify({ truncated: true, preview: json.slice(0, 1024 * 1024) })
}

// shortcut: 每字段最多 65536 字符、每帧 131072 字符；完整大响应评测需要改用受控对象存储。
class ModelCollector {
    private decoder = new TextDecoder()
    private pending = ''
    private content = ''
    private reasoning = ''
    private calls = new Map<number, { id: string; function: { name: string; arguments: string } }>()
    private usage: unknown = null
    private error = false
    private failure: TraceFailure | undefined
    private done = false
    private dropping = false
    private truncated = false

    constructor(private sse: boolean) {}

    push(chunk?: Uint8Array) {
        this.pending += this.decoder.decode(chunk, { stream: !!chunk })
        if (this.sse) {
            this.pending = this.pending.replace(/\r\n/g, '\n')
            let end: number
            while ((end = this.pending.indexOf('\n\n')) !== -1) {
                if (!this.dropping && end <= 128 * 1024) this.consume(this.pending.slice(0, end))
                else this.truncated = true
                this.dropping = false
                this.pending = this.pending.slice(end + 2)
            }
        }
        if (this.pending.length > 128 * 1024) {
            this.truncated = true
            this.dropping = true
            this.pending = this.pending.slice(-3)
        }
    }

    private consume(block: string) {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) return
        if (data.trim() === '[DONE]') { this.done = true; return }
        try { this.consumeValue(JSON.parse(data)) } catch (cause) {
            this.error = true
            this.failure = { ...classifyTraceError(cause, { operation: 'model_response' }), code: 'MODEL_JSON_INVALID' }
        }
    }

    private consumeValue(value: unknown) {
        if (!value || typeof value !== 'object') { this.error = true; return }
        if ('error' in value && value.error) {
            this.error = true
            const detail = typeof value.error === 'object' ? value.error as { code?: unknown; message?: unknown } : {}
            this.failure = { category: 'model', code: typeof detail.code === 'string' ? detail.code.slice(0, 100) : 'MODEL_PROVIDER_ERROR',
                message: typeof detail.message === 'string' ? detail.message.slice(0, 2000) : typeof value.error === 'string' ? value.error.slice(0, 2000) : '模型服务返回错误' }
        }
        if ('usage' in value && value.usage) this.usage = value.usage
        const choice = 'choices' in value && Array.isArray(value.choices) ? value.choices[0] : undefined
        if (!choice) return
        const delta = choice.delta ?? choice.message
        if (!delta || typeof delta !== 'object') return
        const append = (current: string, part: string) => {
            if (current.length + part.length > MAX_TEXT) this.truncated = true
            return (current + part).slice(0, MAX_TEXT)
        }
        if (typeof delta.content === 'string') this.content = append(this.content, delta.content)
        const reasoning = delta.reasoning_content ?? delta.reasoning
        if (typeof reasoning === 'string') this.reasoning = append(this.reasoning, reasoning)
        if (Array.isArray(delta.tool_calls)) for (const [position, part] of delta.tool_calls.entries()) {
            if (!part || typeof part !== 'object') continue
            const index = typeof part.index === 'number' ? part.index : position
            if (!Number.isInteger(index) || index < 0 || index > 16) continue
            const call = this.calls.get(index) ?? { id: '', function: { name: '', arguments: '' } }
            if (typeof part.id === 'string' && part.id) call.id = part.id.slice(0, 200)
            for (const key of ['name', 'arguments'] as const) {
                if (typeof part.function?.[key] === 'string') call.function[key] = append(call.function[key], part.function[key])
            }
            this.calls.set(index, call)
        }
        if (choice.finish_reason && !['stop', 'tool_calls'].includes(choice.finish_reason)) this.error = true
    }

    finish(cancelled: boolean) {
        this.push()
        if (this.pending.trim() && !this.dropping) {
            if (this.sse) this.consume(this.pending)
            else try { this.consumeValue(JSON.parse(this.pending)); this.done = !this.error } catch (cause) {
                this.error = true
                this.failure = { ...classifyTraceError(cause, { operation: 'model_response' }), code: 'MODEL_JSON_INVALID' }
            }
        }
        const valid = this.done && !this.error && (!!this.content.trim() || this.calls.size > 0)
        return {
            status: valid ? 'completed' as const : this.error ? 'failed' as const : cancelled ? 'cancelled' as const : 'failed' as const,
            content: this.content, reasoning: this.reasoning || null, toolCalls: [...this.calls.values()],
            usage: this.usage, truncated: this.truncated,
            // 模型适配器拒绝错误帧后也会 cancel reader；清理动作不能覆盖已经取得的错误证据。
            error: valid ? null : this.failure ?? (cancelled && !this.error ? classifyTraceError({ name: 'AbortError', message: '模型响应流已取消' }, { operation: 'model_fetch' })
                : { category: 'model' as const, code: this.done ? 'MODEL_RESPONSE_INVALID' : 'MODEL_STREAM_INCOMPLETE', message: this.done ? '模型未返回可用响应' : '模型响应未完整结束' }),
        }
    }
}

/** Observe the actual model body, preserving response bytes/backpressure and recording cancellation in the same stream. */
export function observeModelFetch(record: TraceRecorder, fetcher: typeof fetch = fetch, onEnd?: (end: ModelEnd) => Promise<void>): typeof fetch {
    const save: TraceRecorder = async (...args) => {
        try { await record(...args) } catch (cause) { console.error(serializeTraceData({ type: 'trace_observer_error', outcome: 'error', error: classifyTraceError(cause, { operation: 'storage' }) })) }
    }
    return async (input, init) => {
        const requestId = crypto.randomUUID()
        const started = Date.now()
        let payload: unknown = null
        try { if (typeof init?.body === 'string') payload = JSON.parse(init.body) } catch { /* No raw body fallback: it may contain credentials. */ }
        await save('model_request', { requestId, request: payload })
        let response: Response
        try { response = await fetcher(input, init) } catch (cause) {
            await save('model_error', { requestId, error: classifyTraceError(cause, { operation: 'model_fetch', signal: init?.signal ?? undefined }) }, Date.now() - started)
            throw cause
        }
        if (!response.ok || !response.body) {
            await save('model_error', { requestId, httpStatus: response.status,
                error: response.ok ? { category: 'model', code: 'MODEL_BODY_EMPTY', message: '模型响应体为空' } : classifyTraceError(undefined, { operation: 'model_fetch', httpStatus: response.status }) }, Date.now() - started)
            return response
        }
        const reader = response.body.getReader()
        const collector = new ModelCollector(!!response.headers.get('content-type')?.includes('text/event-stream'))
        let cancelled = false
        let finishing: Promise<void> | undefined
        const finish = (cancelled: boolean, cause?: unknown) => finishing ??= (async () => {
            const summary = collector.finish(cancelled)
            if (summary.status !== 'completed' && (cause || init?.signal?.aborted)) summary.error = classifyTraceError(cause ?? init?.signal?.reason, { operation: 'model_fetch', signal: init?.signal ?? undefined })
            if (summary.status !== 'completed' && init?.signal?.aborted) summary.status = 'cancelled'
            await save('model_response', { requestId, ...summary }, Date.now() - started)
            try { await onEnd?.(summary) } catch (cause) { console.error(serializeTraceData({ type: 'trace_completion_error', outcome: 'error', error: classifyTraceError(cause, { operation: 'storage' }) })) }
        })()
        return new Response(new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const chunk = await reader.read()
                    if (chunk.done) { await finish(cancelled); controller.close() }
                    else { collector.push(chunk.value); controller.enqueue(chunk.value) }
                } catch (cause) {
                    await finish(cancelled || !!init?.signal?.aborted, cause)
                    controller.error(cause)
                }
            },
            async cancel(reason) {
                // cancel() 会把正在预读的 read() 唤醒为 done，必须先标记取消，避免抢先写成失败。
                cancelled = true
                try { await reader.cancel(reason) } finally { await finish(true) }
            },
        }), { status: response.status, statusText: response.statusText, headers: response.headers })
    }
}
