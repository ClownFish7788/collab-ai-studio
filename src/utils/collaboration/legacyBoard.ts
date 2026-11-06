import { DocumentRecordType, PageRecordType } from '@tldraw/tlschema'
import { getIndexAbove, isEqual } from '@tldraw/utils'
import type { RecordsDiff, TLRecord, TLStore } from 'tldraw'
import type * as Y from 'yjs'
import { validateBoardRecords } from './bindTldrawYjs'
import { BOARD_META, readLegacyBoard } from './tldrawYjsMigration'
import { isDocumentRecord } from './tldrawYjsRecords'

export function canLoadBoard(doc: Y.Doc, cloudSynced: boolean): boolean {
    return cloudSynced || doc.getMap(BOARD_META).get('format') === 2 || doc.getArray('tl_records').length > 0
}

export function bindLegacyBoardReadOnly(store: TLStore, doc: Y.Doc, onError: (error: Error | null) => void = () => {}): () => void {
    const legacy = doc.getArray('tl_records')
    const update = () => {
        try {
            const old = readLegacyBoard(doc)
            const values = old.length ? old : [
                DocumentRecordType.create({ id: DocumentRecordType.createId('document') }),
                PageRecordType.create({ id: PageRecordType.createId('page'), name: 'Page 1', index: getIndexAbove(null) }),
            ]
            const records = new Map(values.map(value => [value.id, value]))
            validateBoardRecords(store.schema, records)
            const diff: RecordsDiff<TLRecord> = { added: {}, updated: {}, removed: {} }
            for (const record of store.allRecords()) {
                if (isDocumentRecord(record) && !records.has(record.id)) diff.removed[record.id] = record
            }
            for (const record of values) {
                const before = store.get(record.id)
                if (!before) diff.added[record.id] = record
                else if (!isEqual(before, record)) diff.updated[record.id] = [before, record]
            }
            // This display-only store has no outgoing binding; suppress derived document edits too.
            store.applyDiff(diff, { runCallbacks: false })
            onError(null)
        } catch (cause) { onError(cause instanceof Error ? cause : new Error(String(cause))) }
    }
    update()
    legacy.observe(update)
    return () => legacy.unobserve(update)
}
