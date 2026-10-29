import { boardCreatePrompt } from '../prompts/boardCreatePrompt'
import { appendChatSnapshot } from '../utils/board/snapshot/chatSnapshots'
import type { MessageContent } from '../utils/chat/images'
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
export function beginCreateRun(ownerId: string, roomId: string, signal: AbortSignal): CreateRun {
    signal.throwIfAborted()

    if ([...runs.values()].some(run => run.ownerId === ownerId && !run.signal.aborted)) {
        throw new Error('已有运行中的白板任务')
    }

    const controller = new AbortController()
    const run: CreateRun = {
        id: crypto.randomUUID(), ownerId, roomId, controller,
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
    const timer = setTimeout(() => rejectWait(new Error('等待浏览器工具结果超时')), waitMs)
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
 * 最多六次模型请求：两次读取、一次询问、一次参数纠错、一次实际写入及总结。
 * 用户答案作为原调用的工具结果进入历史；跨轮仅接受校验后的文字，工具历史始终由本任务维护。
 */
export async function runCreateLoop(
    run: CreateRun,
    request: BoardCreateRequest,
    model: (messages: readonly object[], allowedTools: readonly BoardToolName[]) => Promise<BoardCreateReply>,
    emit: (event: BoardCreateEvent) => void | Promise<void>,
    checkAccess: () => Promise<void>,
    waitMs = 15000,
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
            const reply = await model(messages, allowedTools)
            run.signal.throwIfAborted()

            if (reply.kind === 'text') {
                await emit({ type: 'completed', runId: run.id, text: reply.text, ...(output?.ok ? { output } : {}) })
                return
            }
            const call = validateBoardToolCall(reply.call)
            if (!allowedTools.includes(call.function.name)) throw new Error('本轮工具未开放或调用预算已用尽')
            try {
                if (call.function.name === 'get_board_snapshot') parseSnapshotInput(call.function.arguments)
                else if (call.function.name === 'ask_user') parseAskInput(call.function.arguments)
                else if (call.function.name === 'create_shapes') parseCreateInput(call.function.arguments)
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
                if (!(cause instanceof BoardProtocolError) || cause.detail.code !== ERROR_CODES.INVALID_ARGUMENTS || repaired) throw cause

                repaired = true
                messages.push(
                    { role: 'assistant', content: reply.content ?? null, tool_calls: [call] },
                    { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: cause.detail }) },
                )
                continue
            }
            // 模型请求可能耗时较长，读取、询问和写入前均再次复核任务权限。
            await checkAccess()
            run.signal.throwIfAborted()
            const result = await executeInBrowser(run, call, emit, call.function.name === 'ask_user' ? 45000 : waitMs)
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
                { role: 'assistant', content: reply.content ?? null, tool_calls: [call] },
                { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) },
            )
        }

        throw new Error('后端模型请求次数已达上限')
    } finally {
        runs.delete(run.id)
    }
}
