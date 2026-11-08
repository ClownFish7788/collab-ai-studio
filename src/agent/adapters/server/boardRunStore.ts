import { Prisma, type PrismaClient } from '@prisma/client'
import { isEqual } from '@tldraw/utils'
import { toolOutputMatchesCall, validateBoardToolCall, validateBoardToolOutput, type BoardToolCall } from '../transport/boardProtocol'

export class BoardChannelConflict extends Error {
    readonly status = 409
}

export class BoardChannelStorageError extends Error {
    readonly status = 503
    readonly category = 'storage'
    readonly code = 'BOARD_CHANNEL_STORAGE'
    constructor(cause: unknown) { super('白板任务存储暂时不可用，请稍后重试', { cause }) }
}

/** Shared by independent requests; never store callbacks or resumable model history here. */
export function createBoardRunStore(client: PrismaClient, provider: 'sqlite' | 'postgres') {
    const clock = async (tx: Prisma.TransactionClient) => {
        const rows = provider === 'postgres'
            ? await tx.$queryRaw<{ ms: bigint }[]>`SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS ms`
            : await tx.$queryRaw<{ ms: bigint }[]>`SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) AS ms`
        return new Date(Number(rows[0].ms))
    }
    const transaction = async <T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
        for (let attempt = 0; ; attempt++) {
            try {
                return await client.$transaction(async tx => {
                    if (provider === 'postgres') await tx.$queryRaw`SELECT set_config('statement_timeout', '2000', true)`
                    return action(tx)
                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 1000, timeout: 3000 })
            } catch (cause) {
                if (cause instanceof BoardChannelConflict) throw cause
                if (cause instanceof Prisma.PrismaClientKnownRequestError) {
                    if (cause.code === 'P2034' && attempt < 2) continue
                    if (cause.code === 'P2002') throw new BoardChannelConflict('已有运行中的白板任务或重复的工具调用')
                }
                throw new BoardChannelStorageError(cause)
            }
        }
    }
    const active = async (tx: Prisma.TransactionClient, id: string, ownerId?: string) => {
        const run = await tx.boardAgentRun.findUnique({ where: { id } })
        const now = await clock(tx)
        if (!run || run.expiresAt <= now || ownerId !== undefined && run.ownerId !== ownerId) {
            throw new BoardChannelConflict('任务已结束、已过期或不属于当前用户')
        }
        return { run, now }
    }
    return {
        begin: (id: string, ownerId: string, roomId: string, timeoutMs: number) => transaction(async tx => {
            const now = await clock(tx)
            await tx.boardAgentRun.deleteMany({ where: { ownerId, expiresAt: { lte: now } } })
            return tx.boardAgentRun.create({ data: { id, ownerId, roomId, createdAt: now, expiresAt: new Date(+now + timeoutMs) } })
        }),
        owned: (id: string, ownerId: string) => transaction(async tx => (await active(tx, id, ownerId)).run),
        register: (runId: string, value: BoardToolCall, waitMs: number) => transaction(async tx => {
            const call = validateBoardToolCall(value)
            const { run, now } = await active(tx, runId)
            return tx.boardAgentToolCall.create({ data: { runId, callId: call.id, callJson: JSON.stringify(call),
                deadlineAt: new Date(Math.min(+run.expiresAt, +now + waitMs)) } })
        }),
        submit: async (runId: string, ownerId: string, callId: string, value: unknown) => {
            // Validate untrusted data outside the transaction; only channel conflicts/storage errors enter it.
            const output = validateBoardToolOutput(value)
            return transaction(async tx => {
                await active(tx, runId, ownerId)
                const call = await tx.boardAgentToolCall.findUnique({ where: { runId_callId: { runId, callId } } })
                if (!call || !toolOutputMatchesCall(validateBoardToolCall(JSON.parse(call.callJson)), output)) {
                    throw new BoardChannelConflict('当前任务没有等待这个工具结果')
                }
                if (call.outputJson !== null) {
                    if (!isEqual(JSON.parse(call.outputJson), output)) throw new BoardChannelConflict('工具结果已提交，不能替换')
                    return
                }
                const { now } = await active(tx, runId, ownerId)
                if (call.deadlineAt <= now) throw new BoardChannelConflict('工具调用已超时')
                const changed = await tx.boardAgentToolCall.updateMany({
                    where: { runId, callId, outputJson: null, deadlineAt: { gt: now } },
                    data: { outputJson: JSON.stringify(output), receivedAt: now },
                })
                if (changed.count !== 1) throw new BoardChannelConflict('工具结果已提交或调用已失效')
            })
        },
        read: (runId: string, callId: string) => transaction(async tx => {
            const { now } = await active(tx, runId)
            const call = await tx.boardAgentToolCall.findUnique({ where: { runId_callId: { runId, callId } } })
            if (!call) throw new BoardChannelConflict('工具调用已失效')
            return { now, deadlineAt: call.deadlineAt, output: call.outputJson === null ? undefined : validateBoardToolOutput(JSON.parse(call.outputJson)) }
        }),
        release: (id: string) => transaction(tx => tx.boardAgentRun.deleteMany({ where: { id } })),
        prune: () => transaction(async tx => {
            const now = await clock(tx)
            const rows = await tx.boardAgentRun.findMany({ where: { expiresAt: { lte: now } }, orderBy: { expiresAt: 'asc' }, take: 10, select: { id: true } })
            await tx.boardAgentRun.deleteMany({ where: { id: { in: rows.map(row => row.id) }, expiresAt: { lte: now } } })
        }),
    }
}
