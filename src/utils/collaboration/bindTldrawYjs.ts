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
    store: TLStore,
    records: Y.Map<Y.Map<unknown>>,
    onError: (error: Error | null) => void = () => {},
) {
    const doc = records.doc
    if (!doc) throw new Error('画板共享记录尚未接入文档')
    const origin = {}
    let error: Error | null = null
    let disposed = false
    let current = new Map<string, TLRecord>()
    const remoteVersions = new Map<string, number>()
    let pendingFootprint = new Set<string>()
    const undoManager = new Y.UndoManager(records, {
        trackedOrigins: new Set([origin]),
        captureTimeout: Infinity,
        ignoreRemoteMapChanges: false,
    })
    const unit = (id: string, ...path: string[]) => JSON.stringify([id, ...path])
    const version = (key: string) => remoteVersions.get(key) ?? 0

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
        const ids = new Set<string>()
        const touched = new Set<string>()
        const wholeRecords = new Set<string>()
        for (const event of events) {
            if (!(event instanceof Y.YMapEvent)) continue
            if (event.target === records) {
                for (const id of event.keysChanged) {
                    ids.add(id)
                    touched.add(unit(id, 'root'))
                    touched.add(unit(id, 'record'))
                    wholeRecords.add(unit(id, 'record'))
                }
            } else {
                const [id, ...path] = event.path
                if (typeof id !== 'string') continue
                ids.add(id)
                touched.add(unit(id, 'record'))
                wholeRecords.add(unit(id, 'root'))
                for (const key of event.keysChanged) {
                    const field = unit(id, 'field', ...path.map(String), key)
                    touched.add(field)
                    wholeRecords.add(field)
                }
            }
        }
        if (transaction.origin === origin || transaction.origin === undoManager) {
            pendingFootprint = wholeRecords
        } else {
            for (const key of touched) remoteVersions.set(key, version(key) + 1)
            undoManager.stopCapturing()
        }
        if (transaction.origin === origin) return
        try {
            // Re-read the full root after an invalid batch so later repairs can recover the view.
            apply(error ? new Set([...records.keys(), ...current.keys()]) : ids)
        } catch (cause) { report(cause) }
    }
    records.observeDeep(changed)

    function capture({ stackItem }: { stackItem: Y.UndoManager['undoStack'][number] }) {
        const footprint: Map<string, number> = stackItem.meta.get('board-footprint') ?? new Map()
        for (const key of pendingFootprint) footprint.set(key, version(key))
        stackItem.meta.set('board-footprint', footprint)
    }
    undoManager.on('stack-item-added', capture)
    undoManager.on('stack-item-updated', capture)

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
            pendingFootprint = new Set()
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

    function canReplay(step: Y.UndoManager['undoStack'][number]): boolean {
        const footprint: Map<string, number> | undefined = step.meta.get('board-footprint')
        return !disposed && !error && !!footprint && [...footprint].every(([key, expected]) => version(key) === expected)
    }

    function replay(direction: 'undo' | 'redo'): boolean {
        if (disposed || error) return false
        const stack = direction === 'undo' ? undoManager.undoStack : undoManager.redoStack
        const step = stack.at(-1)
        if (!step || !canReplay(step)) return false
        pendingFootprint = new Set()
        undoManager.stopCapturing()
        undoManager[direction]()
        return true
    }

    return {
        undoManager,
        canReplay,
        get error() { return error },
        undo: () => replay('undo'),
        redo: () => replay('redo'),
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
