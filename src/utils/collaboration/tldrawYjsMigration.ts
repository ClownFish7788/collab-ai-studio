import { DocumentRecordType, PageRecordType } from '@tldraw/tlschema'
import { getIndexAbove, isEqual } from '@tldraw/utils'
import type { TLRecord, TLStore } from 'tldraw'
import * as Y from 'yjs'
import { validateBoardRecords } from './bindTldrawYjs'
import { createYRecord, decodeYRecord, isDocumentRecord } from './tldrawYjsRecords'

export const BOARD_RECORDS = 'tl_records_v2'
export const BOARD_META = 'tl_records_meta'

export function readLegacyBoard(doc: Y.Doc): TLRecord[] {
    const logical = new Map<string, TLRecord>()
    for (const { key, val } of doc.getArray<{ key: string; val: TLRecord }>('tl_records').toArray()) {
        if (!val || val.id !== key || !isDocumentRecord(val)) throw new Error('旧白板记录损坏，保留原始数据后检查')
        logical.set(key, val)
    }
    return [...logical.values()]
}

export function assertBoardV2(doc: Y.Doc, schema: TLStore['schema']): void {
    const meta = doc.getMap(BOARD_META)
    if (meta.get('format') !== 2) throw new Error('白板尚未完成升级，请保留数据并完成受控迁移')
    if (!isEqual(meta.get('schema'), schema.serialize())) throw new Error('白板数据版本不兼容，需要受控升级')
    const values = new Map([...doc.getMap<Y.Map<unknown>>(BOARD_RECORDS)].map(([id, record]) => [id, decodeYRecord(record)]))
    validateBoardRecords(schema, values)
}

/** The caller must hold exclusive initialization/migration rights before entering this function. */
export function initializeBoardV2(doc: Y.Doc, schema: TLStore['schema'], { allowLegacy }: { allowLegacy: boolean }): number {
    const meta = doc.getMap(BOARD_META), root = doc.getMap<Y.Map<unknown>>(BOARD_RECORDS)
    if (meta.get('format') === 2) { assertBoardV2(doc, schema); return 0 }
    if (root.size || meta.has('format')) throw new Error('发现未完成或不兼容的升级，请保留数据后恢复')
    const old = readLegacyBoard(doc)
    if (old.length && !allowLegacy) throw new Error('旧白板需要受控迁移，不能自动升级')
    const values = old.length ? old : [
        DocumentRecordType.create({ id: DocumentRecordType.createId('document') }),
        PageRecordType.create({ id: PageRecordType.createId('page'), name: 'Page 1', index: getIndexAbove(null) }),
    ]
    validateBoardRecords(schema, new Map(values.map(record => [record.id, record])))
    const encoded = values.map(record => [record.id, createYRecord(record)] as const)
    doc.transact(() => {
        for (const [id, record] of encoded) root.set(id, record)
        meta.set('schema', schema.serialize())
        meta.set('format', 2)
    }, 'board-initialization')
    return values.length
}
