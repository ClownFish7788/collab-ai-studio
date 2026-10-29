import 'server-only'
import prisma from './prisma'
import { serializeTraceData, type TraceRecorder } from './modelTrace'

/** Commit each step before continuing; logging failures never fail the user's AI task. */
export async function startAgentTrace(input: {
    id?: string; kind: 'chat' | 'board'; userId?: string; roomId?: string; model: string; prompt: string; input: unknown
}) {
    const started = Date.now()
    let id: string | undefined
    let sequence = 0
    try {
        const saved = await prisma.agentTrace.create({ data: {
            ...input, prompt: JSON.parse(serializeTraceData(input.prompt)), input: serializeTraceData(input.input),
        } })
        id = saved.id
    } catch { console.error('AI trace could not be created; check trace database setup') }

    const record: TraceRecorder = async (type, data, durationMs) => {
        if (!id) return
        try {
            await prisma.agentTraceEvent.create({ data: { traceId: id, sequence: sequence++, type, data: serializeTraceData(data), durationMs } })
        } catch { console.error('AI trace event could not be saved') }
    }
    return {
        record,
        async end(status: 'completed' | 'failed' | 'cancelled' | 'timed_out', reply?: string, error?: string) {
            if (!id) return
            try {
                await prisma.agentTrace.update({ where: { id }, data: {
                    status, reply: reply === undefined ? undefined : JSON.parse(serializeTraceData(reply)),
                    error: error === undefined ? undefined : JSON.parse(serializeTraceData(error)), durationMs: Date.now() - started,
                } })
            } catch { console.error('AI trace completion could not be saved') }
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
