import prisma from '@/lib/prisma'
import { CreateAccessError, readCreatePayload, requireCreateUser } from '@/agent/adapters/server/access'
import { appendAgentTraceEvent, ClientTraceLimitError } from '@/lib/agentTrace'
import { sameOrigin, traceJson } from '@/lib/traceAdminSession'
import { serializeTraceData } from '@/lib/modelTrace'
import { parseClientTraceEvent } from '@/utils/agent-traces/client'
import { classifyTraceError } from '@/utils/agent-traces/outcomes'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    if (!sameOrigin(request)) return traceJson({ error: '仅允许本站上报' }, 403)
    try {
        const userId = await requireCreateUser()
        const { id } = await context.params
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return traceJson({ error: '记录 ID 不合法' }, 400)
        const trace = await prisma.agentTrace.findUnique({ where: { id }, select: { userId: true } })
        if (!trace || trace.userId !== userId) return traceJson({ error: '记录不存在' }, 404)
        let input: ReturnType<typeof parseClientTraceEvent>
        try { input = parseClientTraceEvent(await readCreatePayload(request, 16 * 1024)) } catch { return traceJson({ error: '浏览器事件不合法' }, 400) }
        const cause = Object.assign(new Error(input.error?.message ?? '浏览器操作已中止'), {
            name: input.outcome === 'cancelled' ? 'AbortError' : input.error?.name ?? 'Error',
            ...(input.error?.code ? { code: input.error.code } : {}), ...(input.error?.stack ? { stack: input.error.stack } : {}),
        })
        await appendAgentTraceEvent(id, 'operation_result', {
            operation: input.operation, outcome: input.outcome,
            ...(input.outcome === 'success' ? {} : { error: classifyTraceError(cause, { operation: input.operation }) }),
        }, input.durationMs, 'client')
        return traceJson({ accepted: true })
    } catch (cause) {
        if (cause instanceof CreateAccessError) return traceJson({ error: cause.message }, cause.status)
        if (cause instanceof ClientTraceLimitError) return traceJson({ error: cause.message }, 429)
        console.error(serializeTraceData({ type: 'trace_storage_error', operation: 'client_event', outcome: 'error', error: classifyTraceError(cause, { operation: 'storage' }) }))
        return traceJson({ error: '暂时无法保存浏览器事件' }, 503)
    }
}
