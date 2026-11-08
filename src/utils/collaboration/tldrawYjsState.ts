import type { TLRecord, TLStore } from 'tldraw'
import type * as Y from 'yjs'
import { decodeYRecord, isDocumentRecord } from './tldrawYjsRecords'

export function recordReferences(record: TLRecord | undefined): string[] {
    if (record?.typeName === 'shape') return [record.parentId,
        ...('assetId' in record.props && record.props.assetId ? [String(record.props.assetId)] : [])]
    if (record?.typeName === 'binding') return [record.fromId, record.toId]
    return []
}

export function validateBoardRecords(schema: TLStore['schema'], records: ReadonlyMap<string, TLRecord>, changedIds?: ReadonlySet<string>): void {
    if (![...records.values()].some(record => record.typeName === 'page')
        || records.get('document:document')?.typeName !== 'document') throw new Error('白板文档或页面缺失')
    const selected = changedIds ? [...changedIds].flatMap(id => records.has(id) ? [[id, records.get(id)!] as const] : []) : records
    for (const [id, record] of selected) {
        if (record.id !== id || !isDocumentRecord(record)) throw new Error('画板记录 ID 或类型不匹配')
        schema.types[record.typeName].validate(record)
        if (record.typeName === 'shape') {
            const visited = new Set([id])
            let parentId: string = record.parentId
            while (true) {
                const parent = records.get(parentId)
                if (!parent || (parent.typeName !== 'page' && parent.typeName !== 'shape')) throw new Error('画板父级引用缺失')
                if (parent.typeName === 'shape' && !['frame', 'group'].includes(parent.type)) throw new Error('画板父级必须是容器')
                if (visited.has(parentId)) throw new Error('画板父级引用形成循环')
                if (parent.typeName === 'page') break
                visited.add(parentId)
                parentId = parent.parentId
            }
            if ('assetId' in record.props && record.props.assetId
                && records.get(String(record.props.assetId))?.typeName !== 'asset') throw new Error('画板资源引用缺失')
        }
        if (record.typeName === 'binding'
            && (records.get(record.fromId)?.typeName !== 'shape' || records.get(record.toId)?.typeName !== 'shape')) {
            throw new Error('画板绑定引用缺失')
        }
    }
}

export function readBoardState(root: Y.Map<Y.Map<unknown>>, schema: TLStore['schema']) {
    const all = new Map<string, TLRecord>(), explicit = new Set<string>()
    for (const [id, value] of root) {
        const record = decodeYRecord(value)
        if (record.id !== id || typeof value.get('keep') !== 'boolean') throw new Error('画板记录身份或存在标记无效')
        schema.types[record.typeName].validate(record)
        all.set(id, record)
        if (value.get('keep')) explicit.add(id)
    }
    const visible = new Map<string, TLRecord>(), pending = [...explicit]
    while (pending.length) {
        const id = pending.pop()!
        if (visible.has(id)) continue
        const record = all.get(id)
        if (!record) throw new Error('画板依赖记录缺失')
        visible.set(id, record)
        pending.push(...recordReferences(record))
    }
    validateBoardRecords(schema, visible)
    return { all, explicit, visible }
}
