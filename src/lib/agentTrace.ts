import 'server-only'
import prisma from './prisma'
import { serializeTraceData, type TraceRecorder } from './modelTrace'
import { classifyTraceError, eventOutcome, type TraceFailure } from '../utils/agent-traces/outcomes'
import { serializeTraceWithImages } from './traceImages'

export class ClientTraceLimitError extends Error {}

function storageFailure(operation: string, cause: unknown, traceId?: string) {
    // 数据库故障不能递归写回同一数据库；使用同一分类协议回退到结构化服务端日志。
    console.error(serializeTraceData({ type: 'trace_storage_error', operation, traceId, outcome: 'error', error: classifyTraceError(cause, { operation: 'storage' }) }))
}

export async function appendAgentTraceEvent(traceId: string, type: string, data: unknown, durationMs?: number, source = 'server') {
    const { failure, ...result } = eventOutcome(type, data)
    const payload = failure && data && typeof data === 'object' ? { ...data, failure } : data
    const serialized = source === 'client' ? serializeTraceData(payload) : await serializeTraceWithImages(traceId, payload)
    return prisma.$transaction(async tx => {
        // 先锁定并增加任务序号，避免浏览器埋点与模型循环并发写入相同序号。
        const row = await tx.agentTrace.update({ where: { id: traceId }, data: { lastSequence: { increment: 1 } }, select: { lastSequence: true } })
        if (source === 'client' && await tx.agentTraceEvent.count({ where: { traceId, source: 'client' } }) >= 32) throw new ClientTraceLimitError('浏览器记录数量已达上限')
        return tx.agentTraceEvent.create({ data: { traceId, sequence: row.lastSequence, type, source, ...result, data: serialized, durationMs } })
    })
}

/** Commit each step before continuing; logging failures never fail the user's AI task. */
export async function startAgentTrace(input: {
    id?: string; kind: 'chat' | 'board'; userId?: string; roomId?: string; model: string; prompt: string; input: unknown
}) {
    const started = Date.now()
    let id: string | undefined
    let failure: TraceFailure | undefined
    let endedStatus: string | undefined
    try {
        const saved = await prisma.agentTrace.create({ data: {
            ...input, prompt: JSON.parse(serializeTraceData(input.prompt)), input: serializeTraceData(input.input),
        } })
        id = saved.id
        const capturedInput = await serializeTraceWithImages(saved.id, input.input)
        if (capturedInput !== saved.input) await prisma.agentTrace.update({ where: { id }, data: { input: capturedInput } })
    } catch (cause) { storageFailure('trace_create', cause, input.id) }

    const record: TraceRecorder = async (type, data, durationMs) => {
        failure = eventOutcome(type, data).failure ?? failure
        if (!id) return
        try {
            await appendAgentTraceEvent(id, type, data, durationMs)
        } catch (cause) { storageFailure('trace_event', cause, id) }
    }
    return {
        id: id ?? input.id ?? crypto.randomUUID(),
        get failure() { return failure },
        record,
        async context(data: { userId?: string; roomId?: string; prompt?: string; input?: unknown }) {
            if (!id) return
            try {
                const { input, prompt, ...fields } = data
                await prisma.agentTrace.update({ where: { id }, data: { ...fields,
                    ...(prompt === undefined ? {} : { prompt: JSON.parse(serializeTraceData(prompt)) }),
                    ...(input === undefined ? {} : { input: await serializeTraceWithImages(id, input) }),
                } })
            } catch (cause) { storageFailure('trace_context', cause, id) }
        },
        async step<T>(operation: string, action: () => T | Promise<T>): Promise<T> {
            const began = Date.now()
            try {
                const result = await action()
                await record('operation_result', { operation, outcome: 'success' }, Date.now() - began)
                return result
            } catch (cause) {
                const error = classifyTraceError(cause, { operation })
                await record('operation_result', { operation, outcome: error.category === 'cancelled' ? 'cancelled' : 'error', error }, Date.now() - began)
                throw cause
            }
        },
        async end(status: 'completed' | 'failed' | 'cancelled' | 'timed_out', reply?: string, error?: string) {
            if (!id) return
            // 传输层和请求层可能共同处理同一失败；第一个明确终态是唯一的任务结论。
            if (endedStatus !== undefined) return
            endedStatus = status
            try {
                await prisma.agentTrace.update({ where: { id }, data: {
                    status, reply: reply === undefined ? undefined : JSON.parse(serializeTraceData(reply)),
                    error: error === undefined ? undefined : JSON.parse(serializeTraceData(error)), durationMs: Date.now() - started,
                } })
                await record('run_result', { status, outcome: status === 'completed' ? 'success' : status === 'cancelled' ? 'cancelled' : 'error',
                    ...(status === 'completed' ? {} : { error: status === 'timed_out' || status === 'cancelled'
                        ? classifyTraceError({ name: status === 'timed_out' ? 'TimeoutError' : 'AbortError', message: error ?? status }, { operation: 'run' })
                        : failure ?? classifyTraceError({ message: error ?? '任务失败' }, { operation: 'run' }) }),
                    reply, message: error,
                }, Date.now() - started)
            } catch (cause) { storageFailure('trace_completion', cause, id) }
        },
    }
}

// One shared password uses a shared DB budget, so changing instances cannot bypass throttling.
export async function consumeAdminLoginAttempt(now = Date.now()) {
    const windowMs = 10 * 60 * 1000
    const start = Math.floor(now / windowMs) * windowMs
    await prisma.traceAdminLogin.deleteMany({ where: { expiresAt: { lte: new Date(now) } } })
    const window = await prisma.traceAdminLogin.upsert({
        where: { id: String(start) },
        create: { id: String(start), expiresAt: new Date(start + windowMs) },
        update: { attempts: { increment: 1 } },
    })
    return window.attempts <= 20
}
