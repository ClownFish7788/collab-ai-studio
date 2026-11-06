import { isEqual } from '@tldraw/utils'
import type { RecordsDiff, TLRecord, TLStore } from 'tldraw'
import * as Y from 'yjs'
import { createYRecord, decodeYRecord, isDocumentRecord, prepareYRecordPatch } from './tldrawYjsRecords'

const bindingErrors = new WeakMap<TLStore, () => Error | null>()

export function flushBoardChanges(store: TLStore): void {
    store._flushHistory()
    const error = bindingErrors.get(store)?.()
    if (error) throw error
}

function references(record: TLRecord | undefined): string[] {
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

export function bindTldrawYjs(
    store: TLStore,
    records: Y.Map<Y.Map<unknown>>,
    onError: (error: Error | null, source?: 'read' | 'write') => void = () => {},
    canWrite: () => boolean = () => true,
) {
    const doc = records.doc
    if (!doc) throw new Error('画板共享记录尚未接入文档')
    const origin = {}
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

    function apply(ids: Set<string>) {
        if (protocolError) throw protocolError
        const next = new Map(current)
        for (const id of ids) {
            const value = records.get(id)
            if (value) next.set(id, decodeYRecord(value))
            else next.delete(id)
        }
        validateChanges(next, ids)
        applyingRemote = true
        derivedIds = new Set()
        try {
            if (!current.size) {
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
        if (error) { error = null; onError(null, 'read') }
    }

    apply(new Set(records.keys()))
    const undoManager = new Y.UndoManager(records, {
        trackedOrigins: new Set([origin]), captureTimeout: Infinity, ignoreRemoteMapChanges: false,
    })

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
            apply(error ? new Set([...records.keys(), ...current.keys()]) : ids)
        } catch (cause) { report(cause) }
    }
    records.observeDeep(changed)
    const legacy = doc.getArray('tl_records')
    const legacyChanged = () => {
        protocolError = new Error('检测到旧版本仍在修改白板，已暂停编辑；请导出备份后恢复')
        report(protocolError)
    }
    legacy.observe(legacyChanged)

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
            pendingFootprint = new Set()
            doc.transact(() => {
                for (const [id, value] of created) records.set(id, value)
                for (const patch of patches) patch()
                for (const value of removed) records.delete(value.id)
            }, origin)
            current = next
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
            validateBoardRecords(store.schema, new Map([...root].map(([id, value]) => [id, decodeYRecord(value)])))
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
            undoManager.destroy()
            if (bindingErrors.get(store) === getError) bindingErrors.delete(store)
        },
    }
}

export type TldrawYjsBinding = ReturnType<typeof bindTldrawYjs>
