import prisma from '@/lib/prisma'
import { hasTraceAdminSession, traceJson } from '@/lib/traceAdminSession'

export async function GET(request: Request) {
    if (!hasTraceAdminSession(request)) return traceJson({ error: '请先登录运行记录后台' }, 401)
    const cursor = new URL(request.url).searchParams.get('cursor')
    if (cursor !== null && !/^[a-zA-Z0-9_-]{1,100}$/.test(cursor)) return traceJson({ error: '分页参数不合法' }, 400)
    try {
        const rows = await prisma.agentTrace.findMany({
            take: 21, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, kind: true, userId: true, roomId: true, model: true, prompt: true, status: true, durationMs: true, createdAt: true },
        })
        return traceJson({ items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null })
    } catch { return traceJson({ error: '无法读取运行记录，请检查数据库初始化' }, 503) }
}
