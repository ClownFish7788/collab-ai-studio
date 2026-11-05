import type { TLRecord } from 'tldraw'
import * as Y from 'yjs'

const placementKeys = ['parentId', 'x', 'y', 'rotation', 'index'] as const
const documentTypes = new Set(['shape', 'page', 'document', 'asset', 'binding'])

export function isDocumentRecord(record: { typeName?: unknown }): boolean {
    return typeof record.typeName === 'string' && documentTypes.has(record.typeName)
}

function placement(record: Record<string, unknown>) {
    const value = Object.fromEntries(placementKeys.map(key => [key, record[key]]))
    if (typeof value.parentId !== 'string' || typeof value.index !== 'string'
        || !['x', 'y', 'rotation'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
        throw new Error('画板位置数据不完整')
    }
    return value
}

function fields(record: TLRecord): Record<string, unknown> {
    if (!isDocumentRecord(record) || typeof record.id !== 'string') throw new Error('无效的画板记录')
    const result: Record<string, unknown> = { ...record }
    if (record.typeName === 'shape') {
        result.placement = placement(result)
        for (const key of placementKeys) delete result[key]
    }
    return result
}

export function createYRecord(record: TLRecord): Y.Map<unknown> {
    return new Y.Map(Object.entries(fields(record)).map(([key, value]) => [
        key,
        key === 'props'
            ? new Y.Map(Object.entries(structuredClone(value as Record<string, unknown>)))
            : structuredClone(value),
    ]))
}


export function decodeYRecord(record: Y.Map<unknown>): TLRecord {
    if (!(record instanceof Y.Map)) throw new Error('画板记录不是共享 Map')
    const value = structuredClone(record.toJSON())
    if (!isDocumentRecord(value) || typeof value.id !== 'string') throw new Error('无效的画板记录')
    if (value.typeName === 'shape') {
        if (!(record.get('props') instanceof Y.Map)) throw new Error('画板属性映射缺失')
        const result = { ...value, ...placement(value.placement ?? {}) }
        delete result.placement
        return result as TLRecord
    }
    return value as TLRecord
}
