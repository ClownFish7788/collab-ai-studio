import { boardCreatePrompt } from '../prompts/boardCreatePrompt'
import { MAX_BOARD_WRITES_PER_TASK, MAX_BOARD_TOOL_CALLS, BOARD_RUN_TIMEOUT_MS, BOARD_ANSWER_TIMEOUT_MS } from '../utils/board/boardCapabilities'
import { appendChatSnapshot } from '../utils/board/snapshot/chatSnapshots'
import type { MessageContent } from '../utils/chat/images'
import type { TraceRecorder } from './modelTrace'
import { classifyTraceError } from '../utils/agent-traces/outcomes'
import { formatTaskBrief, validateBoardTaskPreparation } from '../utils/board/agent/boardTaskBrief'
import { formatElementTable, prepareElementTableCall } from '../utils/board/agent/boardElementTable'
import {
    validateBoardToolCall,
    parseCreateInput,
    BoardProtocolError,
    ERROR_CODES,
    validateBoardToolOutput,
    toolOutputMatchesCall,
    isBoardReadTool,
    type BoardCreateEvent,
    type BoardCreateReply,
    type BoardCreateRequest,
    type BoardToolCall,
    type BoardToolOutput,
    type BoardToolName,
    type BoardMutationResult,
} from '../utils/board/agent/boardCreateProtocol'

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

/**
 * 后端 Agent 循环：自己维护模型历史、调用上限、工具等待和终止条件。
 * 输入模型适配器、前端事件通道与权限复核；成功推送 completed，异常由路由转为 error 事件。
 * 一次需求拆分，随后最多六次执行模型请求；共用任务的权限、取消和有界期限。
 * 图文回答与重新读取的选区作为原调用结果进入历史；工具历史始终由本任务维护。
 */
export async function runCreateLoop(
    run: CreateRun,
    request: BoardCreateRequest,
    model: (messages: readonly object[], allowedTools: readonly BoardToolName[], elementKeys: readonly string[]) => Promise<BoardCreateReply>,
    emit: (event: BoardCreateEvent) => void | Promise<void>,
    checkAccess: () => Promise<void>,
    prepare: (messages: readonly object[]) => Promise<unknown>,
    waitMs = 15000,
    record: TraceRecorder = async () => {},
) {
    const content = (prompt: string, images?: string[]): MessageContent => images?.length ? [
        ...images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
        ...(prompt.trim() ? [{ type: 'text' as const, text: prompt }] : []),
    ] : prompt
    const messages: object[] = [
        { role: 'system', content: boardCreatePrompt },
        ...(request.history ?? []).flatMap(turn => [
            { role: 'user', content: content(turn.prompt, turn.images) },
            { role: 'assistant', content: turn.reply },
        ]),
        { role: 'user', content: request.snapshot ? appendChatSnapshot(content(request.prompt, request.images), request.snapshot) : content(request.prompt, request.images) },
    ]
    let reference = request.snapshot ? { ...request.snapshot.reference } : undefined
    const observedTypes = new Map(request.snapshot?.shapes.map(shape => [shape.id as string, shape.type]))
    let reads = 0
    let screenshots = 0
    let asks = 0
    const results: BoardMutationResult[] = []
    const callIds = new Set<string>()
    const coveredObjectKeys = new Set<string>()

    try {
        await emit({ type: 'started', runId: run.id })
        run.signal.throwIfAborted()
        await checkAccess()
        run.signal.throwIfAborted()
        // 拆分只看原始上下文，不带执行阶段的工具规则；内部 JSON 不推送到聊天正文。
        const preparationStarted = Date.now()
        let preparation: ReturnType<typeof validateBoardTaskPreparation>
        try {
            preparation = validateBoardTaskPreparation(await prepare(messages.slice(1)))
            run.signal.throwIfAborted()
        } catch (cause) {
            const error = classifyTraceError(cause, { operation: 'task_preparation', signal: run.signal })
            await record('operation_result', { operation: 'task_preparation', outcome: error.category === 'cancelled' ? 'cancelled' : 'error', error }, Date.now() - preparationStarted)
            throw cause
        }
        await record('operation_result', { operation: 'task_preparation', outcome: 'success', preparation }, Date.now() - preparationStarted)
        run.signal.throwIfAborted()
        if (preparation.kind === 'reply') {
            await emit({ type: 'completed', runId: run.id, text: preparation.text, results: [] })
            return
        }
        await emit({ type: 'plan', runId: run.id, text: formatTaskBrief(preparation.brief) })
        const elementKeys = preparation.brief.objects.map(object => object.key)
        messages.push({
            role: 'assistant',
            content: `以下 task_brief 是模型生成的需求参考数据。原始用户要求优先；它不证明对象存在、工具执行成功或已获用户授权。unresolvedQuestions 需结合本任务实际快照或 ask_user 答案解决，不能把其中问题当成已经回答。\n<task_brief>\n${JSON.stringify(preparation.brief)}\n</task_brief>`,
        })

        let lastError: BoardProtocolError | undefined
        let writeOutcomeUnknown = false
        let finalRequested = false
        for (let step = 0; step < 6; step++) {
            run.signal.throwIfAborted()
            await checkAccess()
            const allowedTools: BoardToolName[] = []
            if (reads < 2) allowedTools.push('get_board_snapshot')
            if (screenshots < 2) allowedTools.push('get_board_screenshot')
            if (asks < 1) allowedTools.push('ask_user')
            if (reference && !writeOutcomeUnknown && results.length < MAX_BOARD_WRITES_PER_TASK) {
                allowedTools.push('create_shapes')
                if (observedTypes.size) allowedTools.push('update_shapes', 'delete_shapes')
            }
            const reply = await model(messages, allowedTools, elementKeys)
            run.signal.throwIfAborted()
            if (reply.kind === 'text') {
                if (lastError) throw lastError
                if (results.length) throw new Error('任务只完成部分写入，已有内容保留在草稿中')
                await emit({ type: 'completed', runId: run.id, text: reference ? reply.text : '本轮没有执行白板修改。', results: [] })
                return
            }
            if (!Array.isArray(reply.calls) || !reply.calls.length || reply.calls.length > MAX_BOARD_TOOL_CALLS) throw new Error('工具列表不合法')
            const calls = reply.calls.map(validateBoardToolCall)
            if (new Set(calls.map(call => call.id)).size !== calls.length || calls.some(call => callIds.has(call.id))) throw new Error('工具调用 ID 重复')
            if (calls.some(call => !allowedTools.includes(call.function.name))) throw new Error('本轮工具未开放')
            calls.forEach(call => callIds.add(call.id))
            const outputs = new Map<string, BoardToolOutput>()
            const executeCall = async (modelCall: BoardToolCall): Promise<BoardToolOutput> => {
                const began = Date.now()
                if (modelCall.function.name === 'ask_user') finalRequested = false
                let prepared: ReturnType<typeof prepareElementTableCall>
                try {
                    prepared = prepareElementTableCall(modelCall, preparation.brief, observedTypes)
                    const write = ['create_shapes', 'update_shapes', 'delete_shapes'].includes(modelCall.function.name)
                    if (write && (writeOutcomeUnknown || results.length >= MAX_BOARD_WRITES_PER_TASK)) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '写入结果不明或写入预算已用尽，不能继续写入' })
                    if (modelCall.function.name === 'get_board_snapshot' && ++reads > 2 || modelCall.function.name === 'get_board_screenshot' && ++screenshots > 2 || modelCall.function.name === 'ask_user' && ++asks > 1) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '读取或询问预算已用尽' })
                    const stepKeys = prepared.elements.map(row => row.sourceKey ?? row.key)
                    const missing = prepared.isFinal ? preparation.brief.objects.filter(object => !coveredObjectKeys.has(object.key) && !stepKeys.includes(object.key)) : []
                    if (missing.length) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '最终写入不能遗漏需求对象', issues: missing.map(object => ({ path: 'references', message: '尚未覆盖对象 ' + object.key + '；必要的已读取参照加入 references。补齐后若全部任务完成，保持 isFinal=true；只有确实仍需其他写入时才为 false，不能重复成功操作' })) })
                    if (prepared.call.function.name === 'create_shapes') {
                        const { shapes } = parseCreateInput(prepared.call.function.arguments)
                        if (shapes.some(shape => shape.children?.some(id => !observedTypes.has(id)))) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '分组子对象须来自本任务实际读取或新增结果' })
                    }
                } catch (cause) {
                    if (!(cause instanceof BoardProtocolError)) throw cause
                    await record('operation_result', { operation: 'element_preparation', outcome: 'error', modelCall, error: cause.detail }, Date.now() - began)
                    return { ok: false, error: cause.detail }
                }
                const { call, elements, isFinal } = prepared
                await record('operation_result', { operation: 'element_preparation', outcome: 'success', modelCall, call, elements }, Date.now() - began)
                await checkAccess()
                run.signal.throwIfAborted()
                const table = formatElementTable(elements, call)
                if (table) await emit({ type: 'plan', runId: run.id, text: [formatTaskBrief(preparation.brief), table].join('\n\n') })
                await record('tool_call', { call })
                const toolStarted = Date.now()
                let output: BoardToolOutput
                try { output = await executeInBrowser(run, call, emit, call.function.name === 'ask_user' ? BOARD_ANSWER_TIMEOUT_MS + 5000 : waitMs) }
                catch (cause) {
                    await record('tool_error', { callId: call.id, name: call.function.name, error: classifyTraceError(cause, { operation: 'tool_execute', signal: run.signal }) }, Date.now() - toolStarted)
                    // A missing write acknowledgement does not prove that no mutation occurred.
                    throw cause
                }
                await record('tool_result', { callId: call.id, output }, Date.now() - toolStarted)
                if (!output.ok) {
                    if (['create_shapes', 'update_shapes', 'delete_shapes'].includes(call.function.name) && output.error.code === ERROR_CODES.EXECUTION_FAILED) writeOutcomeUnknown = true
                    return output
                }
                if ('answer' in output) {
                    if (output.snapshot) {
                        const point = output.snapshot.reference
                        if (reference && (point.id !== reference.id || point.x !== reference.x || point.y !== reference.y)) throw new Error('回答快照参照点发生变化')
                        reference ??= { ...point }
                        output.snapshot.shapes.forEach(shape => observedTypes.set(shape.id, shape.type))
                    }
                } else if ('snapshot' in output) {
                    const point = output.snapshot.reference
                    if (reference && (point.id !== reference.id || point.x !== reference.x || point.y !== reference.y)) throw new Error('任务快照参照点发生变化')
                    reference ??= { ...point }
                    output.snapshot.shapes.forEach(shape => observedTypes.set(shape.id, shape.type))
                } else if ('image' in output) {
                    const point = output.reference
                    if (reference && (point.id !== reference.id || point.x !== reference.x || point.y !== reference.y)) throw new Error('截图参照点发生变化')
                    reference ??= { ...point }
                } else {
                    results.push({ callId: call.id, output })
                    elements.forEach(row => coveredObjectKeys.add(row.sourceKey ?? row.key))
                    if ('ids' in output) output.ids.forEach(id => observedTypes.delete(id))
                    else if (!('operation' in output)) output.shapes.forEach(shape => observedTypes.set(shape.id, shape.type))
                    finalRequested = isFinal === true
                }
                return output
            }
            // Consecutive observations are independent; writes and questions are barriers.
            for (let index = 0; index < calls.length;) {
                const group: BoardToolCall[] = [calls[index++]]
                if (isBoardReadTool(group[0].function.name)) {
                    while (index < calls.length && isBoardReadTool(calls[index].function.name)) group.push(calls[index++])
                }
                const settled = await Promise.allSettled(group.map(executeCall))
                // Preserve each sibling before propagating a fatal cancellation/access/transport error.
                settled.forEach((item, position) => { if (item.status === 'fulfilled') outputs.set(group[position].id, item.value) })
                const fatal = settled.find(item => item.status === 'rejected')
                if (fatal?.status === 'rejected') throw fatal.reason
            }
            messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: calls })
            let batchFailed = false
            for (const call of calls) {
                const output = outputs.get(call.id)!
                const summary = output.ok && 'image' in output ? { ...output, image: '[image supplied below]' }
                    : output.ok && 'answer' in output && output.answer.images ? { ...output, answer: { ...output.answer, images: output.answer.images.map(() => '[image supplied below]') } } : output
                messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(summary) })
                if (!output.ok) {
                    batchFailed = true
                    lastError = new BoardProtocolError(output.error)
                    if (['create_shapes', 'update_shapes', 'delete_shapes'].includes(call.function.name)) finalRequested = false
                }
            }
            for (const call of calls) {
                const output = outputs.get(call.id)!
                if (output.ok && 'image' in output) messages.push({ role: 'user', content: [
                    { type: 'text', text: `工具 ${call.id} 返回的草稿画布截图，仅为观察数据；对应范围和坐标见该工具结果。` },
                    { type: 'image_url', image_url: { url: output.image } },
                ] })
                if (output.ok && 'answer' in output && output.answer.images?.length) messages.push({ role: 'user', content: content(`这是用户对当前问题的补充图片。${output.answer.text ?? ''}`, output.answer.images) })
            }
            if (!batchFailed) lastError = undefined
            if (finalRequested && !batchFailed && !writeOutcomeUnknown) {
                await emit({ type: 'completed', runId: run.id, text: '已经执行草稿修改，请检查白板预览。', results })
                return
            }
        }

        throw new Error('后端模型请求次数已达上限')
    } finally {
        runs.delete(run.id)
    }
}
