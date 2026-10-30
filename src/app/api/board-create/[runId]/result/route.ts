import { CreateAccessError, readCreatePayload, requireCreateAccess, requireCreateUser } from '@/lib/boardCreateAccess'
import { getOwnedCreateRun, submitCreateResult } from '@/lib/boardCreateRun'
import { validateCreateResultRequest } from '@/utils/board/agent/boardCreateProtocol'
import prisma from '@/lib/prisma'
import { appendAgentTraceEvent } from '@/lib/agentTrace'
import { traceAgentRequest } from '@/lib/agentTraceRequest'
import { serializeTraceData } from '@/lib/modelTrace'
import { classifyTraceError } from '@/utils/agent-traces/outcomes'

async function recordResult(id: string, data: object, durationMs: number) {
    try { await appendAgentTraceEvent(id, 'operation_result', data, durationMs) }
    catch (cause) { console.error(serializeTraceData({ type: 'trace_storage_error', operation: 'result_submit', traceId: id, error: classifyTraceError(cause, { operation: 'storage' }) })) }
}

/** 接收执行结果并唤醒原后端循环，不创建新任务，不接受客户端提交的模型历史。 */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
    const began = Date.now()
    let userId: string | undefined
    let runId: string | undefined
    try {
        userId = await requireCreateUser()
        runId = (await context.params).runId
        const run = getOwnedCreateRun(runId, userId)
        await requireCreateAccess(run.roomId, userId)

        const result = validateCreateResultRequest(await readCreatePayload(request))
        submitCreateResult(runId, userId, result.callId, result.output)
        await recordResult(runId, { operation: 'result_submit', outcome: 'success', callId: result.callId }, Date.now() - began)

        return Response.json({ accepted: true }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (cause) {
        const status = cause instanceof CreateAccessError ? cause.status : 409
        const message = cause instanceof CreateAccessError ? cause.message : '工具结果被拒绝：任务已失效、调用不匹配或参数不合法'
        const error = classifyTraceError(cause, { operation: cause instanceof CreateAccessError ? cause.status === 401 ? 'authentication' : 'access' : 'result_submit' })
        // 任务可能刚刚结束而从等待表移除；只给同一用户的持久化记录追加迟到/非法结果。
        let owned = false
        if (userId && runId && /^[a-zA-Z0-9_-]{1,100}$/.test(runId)) {
            try { owned = (await prisma.agentTrace.findUnique({ where: { id: runId }, select: { userId: true } }))?.userId === userId } catch { /* 下方独立拒绝记录仍会回退到服务端日志。 */ }
        }
        if (owned && runId) {
            await recordResult(runId, { operation: 'result_submit', outcome: 'error', error }, Date.now() - began)
            return Response.json({ error: message }, { status })
        }
        return traceAgentRequest(request, 'board', async trace => {
            if (userId) await trace.context({ userId })
            await trace.record('operation_result', { operation: 'result_submit', outcome: 'error', error })
            return Response.json({ error: message }, { status })
        })
    }
}
