import prisma from '@/lib/prisma'
import { hasTraceAdminSession, traceJson } from '@/lib/traceAdminSession'

export async function GET(request: Request, context: { params: Promise<{ id: string; imageId: string }> }) {
    if (!hasTraceAdminSession(request)) return traceJson({ error: '请先登录运行记录后台' }, 401)
    const { id, imageId } = await context.params
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !/^[a-f0-9]{64}$/.test(imageId)) return traceJson({ error: '图片引用不合法' }, 400)
    try {
        const image = await prisma.agentTraceImage.findFirst({ where: { id: imageId, traceId: id } })
        if (!image) return traceJson({ error: '运行记录图片不存在' }, 404)
        const bytes = Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64')
        return new Response(bytes, { headers: {
            'Content-Type': image.mimeType, 'Content-Length': String(bytes.length),
            'Cache-Control': 'private, no-store', Vary: 'Cookie',
            'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Security-Policy': "default-src 'none'; sandbox",
        } })
    } catch { return traceJson({ error: '无法读取图片，请检查运行记录数据库初始化' }, 503) }
}
