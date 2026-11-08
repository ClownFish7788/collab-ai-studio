import { setTimeout as delay } from 'node:timers/promises'
import prisma from '@/lib/prisma'
import { createBoardRunStore } from './boardRunStore'
import { serializeTraceData } from '../../../lib/modelTrace'
import { BOARD_RUN_TIMEOUT_MS, BOARD_ANSWER_TIMEOUT_MS, type ToolExecutorPort } from '../../application/ports'
import type { AgentError } from '../../domain/error'
import { toAgentToolResult, toBoardToolCall } from '../board/protocol'
import { toolOutputMatchesCall, validateBoardToolCall, type BoardCreateEvent, type BoardToolCall, type BoardToolOutput } from '../transport/boardProtocol'
import { validateCreateInput, validateUpdateInput, validateDeleteInput, parseSnapshotInput, parseAskInput } from '../board/nativeValidation'
import type { TraceRecorder } from '../../../lib/modelTrace'
import { classifyTraceError } from '../../../utils/agent-traces/outcomes'

export type CreateRun = {
    id: string
    ownerId: string
    roomId: string
    signal: AbortSignal
    controller: AbortController
}

// Both development and production use the same channel; only SQL clock syntax differs.
const store = createBoardRunStore(prisma, process.env.NODE_ENV === 'production' ? 'postgres' : 'sqlite')

export async function beginCreateRun(ownerId: string, roomId: string, signal: AbortSignal, id = crypto.randomUUID()): Promise<CreateRun> {
    signal.throwIfAborted()
    await store.begin(id, ownerId, roomId, BOARD_RUN_TIMEOUT_MS)
    const controller = new AbortController()
    const run = { id, ownerId, roomId, controller,
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(BOARD_RUN_TIMEOUT_MS)]) }
    try { await store.prune() } catch (cause) { logCleanup(id, cause) }
    if (run.signal.aborted) { await releaseCreateRun(run); run.signal.throwIfAborted() }
    return run
}

export const getOwnedCreateRun = store.owned
export const submitCreateResult = store.submit

function logCleanup(runId: string, cause: unknown) {
    console.error(serializeTraceData({ type: 'board_channel_cleanup_error', runId,
        error: classifyTraceError(cause, { operation: 'storage' }) }))
}

/** Cleanup failure must not mask the run's original outcome; the DB lease still expires. */
export async function releaseCreateRun(run: CreateRun) {
    try { await store.release(run.id) } catch (cause) { logCleanup(run.id, cause) }
}

async function executeInBrowser(run: CreateRun, call: BoardToolCall,
    emit: (event: BoardCreateEvent) => void | Promise<void>, signal: AbortSignal) {
    signal.throwIfAborted()
    await emit({ type: 'tool', runId: run.id, call })
    const asking = call.function.name === 'ask_user'
    let interval = asking ? 1000 : 250
    while (true) {
        signal.throwIfAborted()
        const result = await store.read(run.id, call.id)
        signal.throwIfAborted()
        if (result.output) {
            if (!toolOutputMatchesCall(call, result.output)) throw new Error('工具结果与当前调用不匹配')
            return result.output
        }
        const remaining = +result.deadlineAt - +result.now
        if (remaining <= 0) throw new DOMException('等待浏览器工具结果超时', 'TimeoutError')
        await delay(Math.min(interval, remaining), undefined, { signal })
        interval = asking ? 2000 : 500
    }
}

/** 将应用执行端口接到浏览器等待通道；任务编排和工具预算仍留在应用层。 */
export function createBrowserToolExecutor({ run, emit, mapError, onFailure, waitMs = 15000, record = async () => {} }: {
    run: CreateRun
    emit: (event: BoardCreateEvent) => void | Promise<void>
    mapError: (cause: unknown) => AgentError
    onFailure: (cause: unknown) => void
    waitMs?: number
    record?: TraceRecorder
}): ToolExecutorPort {
    return async (prepared, signal) => {
        const activeSignal = signal === run.signal ? signal : AbortSignal.any([signal, run.signal])
        activeSignal.throwIfAborted()
        const call = toBoardToolCall(prepared.call, prepared.input)
        // 此时还未派发；原生只读字段/props 不合法时可以明确返回 not_executed。
        try {
            switch (call.function.name) {
                case 'create_shapes': validateCreateInput(prepared.input); break
                case 'update_shapes': validateUpdateInput(prepared.input); break
                case 'delete_shapes': validateDeleteInput(prepared.input); break
                case 'ask_user': parseAskInput(call.function.arguments); break
                default: parseSnapshotInput(call.function.arguments)
            }
            validateBoardToolCall(call)
        } catch (cause) {
            return { callId: prepared.call.id, name: prepared.call.name, state: 'not_executed', error: mapError(cause) }
        }
        try {
            await store.register(run.id, call, call.function.name === 'ask_user' ? BOARD_ANSWER_TIMEOUT_MS + 5000 : waitMs)
            activeSignal.throwIfAborted()
        } catch (cause) {
            onFailure(cause)
            await record('tool_error', { callId: call.id, error: classifyTraceError(cause, { operation: 'storage', signal: activeSignal }) })
            return { callId: prepared.call.id, name: prepared.call.name, state: 'not_executed', error: mapError(cause) }
        }
        const began = Date.now()
        let output: BoardToolOutput
        try {
            output = await executeInBrowser(run, call, emit, activeSignal)
        } catch (cause) {
            // 派发后超时/断线不证明没有副作用；向应用层传播异常，由其登记 unknown 并停止后续写入。
            onFailure(cause)
            await record('tool_error', { callId: call.id, name: call.function.name, error: classifyTraceError(cause, { operation: 'tool_execute', signal: activeSignal }) }, Date.now() - began)
            throw cause
        }
        return toAgentToolResult(prepared.call, output)
    }
}
