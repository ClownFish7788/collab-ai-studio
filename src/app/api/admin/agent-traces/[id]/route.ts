import prisma from '@/lib/prisma'
import { hasTraceAdminSession, traceJson } from '@/lib/traceAdminSession'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
    if (!hasTraceAdminSession(request)) return traceJson({ error: '请先登录运行记录后台' }, 401)
    const { id } = await context.params
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return traceJson({ error: '记录 ID 不合法' }, 400)
    try {
        const trace = await prisma.agentTrace.findUnique({ where: { id }, include: { events: { orderBy: { sequence: 'asc' } } } })
        return trace ? traceJson({ trace }) : traceJson({ error: '运行记录不存在' }, 404)
    } catch { return traceJson({ error: '无法读取记录详情，请检查数据库初始化' }, 503) }
}
