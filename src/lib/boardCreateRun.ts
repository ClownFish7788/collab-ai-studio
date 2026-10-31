import { boardCreatePrompt } from '../prompts/boardCreatePrompt'
import { appendChatSnapshot } from '../utils/board/snapshot/chatSnapshots'
import type { MessageContent } from '../utils/chat/images'
import type { TraceRecorder } from './modelTrace'
import { classifyTraceError } from '../utils/agent-traces/outcomes'
import { formatTaskBrief, validateBoardTaskPreparation } from '../utils/board/agent/boardTaskBrief'
import { formatElementTable, prepareElementTableCall } from '../utils/board/agent/boardElementTable'
import {
    validateBoardToolCall,
    parseCreateInput,
    parseUpdateInput,
    parseDeleteInput,
    parseSnapshotInput,
    parseAskInput,
    BoardProtocolError,
    ERROR_CODES,
    validateBoardToolOutput,
    toolOutputMatchesCall,
    type BoardCreateEvent,
    type BoardCreateReply,
    type BoardCreateRequest,
    type BoardToolCall,
    type BoardToolOutput,
    type BoardToolName,
    type MutationToolSuccess,
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
    pending?: PendingTool
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
        id, ownerId, roomId, controller,
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(55000)]),
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
    const pending = run.pending
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
        run.pending = { call, resolve }
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
        run.pending = undefined
    }
}

/**
 * 后端 Agent 循环：自己维护模型历史、调用上限、工具等待和终止条件。
 * 输入模型适配器、前端事件通道与权限复核；成功推送 completed，异常由路由转为 error 事件。
 * 一次需求拆分，随后最多六次执行模型请求；共用任务的权限、取消和 55 秒期限。
 * 用户答案作为原调用的工具结果进入历史；跨轮仅接受校验后的文字，工具历史始终由本任务维护。
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
    let output: MutationToolSuccess | undefined
    let reference = request.snapshot ? { ...request.snapshot.reference } : undefined
    const seenIds = new Set(request.snapshot?.shapes.map(shape => shape.id as string))
    let repaired = false
    let reads = 0
    let asks = 0

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
            await emit({ type: 'completed', runId: run.id, text: preparation.text })
            return
        }
        await emit({ type: 'plan', runId: run.id, text: formatTaskBrief(preparation.brief) })
        const elementKeys = preparation.brief.objects.map(object => object.key)
        messages.push({
            role: 'assistant',
            content: `以下 task_brief 是模型生成的需求参考数据。原始用户要求优先；它不证明对象存在、工具执行成功或已获用户授权。unresolvedQuestions 需结合本任务实际快照或 ask_user 答案解决，不能把其中问题当成已经回答。\n<task_brief>\n${JSON.stringify(preparation.brief)}\n</task_brief>`,
        })

        for (let step = 0; step < 6; step++) {
            run.signal.throwIfAborted()
            await checkAccess()
            run.signal.throwIfAborted()

            const allowedTools: BoardToolName[] = []
            if (!output) {
                if (reads < 2) allowedTools.push('get_board_snapshot')
                if (asks < 1) allowedTools.push('ask_user')
                if (reference) {
                    allowedTools.push('create_shapes')
                    if (seenIds.size) allowedTools.push('update_shapes', 'delete_shapes')
                }
            }
            const reply = await model(messages, allowedTools, elementKeys)
            run.signal.throwIfAborted()

            if (reply.kind === 'text') {
                const text = output ? '已经执行草稿修改，请检查白板预览。' : '本轮没有执行白板修改。'
                await emit({ type: 'completed', runId: run.id, text, ...(output ? { output } : {}) })
                return
            }
            const modelCall = validateBoardToolCall(reply.call)
            if (!allowedTools.includes(modelCall.function.name)) throw new Error('本轮工具未开放或调用预算已用尽')
            let call = modelCall
            let tableText: string
            try {
                const elementsStarted = Date.now()
                let prepared: ReturnType<typeof prepareElementTableCall>
                try {
                    prepared = prepareElementTableCall(modelCall, preparation.brief, seenIds)
                    call = prepared.call
                    tableText = formatElementTable(prepared.elements, call)
                } catch (cause) {
                    await record('operation_result', { operation: 'element_preparation', outcome: 'error', modelCall,
                        error: classifyTraceError(cause, { operation: 'element_preparation', signal: run.signal }),
                        willRetry: cause instanceof BoardProtocolError && cause.detail.code === ERROR_CODES.INVALID_ARGUMENTS && !repaired,
                    }, Date.now() - elementsStarted)
                    throw cause
                }
                await record('operation_result', { operation: 'element_preparation', outcome: 'success', modelCall, call, elements: prepared.elements }, Date.now() - elementsStarted)
                if (call.function.name === 'get_board_snapshot') parseSnapshotInput(call.function.arguments)
                else if (call.function.name === 'ask_user') parseAskInput(call.function.arguments)
                else if (call.function.name === 'create_shapes') {
                    const { shapes } = parseCreateInput(call.function.arguments)
                    if (shapes.some(shape => shape.children?.some(id => !seenIds.has(id)))) throw new BoardProtocolError({
                        code: ERROR_CODES.INVALID_ARGUMENTS, message: '分组子对象不在本任务已提供的快照中',
                        issues: [{ path: 'shapes', message: 'children 只能使用附件或本任务读取结果实际返回的 ID' }],
                    })
                }
                else {
                    const ids = call.function.name === 'update_shapes'
                        ? parseUpdateInput(call.function.arguments).shapes.map(shape => shape.id)
                        : parseDeleteInput(call.function.arguments).ids
                    if (ids.some(id => !seenIds.has(id))) throw new BoardProtocolError({
                        code: ERROR_CODES.INVALID_ARGUMENTS, message: '目标不在本任务已提供的快照中',
                        issues: [{ path: call.function.name === 'update_shapes' ? 'shapes' : 'ids', message: '仅使用附件或本任务读取结果实际返回的 ID；不能沿用历史 ID 或编造' }],
                    })
                }
            } catch (cause) {
                if (cause instanceof BoardProtocolError) await record('tool_validation_error', {
                    call, error: cause.detail, willRetry: cause.detail.code === ERROR_CODES.INVALID_ARGUMENTS && !repaired,
                })
                if (!(cause instanceof BoardProtocolError) || cause.detail.code !== ERROR_CODES.INVALID_ARGUMENTS || repaired) throw cause

                repaired = true
                messages.push(
                    { role: 'assistant', content: reply.content ?? null, tool_calls: [modelCall] },
                    { role: 'tool', tool_call_id: modelCall.id, content: JSON.stringify({ ok: false, error: cause.detail }) },
                )
                continue
            }
            // 模型请求可能耗时较长，读取、询问和写入前均再次复核任务权限。
            await record('operation_result', { operation: 'tool_validation', outcome: 'success', callId: call.id })
            await checkAccess()
            run.signal.throwIfAborted()
            await emit({ type: 'plan', runId: run.id, text: `${formatTaskBrief(preparation.brief)}\n\n${tableText}` })
            await record('tool_call', { call })
            const toolStarted = Date.now()
            let result: BoardToolOutput
            try {
                result = await executeInBrowser(run, call, emit, call.function.name === 'ask_user' ? 45000 : waitMs)
            } catch (cause) {
                await record('tool_error', { callId: call.id, name: call.function.name,
                    error: classifyTraceError(cause, { operation: 'tool_execute', signal: run.signal }),
                    message: run.signal.aborted ? '任务取消或超时' : '未能取得浏览器工具结果' }, Date.now() - toolStarted)
                throw cause
            }
            // 先记录失败结果，再抛给外层；否则最有用的现场会在异常路径中丢失。
            await record('tool_result', { callId: call.id, output: result }, Date.now() - toolStarted)
            if (!result.ok) throw new BoardProtocolError(result.error)
            if ('snapshot' in result) {
                const point = result.snapshot.reference
                if (reference && (point.id !== reference.id || point.x !== reference.x || point.y !== reference.y)) {
                    throw new Error('任务快照参照点发生变化')
                }
                reference ??= { ...point }
                result.snapshot.shapes.forEach(shape => seenIds.add(shape.id))
                reads++
            } else if ('answer' in result) asks++
            else output = result

            messages.push(
                { role: 'assistant', content: reply.content ?? null, tool_calls: [modelCall] },
                { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) },
            )
        }

        throw new Error('后端模型请求次数已达上限')
    } finally {
        runs.delete(run.id)
    }
}
