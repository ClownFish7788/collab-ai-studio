import 'server-only'
import { createHash } from 'node:crypto'
import prisma from './prisma'
import { serializeTraceData } from './modelTrace'
import { captureTraceImages } from '../utils/agent-traces/images'
import { validateImageDataUrl, MAX_CHAT_REQUEST_BYTES } from '../utils/chat/images'

export async function serializeTraceWithImages(traceId: string, value: unknown): Promise<string> {
    const captured = await captureTraceImages(value, async dataUrl => {
        validateImageDataUrl(dataUrl)
        const mimeType = dataUrl.slice(5, dataUrl.indexOf(';'))
        const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64').length
        const id = createHash('sha256').update(traceId).update('\0').update(dataUrl).digest('hex')
        await prisma.$transaction(async tx => {
            // 同一 trace 的图片预算串行核对，重复内容不重复占用存储。
            await tx.agentTrace.update({ where: { id: traceId }, data: { lastSequence: { increment: 0 } }, select: { id: true } })
            if (await tx.agentTraceImage.findUnique({ where: { id }, select: { id: true } })) return
            const total = await tx.agentTraceImage.aggregate({ where: { traceId }, _sum: { bytes: true } })
            if ((total._sum.bytes ?? 0) + bytes > MAX_CHAT_REQUEST_BYTES) throw new Error('运行记录图片总量超过32MiB，未保存此图片')
            await tx.agentTraceImage.create({ data: { id, traceId, mimeType, bytes, dataUrl } })
        })
        return `/api/admin/agent-traces/${traceId}/images/${id}`
    }, cause => {
        console.error(serializeTraceData({ type: 'trace_storage_error', operation: 'image_save', traceId,
            message: cause instanceof Error ? cause.message : '运行记录图片保存失败' }))
    })
    return serializeTraceData(captured)
}
