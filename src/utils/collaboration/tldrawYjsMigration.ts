import { DocumentRecordType, PageRecordType } from '@tldraw/tlschema'
import { getIndexAbove, isEqual } from '@tldraw/utils'
import type { TLRecord, TLStore } from 'tldraw'
import * as Y from 'yjs'
import { readBoardState, validateBoardRecords } from './tldrawYjsState'
import { createYRecord, decodeYRecord, isDocumentRecord } from './tldrawYjsRecords'

export const BOARD_FORMAT = 3
export const BOARD_RECORDS = 'tl_records_v3'
export const BOARD_META = 'tl_records_meta'

export function readLegacyBoard(doc: Y.Doc): TLRecord[] {
    const logical = new Map<string, TLRecord>()
    for (const { key, val } of doc.getArray<{ key: string; val: TLRecord }>('tl_records').toArray()) {
        if (!val || val.id !== key || !isDocumentRecord(val)) throw new Error('旧白板记录损坏，保留原始数据后检查')
        logical.set(key, val)
    }
    return [...logical.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function readPreviousBoard(doc: Y.Doc, schema: TLStore['schema']): TLRecord[] {
    const format = doc.getMap(BOARD_META).get('format')
    if (format !== undefined && format !== 1 && format !== 2) throw new Error('白板数据版本不兼容，需要受控升级')
    const values = format === 2
        ? [...doc.getMap<Y.Map<unknown>>('tl_records_v2')].map(([id, value]) => {
            const record = decodeYRecord(value)
            if (record.id !== id) throw new Error('画板记录 ID 不匹配')
            return record
        }) : readLegacyBoard(doc)
    if (format === 2 || values.length) validateBoardRecords(schema, new Map(values.map(value => [value.id, value])))
    return values
}

export function assertBoard(doc: Y.Doc, schema: TLStore['schema']): void {
    const meta = doc.getMap(BOARD_META)
    if (meta.get('format') !== BOARD_FORMAT) throw new Error('白板尚未完成升级，请保留数据并完成受控迁移')
    if (!isEqual(meta.get('schema'), schema.serialize())) throw new Error('白板数据版本不兼容，需要受控升级')
    if (!isEqual(meta.get('legacyBaseline'), readLegacyBoard(doc))
        || !isEqual(meta.get('v2Baseline'), doc.getMap('tl_records_v2').toJSON())) {
        throw new Error('检测到旧版本迟到修改，请导出备份后恢复')
    }
    readBoardState(doc.getMap(BOARD_RECORDS), schema)
}

/** The caller must hold exclusive initialization/migration rights before entering this function. */
export function initializeBoard(doc: Y.Doc, schema: TLStore['schema'], { allowLegacy }: { allowLegacy: boolean }): number {
    const meta = doc.getMap(BOARD_META), root = doc.getMap<Y.Map<unknown>>(BOARD_RECORDS)
    if (meta.get('format') === BOARD_FORMAT) { assertBoard(doc, schema); return 0 }
    if (root.size) throw new Error('发现未完成的升级，请保留数据后恢复')
    const format = meta.get('format')
    const old = readPreviousBoard(doc, schema)
    if ((old.length || format !== undefined) && !allowLegacy) throw new Error('旧白板需要受控迁移，不能自动升级')
    if (format === 2 && (!isEqual(meta.get('schema'), schema.serialize())
        || !isEqual(meta.get('legacyBaseline'), readLegacyBoard(doc)))) throw new Error('旧白板版本或基线不兼容')
    if (format !== 2 && doc.getMap('tl_records_v2').size) throw new Error('发现未完成的旧版升级，请先恢复备份')
    const values = old.length ? old : [
        DocumentRecordType.create({ id: DocumentRecordType.createId('document') }),
        PageRecordType.create({ id: PageRecordType.createId('page'), name: 'Page 1', index: getIndexAbove(null) }),
    ]
    validateBoardRecords(schema, new Map(values.map(record => [record.id, record])))
    const encoded = values.map(record => [record.id, createYRecord(record, true)] as const)
    const legacyBaseline = structuredClone(readLegacyBoard(doc))
    const v2Baseline = structuredClone(doc.getMap('tl_records_v2').toJSON())
    doc.transact(() => {
        for (const [id, record] of encoded) root.set(id, record)
        meta.set('schema', schema.serialize())
        meta.set('legacyBaseline', legacyBaseline)
        meta.set('v2Baseline', v2Baseline)
        meta.set('format', BOARD_FORMAT)
    }, 'board-initialization')
    return values.length
}
