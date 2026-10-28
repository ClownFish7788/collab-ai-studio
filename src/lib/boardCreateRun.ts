import { boardCreatePrompt } from '../prompts/boardCreatePrompt'
import {
    validateCreateCall,
    parseCreateInput,
    BoardProtocolError,
    ERROR_CODES,
    validateCreateOutput,
    type BoardCreateEvent,
    type BoardCreateReply,
    type BoardCreateRequest,
    type CreateToolCall,
    type CreateToolOutput,
} from '../utils/boardCreateProtocol'

type PendingTool = {
    callId: string
    resolve: (output: CreateToolOutput) => void
    output?: CreateToolOutput
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
        throw new Error('已有运行中的新增任务')
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
    const output = validateCreateOutput(value)

    if (!pending || pending.callId !== callId) {
        throw new Error('当前任务没有等待这个工具调用')
    }
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
    call: CreateToolCall,
    emit: (event: BoardCreateEvent) => void | Promise<void>,
    waitMs: number,
) {
    run.signal.throwIfAborted()
    let rejectWait!: (error: unknown) => void
    const promise = new Promise<CreateToolOutput>((resolve, reject) => {
        run.pending = { callId: call.id, resolve }
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
 * 最多三次模型请求（含一次参数纠错）、一次实际新增；浏览器不能追加模型历史。
 */
export async function runCreateLoop(
    run: CreateRun,
    request: BoardCreateRequest,
    model: (messages: readonly object[], allowTools: boolean) => Promise<BoardCreateReply>,
    emit: (event: BoardCreateEvent) => void | Promise<void>,
    checkAccess: () => Promise<void>,
    waitMs = 15000,
) {
    const messages: object[] = [
        { role: 'system', content: boardCreatePrompt },
        { role: 'user', content: request.prompt },
    ]
    let output: CreateToolOutput | undefined
    let repaired = false

    try {
        await emit({ type: 'started', runId: run.id })

        for (let step = 0; step < 3; step++) {
            run.signal.throwIfAborted()
            await checkAccess()
            run.signal.throwIfAborted()

            const reply = await model(messages, !output)
            run.signal.throwIfAborted()

            if (reply.kind === 'text') {
                await emit({ type: 'completed', runId: run.id, text: reply.text, ...(output?.ok ? { output } : {}) })
                return
            }
            if (output) throw new Error('后端新增工具调用次数已达上限')

            const call = validateCreateCall(reply.call)
            try {
                parseCreateInput(call.function.arguments)
            } catch (cause) {
                if (!(cause instanceof BoardProtocolError) || cause.detail.code !== ERROR_CODES.INVALID_ARGUMENTS || repaired) throw cause

                repaired = true
                messages.push(
                    { role: 'assistant', content: reply.content ?? null, tool_calls: [call] },
                    { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: cause.detail }) },
                )
                continue
            }
            // 模型请求可能耗时较长，发出写工具前再确认编辑权限。
            await checkAccess()
            run.signal.throwIfAborted()
            output = await executeInBrowser(run, call, emit, waitMs)
            if (!output.ok) throw new BoardProtocolError(output.error)

            messages.push(
                { role: 'assistant', content: reply.content ?? null, tool_calls: [call] },
                { role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) },
            )
        }

        throw new Error('后端模型请求次数已达上限')
    } finally {
        runs.delete(run.id)
    }
}
