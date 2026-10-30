import prisma from '@/lib/prisma'
import { hasTraceAdminSession, traceJson } from '@/lib/traceAdminSession'
import { errorCategories } from '@/utils/agent-traces/outcomes'

export async function GET(request: Request) {
    if (!hasTraceAdminSession(request)) return traceJson({ error: '请先登录运行记录后台' }, 401)
    const params = new URL(request.url).searchParams
    const cursor = params.get('cursor')
    const category = params.get('category')
    const status = params.get('status')
    if (cursor !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(cursor)) return traceJson({ error: '分页参数不合法' }, 400)
    if (category && !Object.hasOwn(errorCategories, category) || status && !['running', 'completed', 'failed', 'cancelled', 'timed_out'].includes(status)) return traceJson({ error: '筛选条件不合法' }, 400)
    try {
        const rows = await prisma.agentTrace.findMany({
            take: 21, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            where: { ...(status ? { status } : {}), ...(category ? { events: { some: { errorCategory: category } } } : {}) },
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, kind: true, userId: true, roomId: true, model: true, prompt: true, status: true, durationMs: true, createdAt: true,
                _count: { select: { events: { where: { outcome: 'error' } } } } },
        })
        return traceJson({ items: rows.slice(0, 20).map(({ _count, ...row }) => ({ ...row, errorCount: _count.events })), nextCursor: rows.length > 20 ? rows[19].id : null })
    } catch { return traceJson({ error: '无法读取运行记录，请检查数据库初始化' }, 503) }
}
