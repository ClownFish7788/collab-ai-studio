import { isEqual } from '@tldraw/utils'
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

export function patchYRecord(target: Y.Map<unknown>, before: TLRecord, after: TLRecord): void {
    if (before.id !== after.id || before.typeName !== after.typeName
        || ('type' in before && (!('type' in after) || before.type !== after.type))) {
        throw new Error('不能修改画板记录的身份')
    }
    const previous = fields(before), next = fields(after)
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        if (isEqual(previous[key], next[key])) continue
        if (key === 'props') {
            const props = target.get('props')
            if (!(props instanceof Y.Map)) throw new Error('画板属性映射缺失')
            const oldProps = previous.props as Record<string, unknown>
            const newProps = next.props as Record<string, unknown>
            for (const prop of new Set([...Object.keys(oldProps), ...Object.keys(newProps)])) {
                if (isEqual(oldProps[prop], newProps[prop])) continue
                if (Object.hasOwn(newProps, prop)) props.set(prop, structuredClone(newProps[prop]))
                else props.delete(prop)
            }
        } else if (Object.hasOwn(next, key)) target.set(key, structuredClone(next[key]))
        else target.delete(key)
    }
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
