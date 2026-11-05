import { isEqual } from '@tldraw/utils'
import type { TLRecord, TLStore } from 'tldraw'
import * as Y from 'yjs'
import { createYRecord, decodeYRecord, isDocumentRecord, patchYRecord } from './tldrawYjsRecords'

export function validateBoardRecords(store: TLStore, records: ReadonlyMap<string, TLRecord>): void {
    for (const [id, record] of records) {
        if (record.id !== id || !isDocumentRecord(record)) throw new Error('画板记录 ID 或类型不匹配')
        store.schema.validateRecord(store, record, 'initialize', null)
        if (record.typeName === 'shape') {
            const visited = new Set([id])
            let parentId: string = record.parentId
            while (true) {
                const parent = records.get(parentId)
                if (!parent || (parent.typeName !== 'page' && parent.typeName !== 'shape')) throw new Error('画板父级引用缺失')
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

export function bindTldrawYjs(
    store: TLStore, records: Y.Map<Y.Map<unknown>>, onError: (error: Error | null) => void = () => {},
) {
    const doc = records.doc
    if (!doc) throw new Error('画板共享记录尚未接入文档')
    const origin = {}
    const undoManager = new Y.UndoManager(records, { trackedOrigins: new Set([origin]), captureTimeout: Infinity, ignoreRemoteMapChanges: false })
    let error: Error | null = null
    let disposed = false
    let current = new Map<string, TLRecord>()

    function report(cause: unknown) {
        error = cause instanceof Error ? cause : new Error(String(cause))
        onError(error)
    }

    function apply(ids: Set<string>) {
        const next = new Map(current)
        for (const id of ids) {
            const value = records.get(id)
            if (value) next.set(id, decodeYRecord(value))
            else next.delete(id)
        }
        validateBoardRecords(store, next)
        store.mergeRemoteChanges(() => {
            const removed = store.allRecords().filter(record => isDocumentRecord(record) && !next.has(record.id))
            if (removed.length) store.remove(removed.map(record => record.id))
            const changed = [...ids].flatMap(id => {
                const record = next.get(id)
                return record && !isEqual(record, store.get(record.id)) ? [record] : []
            })
            if (changed.length) store.put(changed)
        })
        current = next
        if (error) { error = null; onError(null) }
    }

    apply(new Set(records.keys()))

    function changed(events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) {
        if (transaction.origin === origin) return
        const ids = new Set<string>()
        for (const event of events) {
            if (event.target === records && event instanceof Y.YMapEvent) {
                for (const id of event.keysChanged) ids.add(id)
            } else if (typeof event.path[0] === 'string') ids.add(event.path[0])
        }
        try {
            apply(error ? new Set([...records.keys(), ...current.keys()]) : ids)
        } catch (cause) { report(cause) }
    }
    records.observeDeep(changed)

    const unlisten = store.listen(({ changes }) => {
        if (disposed || error) return
        const added = Object.values(changes.added).filter(isDocumentRecord)
        const updated = Object.values(changes.updated).filter(([, after]) => isDocumentRecord(after))
        const removed = Object.values(changes.removed).filter(isDocumentRecord)
        if (!added.length && !updated.length && !removed.length) return
        try {
            for (const [before, after] of updated) {
                if (!records.has(before.id)) throw new Error('图形已被删除，不能通过更新恢复')
                store.schema.validateRecord(store, after, 'updateRecord', before)
            }
            for (const value of added) {
                if (records.has(value.id)) throw new Error('新增画板记录 ID 冲突')
                store.schema.validateRecord(store, value, 'createRecord', null)
            }
            doc.transact(() => {
                for (const value of added) records.set(value.id, createYRecord(value))
                for (const [before, after] of updated) patchYRecord(records.get(after.id)!, before, after)
                for (const value of removed) records.delete(value.id)
            }, origin)
            for (const value of [...added, ...updated.map(([, after]) => after)]) current.set(value.id, value)
            for (const value of removed) current.delete(value.id)
        } catch (cause) { report(cause) }
    }, { source: 'user', scope: 'document' })
    const unflush = store.sideEffects.registerOperationCompleteHandler(() => store._flushHistory())

    return {
        undoManager,
        undo: () => { undoManager.stopCapturing(); undoManager.undo(); return true },
        redo: () => { undoManager.stopCapturing(); undoManager.redo(); return true },
        get error() { return error },
        dispose() {
            if (disposed) return
            disposed = true
            unlisten()
            unflush()
            records.unobserveDeep(changed)
            undoManager.destroy()
        },
    }
}
export type TldrawYjsBinding = ReturnType<typeof bindTldrawYjs>
