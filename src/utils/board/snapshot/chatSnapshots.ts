import type { RegionSnapshot } from './collectRegionSnapshot'
import type { MessageContent } from '../../chat/images'

/** 独立限制每条消息的快照大小，不占用用户输入的 4000 字额度。 */
export const MAX_CHAT_SNAPSHOT_BYTES = 64 * 1024

const colors = ['black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white']
const fills = ['none', 'semi', 'solid', 'pattern', 'fill', 'lined-fill']
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isShapeId = (value: unknown): value is string => typeof value === 'string' && value.startsWith('shape:') && value.length > 6
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 校验快照数据及大小；任务的固定参照物允许不在本次读取范围内。 */
export function validateRegionSnapshot(value: unknown): asserts value is RegionSnapshot {
    if (!isRecord(value) || !isRecord(value.reference) || !Array.isArray(value.shapes)
        || !isFiniteNumber(value.reference.x) || !isFiniteNumber(value.reference.y)) {
        throw new Error('白板快照格式不合法')
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_CHAT_SNAPSHOT_BYTES) {
        throw new Error('白板快照超过 64KB，请减少所选元素或文字')
    }
    if (value.viewport !== undefined && (!isRecord(value.viewport)
        || !isFiniteNumber(value.viewport.x) || !isFiniteNumber(value.viewport.y)
        || !isFiniteNumber(value.viewport.w) || value.viewport.w < 0
        || !isFiniteNumber(value.viewport.h) || value.viewport.h < 0)) {
        throw new Error('白板视口坐标或尺寸不合法')
    }
    const ids = new Set<string>()
    for (const shape of value.shapes) {
        if (!isRecord(shape) || !isShapeId(shape.id) || typeof shape.type !== 'string' || !shape.type
            || typeof shape.text !== 'string' || !isFiniteNumber(shape.x) || !isFiniteNumber(shape.y)
            || !isFiniteNumber(shape.w) || shape.w < 0 || !isFiniteNumber(shape.h) || shape.h < 0
            || !isFiniteNumber(shape.opacity) || shape.opacity < 0 || shape.opacity > 1) {
            throw new Error('白板元素属性不合法')
        }
        for (const key of ['color', 'labelColor', 'fill', 'geo', 'assetId', 'url']) {
            if (key in shape && typeof shape[key] !== 'string') throw new Error('白板元素属性不合法')
        }
        if ((typeof shape.color === 'string' && !colors.includes(shape.color))
            || (typeof shape.labelColor === 'string' && !colors.includes(shape.labelColor))
            || (typeof shape.fill === 'string' && !fills.includes(shape.fill))
            || (typeof shape.assetId === 'string' && !shape.assetId.startsWith('asset:'))) {
            throw new Error('白板元素样式或资源标识不合法')
        }
        ids.add(shape.id)
    }
    if (ids.size !== value.shapes.length || value.reference.id !== null && !isShapeId(value.reference.id)) {
        throw new Error('白板元素 ID 或参照物不合法')
    }
}

/** 聊天选区的参照物必须来自该附件，空选区不携带参照元素。 */
export function validateChatSnapshot(value: unknown): asserts value is RegionSnapshot {
    validateRegionSnapshot(value)
    if ((value.shapes.length === 0) !== (value.reference.id === null)
        || value.reference.id !== null && !value.shapes.some(shape => shape.id === value.reference.id)) {
        throw new Error('白板元素 ID 或参照物不合法')
    }
}

export function appendChatSnapshot(content: MessageContent, snapshot: RegionSnapshot): MessageContent {
    const text = `<whiteboard_snapshot>\n${JSON.stringify(snapshot)}\n</whiteboard_snapshot>`
    return typeof content === 'string'
        ? (content.trim() ? `${content}\n\n${text}` : text)
        : [...content, { type: 'text', text }]
}
