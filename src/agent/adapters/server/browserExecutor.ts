import { BOARD_RUN_TIMEOUT_MS, BOARD_ANSWER_TIMEOUT_MS, type ToolExecutorPort } from '../../application/ports'
import type { AgentError } from '../../domain/error'
import { toAgentToolResult, toBoardToolCall } from '../board/protocol'
import { validateBoardToolOutput, toolOutputMatchesCall, validateBoardToolCall, type BoardCreateEvent, type BoardToolCall, type BoardToolOutput } from '../transport/boardProtocol'
import { validateCreateInput, validateUpdateInput, validateDeleteInput, parseSnapshotInput, parseAskInput } from '../board/nativeValidation'
import type { TraceRecorder } from '../../../lib/modelTrace'
import { classifyTraceError } from '../../../utils/agent-traces/outcomes'

type PendingTool = {
    call: BoardToolCall
    resolve: (output: BoardToolOutput) => void
    output?: BoardToolOutput
}

export type CreateRun = {
    id: string
    ownerId: string
    roomId: string
    signal: AbortSignal
    controller: AbortController
    pending: Map<string, PendingTool>
}

// shortcut: 单进程 Demo 的等待表；多实例/Serverless 部署前必须替换为共享任务与结果通道。
// globalThis 使 Next 开发环境的启动路由和结果路由共享同一张表，热更新不产生两份模块状态。
const runtime = globalThis as typeof globalThis & { boardCreateRuns?: Map<string, CreateRun> }
const runs = runtime.boardCreateRuns ??= new Map<string, CreateRun>()

/** 创建后端任务；同一用户一次只运行一个。任务 ID 由后端分配，断开或超时后自动失效。 */
export function beginCreateRun(ownerId: string, roomId: string, signal: AbortSignal, id = crypto.randomUUID()): CreateRun {
    signal.throwIfAborted()

    if ([...runs.values()].some(run => run.ownerId === ownerId && !run.signal.aborted)) {
        throw new Error('已有运行中的白板任务')
    }

    const controller = new AbortController()
    const run: CreateRun = {
        id, ownerId, roomId, controller, pending: new Map(),
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(BOARD_RUN_TIMEOUT_MS)]),
    }

    runs.set(run.id, run)
    run.signal.addEventListener('abort', () => runs.delete(run.id), { once: true })
    return run
}

export function getOwnedCreateRun(id: string, ownerId: string): CreateRun {
    const run = runs.get(id)

    if (!run || run.signal.aborted || run.ownerId !== ownerId) {
        throw new Error('任务已结束、已过期或不属于当前用户')
    }

    return run
}

/** 接收一个已授权结果，只能唤醒对应任务正在等待的调用；相同重传幂等，不能替换既有结果。 */
export function submitCreateResult(id: string, ownerId: string, callId: string, value: unknown) {
    const run = getOwnedCreateRun(id, ownerId)
    const pending = run.pending.get(callId)
    const output = validateBoardToolOutput(value)

    if (!pending || pending.call.id !== callId) {
        throw new Error('当前任务没有等待这个工具调用')
    }
    if (!toolOutputMatchesCall(pending.call, output)) throw new Error('工具结果与当前调用不匹配')
    if (pending.output) {
        if (JSON.stringify(pending.output) !== JSON.stringify(output)) {
            throw new Error('工具结果已提交，不能替换')
        }
        return
    }

    pending.output = output
    pending.resolve(output)
}

async function executeInBrowser(
    run: CreateRun,
    call: BoardToolCall,
    emit: (event: BoardCreateEvent) => void | Promise<void>,
    waitMs: number,
    signal: AbortSignal,
) {
    signal.throwIfAborted()
    let rejectWait!: (error: unknown) => void
    const promise = new Promise<BoardToolOutput>((resolve, reject) => {
        run.pending.set(call.id, { call, resolve })
        rejectWait = reject
    })
    const timer = setTimeout(() => rejectWait(new DOMException('等待浏览器工具结果超时', 'TimeoutError')), waitMs)
    const onAbort = () => rejectWait(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })

    try {
        await emit({ type: 'tool', runId: run.id, call })
        return await promise
    } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        if (!run.pending.get(call.id)?.output) run.pending.delete(call.id)
    }
}

/** 结束任务后撤销结果入口；已有结果仅供本次循环消费，不跨任务恢复授权。 */
export function releaseCreateRun(run: CreateRun) {
    runs.delete(run.id)
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
        const began = Date.now()
        let output: BoardToolOutput
        try {
            output = await executeInBrowser(run, call, emit, call.function.name === 'ask_user' ? BOARD_ANSWER_TIMEOUT_MS + 5000 : waitMs, activeSignal)
        } catch (cause) {
            // 派发后超时/断线不证明没有副作用；向应用层传播异常，由其登记 unknown 并停止后续写入。
            onFailure(cause)
            await record('tool_error', { callId: call.id, name: call.function.name, error: classifyTraceError(cause, { operation: 'tool_execute', signal: activeSignal }) }, Date.now() - began)
            throw cause
        }
        return toAgentToolResult(prepared.call, output)
    }
}
