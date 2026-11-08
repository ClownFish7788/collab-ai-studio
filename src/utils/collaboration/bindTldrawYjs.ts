import { isEqual } from '@tldraw/utils'
import { atom, type RecordsDiff, type TLRecord, type TLStore } from 'tldraw'
import * as Y from 'yjs'
import { createYRecord, decodeYRecord, isDocumentRecord, prepareYRecordPatch } from './tldrawYjsRecords'
import { readBoardState, recordReferences as references, validateBoardRecords } from './tldrawYjsState'
export { validateBoardRecords } from './tldrawYjsState'
import { assertBoard, BOARD_META } from './tldrawYjsMigration'

const bindingErrors = new WeakMap<TLStore, () => Error | null>()

export function flushBoardChanges(store: TLStore): void {
    store._flushHistory()
    const error = bindingErrors.get(store)?.()
    if (error) throw error
}

export function bindTldrawYjs(
    store: TLStore,
    records: Y.Map<Y.Map<unknown>>,
    onError: (error: Error | null, source?: 'read' | 'write') => void = () => {},
    canWrite: () => boolean = () => true,
) {
    const doc = records.doc
    if (!doc) throw new Error('画板共享记录尚未接入文档')
    assertBoard(doc, store.schema)
    const origin = {}, materializationOrigin = {}
    const retainedRecords = atom<readonly string[]>('board-retained-records', [])
    let error: Error | null = null
    let writeError: Error | null = null
    let protocolError: Error | null = null
    let applyingRemote = false
    let derivedIds = new Set<string>()
    let disposed = false
    let current = new Map<string, TLRecord>()
    const remoteVersions = new Map<string, number>()
    let pendingFootprint = new Set<string>()
    const unit = (id: string, ...path: string[]) => JSON.stringify([id, ...path])
    const version = (key: string) => remoteVersions.get(key) ?? 0

    function report(cause: unknown) {
        error = cause instanceof Error ? cause : new Error(String(cause))
        onError(error, 'read')
    }

    function restore(ids: Iterable<string>, values: ReadonlyMap<string, TLRecord>) {
        const previous = applyingRemote
        applyingRemote = true
        try {
            const diff: RecordsDiff<TLRecord> = { added: {}, updated: {}, removed: {} }
            for (const id of ids) {
                const record = values.get(id), before = store.get(id as TLRecord['id'])
                if (isEqual(record, before)) continue
                if (record && before) diff.updated[record.id] = [before, record]
                else if (record) diff.added[record.id] = record
                else if (before) diff.removed[before.id] = before
            }
            store.applyDiff(diff, { runCallbacks: false })
            store._flushHistory()
        } finally { applyingRemote = previous }
    }

    function validateChanges(next: ReadonlyMap<string, TLRecord>, ids: ReadonlySet<string>) {
        const structural = [...ids].some(id => {
            const before = current.get(id), after = next.get(id)
            return !before || !after || before.typeName !== after.typeName
                || ('type' in before && (!('type' in after) || before.type !== after.type))
                || !isEqual(references(before), references(after))
        })
        validateBoardRecords(store.schema, next, structural ? undefined : ids)
    }

    function apply(local = false) {
        if (protocolError) throw protocolError
        const state = readBoardState(records, store.schema)
        const next = state.visible
        const ids = new Set([...current.keys(), ...next.keys()])
        applyingRemote = true
        derivedIds = new Set()
        try {
            if (!current.size || local) {
                const initialIds = new Set([...ids, ...store.allRecords().filter(isDocumentRecord).map(value => value.id)])
                restore(initialIds, next)
            } else store.mergeRemoteChanges(() => {
                const removed = store.allRecords().filter(record => isDocumentRecord(record) && !next.has(record.id))
                if (removed.length) store.remove(removed.map(record => record.id))
                const changed = [...ids].flatMap(id => {
                    const record = next.get(id)
                    return record && !isEqual(record, store.get(record.id)) ? [record] : []
            })
            if (changed.length) store.put(changed)
            })
            store._flushHistory()
            if (derivedIds.size) restore(derivedIds, next)
        } finally { applyingRemote = false }
        current = next
        const retained = [...next.keys()].filter(id => !state.explicit.has(id)).sort()
        if (!isEqual(retainedRecords.get(), retained)) retainedRecords.set(retained)
        if (error) { error = null; onError(null, 'read') }
    }

    apply()
    const undoManager = new Y.UndoManager(records, {
        trackedOrigins: new Set([origin]), captureTimeout: Infinity, ignoreRemoteMapChanges: false,
    })

    function changed(events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) {
        if (transaction.origin === materializationOrigin) return
        const ids = new Set<string>()
        const touched = new Set<string>()
        const wholeRecords = new Set<string>()
        for (const event of events) {
            if (!(event instanceof Y.YMapEvent)) continue
            if (event.target === records) {
                if ([...event.changes.keys.values()].some(change => change.action !== 'add')) {
                    protocolError = new Error('共享记录被删除或替换，已暂停编辑；请导出备份后恢复')
                    report(protocolError)
                    return
                }
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
                wholeRecords.add(unit(id, 'existence'))
                for (const key of event.keysChanged) {
                    if (!path.length && key === 'keep') {
                        touched.add(unit(id, 'existence'))
                        wholeRecords.add(unit(id, 'record'))
                    }
                    const field = unit(id, 'field', ...path.map(String), key)
                    touched.add(field)
                    wholeRecords.add(field)
                }
            }
        }
        if (transaction.origin === origin || transaction.origin === undoManager) {
            for (const id of ids) {
                const value = records.get(id)
                for (const ref of new Set([...references(current.get(id)), ...references(value ? decodeYRecord(value) : undefined)])) {
                    wholeRecords.add(unit(ref, 'root'))
                }
            }
            pendingFootprint = wholeRecords
        } else {
            for (const key of touched) remoteVersions.set(key, version(key) + 1)
        }
        if (transaction.origin === origin) return
        try {
            // Re-read the full root after an invalid batch so later repairs can recover the view.
            apply()
        } catch (cause) { report(cause) }
    }
    records.observeDeep(changed)
    const legacy = doc.getArray('tl_records')
    const previousRecords = doc.getMap('tl_records_v2')
    const legacyChanged = () => {
        protocolError = new Error('检测到旧版本仍在修改白板，已暂停编辑；请导出备份后恢复')
        report(protocolError)
    }
    legacy.observe(legacyChanged)
    previousRecords.observeDeep(legacyChanged)
    const metadata = doc.getMap(BOARD_META)
    const metadataChanged = () => {
        try { assertBoard(doc, store.schema) }
        catch (cause) { protocolError = cause instanceof Error ? cause : new Error(String(cause)); report(protocolError) }
    }
    metadata.observe(metadataChanged)

    function capture({ stackItem }: { stackItem: Y.UndoManager['undoStack'][number] }) {
        const footprint: Map<string, number> = stackItem.meta.get('board-footprint') ?? new Map()
        for (const key of pendingFootprint) if (!footprint.has(key)) footprint.set(key, version(key))
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
        const ids = new Set([...added, ...updated.map(([, after]) => after), ...removed].map(record => record.id))
        if (applyingRemote) { for (const id of ids) derivedIds.add(id); return }
        try {
            if (!canWrite()) throw new Error('当前没有白板编辑权限')
            const next = new Map(current)
            for (const record of [...added, ...updated.map(([, after]) => after)]) next.set(record.id, record)
            for (const record of removed) next.delete(record.id)
            validateChanges(next, ids)
            const patches: (() => void)[] = []
            for (const [before, after] of updated) {
                if (!records.has(before.id)) throw new Error('图形已被删除，不能通过更新恢复')
                store.schema.validateRecord(store, after, 'updateRecord', before)
                patches.push(prepareYRecordPatch(records.get(after.id)!, before, after))
            }
            for (const value of added) {
                if (records.has(value.id)) throw new Error('新增画板记录 ID 冲突')
                store.schema.validateRecord(store, value, 'createRecord', null)
            }
            const created = added.map(value => [value.id, createYRecord(value)] as const)
            // Keep payload insertion outside user history; undo only changes its existence intent.
            if (created.length) doc.transact(() => {
                for (const [id, value] of created) records.set(id, value)
            }, materializationOrigin)
            pendingFootprint = new Set()
            doc.transact(() => {
                for (const [id] of created) records.get(id)!.set('keep', true)
                for (const patch of patches) patch()
                for (const value of removed) records.get(value.id)!.set('keep', false)
            }, origin)
            apply(true)
            writeError = null
        } catch (cause) {
            writeError = cause instanceof Error ? cause : new Error(String(cause))
            restore(ids, current)
            onError(writeError, 'write')
        }
    }, { source: 'user', scope: 'document' })
    const unflush = store.sideEffects.registerOperationCompleteHandler(() => store._flushHistory())

    function canReplay(step: Y.UndoManager['undoStack'][number], direction: 'undo' | 'redo' = 'undo'): boolean {
        const footprint: Map<string, number> | undefined = step.meta.get('board-footprint')
        if (disposed || error || !canWrite() || !footprint || [...footprint].some(([key, expected]) => version(key) !== expected)) return false
        const fork = new Y.Doc({ gc: false })
        let history: Y.UndoManager | undefined
        try {
            Y.applyUpdate(fork, Y.encodeStateAsUpdate(doc!))
            const root = fork.getMap<Y.Map<unknown>>(Y.findRootTypeKey(records))
            history = new Y.UndoManager(root, { ignoreRemoteMapChanges: false })
            const stack = direction === 'undo' ? history.undoStack : history.redoStack
            stack.push({ insertions: step.insertions, deletions: step.deletions, meta: new Map() })
            history[direction]()
            const before = readBoardState(records, store.schema)
            const after = readBoardState(root, store.schema)
            // Projection must not hide a conflict with dependencies already received.
            if ([...before.explicit].some(id => !after.explicit.has(id) && after.visible.has(id))) return false
            return true
        } catch { return false }
        finally { history?.destroy(); fork.destroy() }
    }

    function replay(direction: 'undo' | 'redo'): boolean {
        if (disposed || error) return false
        const stack = direction === 'undo' ? undoManager.undoStack : undoManager.redoStack
        const step = stack.at(-1)
        if (!step || !canReplay(step, direction)) return false
        pendingFootprint = new Set()
        undoManager.stopCapturing()
        // Yjs skips empty entries; isolate this one so it cannot reach an unchecked older step.
        const older = stack.slice(0, -1)
        const key = direction === 'undo' ? 'undoStack' : 'redoStack'
        undoManager[key] = [step]
        try { undoManager[direction]() }
        finally { undoManager[key] = older.concat(undoManager[key]) }
        return true
    }

    const getError = () => error ?? writeError
    bindingErrors.set(store, getError)
    return {
        undoManager,
        retainedRecords,
        canReplay,
        get error() { return getError() },
        undo: () => replay('undo'),
        redo: () => replay('redo'),
        dispose() {
            if (disposed) return
            disposed = true
            unlisten()
            unflush()
            records.unobserveDeep(changed)
            legacy.unobserve(legacyChanged)
            previousRecords.unobserveDeep(legacyChanged)
            metadata.unobserve(metadataChanged)
            undoManager.destroy()
            if (bindingErrors.get(store) === getError) bindingErrors.delete(store)
        },
    }
}

export type TldrawYjsBinding = ReturnType<typeof bindTldrawYjs>
