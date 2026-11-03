import { runAgent } from '../agent/application/runAgent'
import { BOARD_RUN_TIMEOUT_MS, BOARD_ANSWER_TIMEOUT_MS, AgentApplicationError, type ModelPort } from '../agent/application/ports'
import { agentErrorSchema, ERROR_CODES, type AgentError } from '../agent/domain/error'
import type { AgentMessage, ContentBlock } from '../agent/domain/message'
import { jsonValueSchema } from '../agent/domain/data'
import { toolCallProposalSchema } from '../agent/domain/invocation'
import { boardCreatePrompt } from '../prompts/boardCreatePrompt'
import { boardToolContracts } from '../utils/board/agent/boardToolInputSchema'
import { formatTaskBrief } from '../utils/board/agent/boardTaskBrief'
import { formatElementTable } from '../utils/board/agent/boardElementTable'
import {
    validateBoardToolOutput, toolOutputMatchesCall, validateCreateInput, validateUpdateInput, validateDeleteInput,
    parseSnapshotInput, parseAskInput, validateMutationOutput, validateBoardToolCall, BoardProtocolError,
    type BoardCreateEvent, type BoardCreateRequest, type BoardToolCall, type BoardToolOutput,
} from '../utils/board/agent/boardCreateProtocol'
import type { TraceRecorder } from './modelTrace'
import { toAgentSnapshot, toBoardToolCall } from '../agent/adapters/board/protocol'
import { classifyTraceError } from '../utils/agent-traces/outcomes'

type PendingTool = {
    call: BoardToolCall
    resolve: (output: BoardToolOutput) => void
    output?: BoardToolOutput
}

type CreateRun = {
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
) {
    run.signal.throwIfAborted()
    let rejectWait!: (error: unknown) => void
    const promise = new Promise<BoardToolOutput>((resolve, reject) => {
        run.pending.set(call.id, { call, resolve })
        rejectWait = reject
    })
    const timer = setTimeout(() => rejectWait(new DOMException('等待浏览器工具结果超时', 'TimeoutError')), waitMs)
    const onAbort = () => rejectWait(run.signal.reason)
    run.signal.addEventListener('abort', onAbort, { once: true })

    try {
        await emit({ type: 'tool', runId: run.id, call })
        return await promise
    } finally {
        clearTimeout(timer)
        run.signal.removeEventListener('abort', onAbort)
        if (!run.pending.get(call.id)?.output) run.pending.delete(call.id)
    }
}

/** 组装真实端口并转换旧传输协议；应用主循环只存在于 runAgent。 */
export async function runCreateLoop(
    run: CreateRun,
    request: BoardCreateRequest,
    model: ModelPort,
    emit: (event: BoardCreateEvent) => void | Promise<void>,
    checkAccess: () => Promise<void>,
    waitMs = 15000,
    record: TraceRecorder = async () => {},
) {
    try {
        const blocks = (text: string, source: 'user' | 'assistant', images?: string[]): ContentBlock[] => [
            ...(text.trim() ? [{ type: 'text' as const, source, text }] : []),
            ...(images?.map(url => ({ type: 'image' as const, source, url })) ?? []),
        ]
        const initialSnapshot = request.snapshot ? toAgentSnapshot(request.snapshot) : undefined
        const messages: AgentMessage[] = [
            { role: 'system', content: [{ type: 'text', source: 'system', text: boardCreatePrompt }] },
            ...(request.history ?? []).flatMap((turn): AgentMessage[] => [
                { role: 'user', content: blocks(turn.prompt, 'user', turn.images) },
                { role: 'assistant', content: blocks(turn.reply, 'assistant') },
            ]),
            { role: 'user', content: [...blocks(request.prompt, 'user', request.images),
                ...(initialSnapshot ? [{ type: 'data' as const, source: 'user' as const, data: jsonValueSchema.parse(JSON.parse(JSON.stringify({ snapshot: initialSnapshot }))) }] : []),
            ] },
        ]
        const mapError = (cause: unknown): AgentError => {
            if (cause instanceof BoardProtocolError || cause instanceof AgentApplicationError) return cause.detail
            if (cause instanceof Error && 'status' in cause && (cause.status === 401 || cause.status === 403)) return { code: ERROR_CODES.ACCESS_DENIED, message: cause.message }
            return { code: ERROR_CODES.TASK_FAILED, message: '后端白板任务失败，已完成的内容仅保留在草稿中' }
        }
        // 领域结局只携带安全诊断，原始超时/权限异常留在适配层供路由准确分类。
        let runtimeFailure: unknown
        const outcome = await runAgent({ runId: run.id, messages, initialSnapshot }, {
            tools: boardToolContracts, signal: run.signal, mapError,
            checkAccess: async () => {
                try { await checkAccess() } catch (cause) { runtimeFailure = cause; throw cause }
            },
            model,
            emit: event => {
                if (event.type === 'started') return emit({ type: 'started', runId: run.id })
                const table = event.prepared ? formatElementTable(event.prepared.elements, toBoardToolCall(event.prepared.call, event.prepared.input)) : ''
                return emit({ type: 'plan', runId: run.id, text: [formatTaskBrief(event.task), table].filter(Boolean).join('\n\n') })
            },
            record: (type, data, duration) => {
                if (type === 'tool_result' && data.result && typeof data.result === 'object' && 'state' in data.result) {
                    const result = data.result
                    return record(type, { callId: data.callId, output: result.state === 'known' && 'output' in result ? result.output
                        : { ok: false, state: result.state, error: 'error' in result ? result.error : undefined } }, duration)
                }
                const transformed = { ...data }
                for (const key of ['call', 'modelCall']) {
                    const parsed = toolCallProposalSchema.safeParse(data[key])
                    if (parsed.success) transformed[key] = toBoardToolCall(parsed.data, key === 'call' ? data.input ?? parsed.data.input : parsed.data.input)
                }
                return record(type, transformed, duration)
            },
            execute: async prepared => {
                const call = toBoardToolCall(prepared.call, prepared.input)
                // 原生 props/只读属性验证必须在派发前完成，失败明确标记为未执行。
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
                try { output = await executeInBrowser(run, call, emit, call.function.name === 'ask_user' ? BOARD_ANSWER_TIMEOUT_MS + 5000 : waitMs) }
                catch (cause) {
                    runtimeFailure = cause
                    await record('tool_error', { callId: call.id, name: call.function.name, error: classifyTraceError(cause, { operation: 'tool_execute', signal: run.signal }) }, Date.now() - began)
                    throw cause
                }
                if (!output.ok && prepared.call.name !== 'get_board_snapshot' && prepared.call.name !== 'get_board_screenshot' && prepared.call.name !== 'ask_user' && output.error.code === ERROR_CODES.EXECUTION_FAILED) {
                    return { callId: prepared.call.id, name: prepared.call.name, state: 'unknown', error: output.error }
                }
                const normalized = output.ok && 'snapshot' in output && output.snapshot ? { ...output, snapshot: toAgentSnapshot(output.snapshot) } : output
                return { callId: prepared.call.id, name: prepared.call.name, state: 'known', output: normalized }
            },
        })
        if (outcome.status === 'completed') await emit({ type: 'completed', runId: run.id, text: outcome.text, results: outcome.changes.map(({ callId, output }) => ({ callId, output: validateMutationOutput(output) })) })
        else throw runtimeFailure ?? new BoardProtocolError(agentErrorSchema.parse(outcome.error))
        return outcome
    } finally {
        runs.delete(run.id)
    }
}
