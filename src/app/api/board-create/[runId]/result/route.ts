import { CreateAccessError, readCreatePayload, requireCreateAccess, requireCreateUser } from '@/lib/boardCreateAccess'
import { getOwnedCreateRun, submitCreateResult } from '@/lib/boardCreateRun'
import { validateCreateResultRequest } from '@/utils/board/agent/boardCreateProtocol'

/** 接收执行结果并唤醒原后端循环，不创建新任务，不接受客户端提交的模型历史。 */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
    try {
        const userId = await requireCreateUser()
        const { runId } = await context.params
        const run = getOwnedCreateRun(runId, userId)
        await requireCreateAccess(run.roomId, userId)

        const result = validateCreateResultRequest(await readCreatePayload(request))
        submitCreateResult(runId, userId, result.callId, result.output)

        return Response.json({ accepted: true }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (cause) {
        if (cause instanceof CreateAccessError) {
            return Response.json({ error: cause.message }, { status: cause.status })
        }

        return Response.json({ error: '工具结果被拒绝：任务已失效、调用不匹配或参数不合法' }, { status: 409 })
    }
}
