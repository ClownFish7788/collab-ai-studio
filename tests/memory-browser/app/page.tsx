'use client'

import { useEffect, useRef, useState } from 'react'
import { createShapeId, createTLStore, defaultShapeUtils, Editor, Tldraw, type TLShapePartial } from 'tldraw'
import { getIndexAbove } from '@tldraw/utils'
import { IndexeddbPersistence, storeState } from 'y-indexeddb'
import * as Y from 'yjs'
import { initializeBoardV2, BOARD_RECORDS } from '@/utils/collaboration/tldrawYjsMigration'
import { bindTldrawYjs } from '@/utils/collaboration/bindTldrawYjs'
import { attachTldrawYjsHistory } from '@/utils/collaboration/tldrawYjsHistory'

type BrowserMemory = Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number; breakdown: unknown[] }>
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
}
type Sample = Record<string, unknown>
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const frame = () => new Promise(resolve => requestAnimationFrame(resolve))

function Board({ count }: { count: number }) {
    const [context] = useState(() => {
        const doc = new Y.Doc()
        const value = createTLStore({ shapeUtils: defaultShapeUtils })
        initializeBoardV2(doc, value.schema, { allowLegacy: false })
        const binding = bindTldrawYjs(value, doc.getMap(BOARD_RECORDS))
        const room = `codex-memory-study-${count}-${Date.now()}`
        const persistence = new IndexeddbPersistence(room, doc)
        return { doc, value, binding, persistence, room }
    })
    const editor = useRef<Editor | null>(null)
    const initialized = useRef(false)
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState('mounting')
    const [samples, setSamples] = useState<Sample[]>([])
    const updates = useRef(0)
    useEffect(() => () => {
        context.binding.dispose()
        void context.persistence.destroy()
        context.doc.destroy()
    }, [context])

    async function idbStats() {
        await context.persistence.whenSynced
        const db = context.persistence.db
        if (!db) throw Error('IndexedDB not ready')
        return new Promise<{ records: number; bytes: number }>((resolve, reject) => {
            const transaction = db.transaction('updates', 'readonly')
            const request = transaction.objectStore('updates').getAll()
            transaction.oncomplete = () => resolve({ records: request.result.length,
                bytes: request.result.reduce((sum: number, value: Uint8Array) => sum + value.byteLength, 0) })
            transaction.onerror = () => reject(transaction.error)
        })
    }

    async function settledStorage(force: boolean) {
        if (force) await storeState(context.persistence, true)
        let previous = '', stable = 0
        for (let i = 0; i < 100; i++) {
            const value = await idbStats(), key = JSON.stringify(value)
            stable = key === previous ? stable + 1 : 0; previous = key
            if (i >= 12 && stable >= 4) return value
            await pause(100)
        }
        throw Error('IndexedDB did not settle')
    }

    async function measure(label: string, forceStorage = false) {
        setBusy(true); setStatus(`measuring ${label}`)
        try {
            await document.fonts.ready
            const storage = await settledStorage(forceStorage)
            const encodedBytes = Y.encodeStateAsUpdate(context.doc).byteLength
            const logicalJsonBytes = new TextEncoder().encode(JSON.stringify(context.value.serialize('document'))).byteLength
            await frame(); await frame()
            const perf = performance as BrowserMemory
            let memory: unknown, memoryApi = 'unavailable', timer: ReturnType<typeof setTimeout> | undefined
            try {
                if (perf.measureUserAgentSpecificMemory) {
                    memory = await Promise.race([
                        perf.measureUserAgentSpecificMemory(),
                        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('memory API timeout')), 60000) }),
                    ])
                    memoryApi = 'measureUserAgentSpecificMemory'
                } else memory = { unavailable: true }
            } finally { if (timer) clearTimeout(timer) }
            const native = (editor.current as unknown as { history: { debug(): {
                undos: unknown[]; redos: unknown[]; pendingDiff: { isEmpty: boolean }
            } } }).history.debug()
            if (native.undos.length || native.redos.length || !native.pendingDiff.isEmpty) throw Error('Native history accumulated')
            setSamples(values => [...values, { label, count, updates: updates.current, room: context.room,
                measuredAt: new Date().toISOString(), userAgent: navigator.userAgent,
                crossOriginIsolated, memoryApi, memory, approximateHeap: perf.memory?.usedJSHeapSize,
                encodedBytes, logicalJsonBytes, indexedDbRecords: storage.records, indexedDbPayloadBytes: storage.bytes,
                undoSteps: context.binding.undoManager.undoStack.length, nativeUndo: 0, nativeRedo: 0 }])
            setStatus(`ready ${label}`)
        } catch (error) { setStatus(`ERROR ${String(error)}`) }
        finally { setBusy(false) }
    }

    async function edit() {
        if (!editor.current) return
        setBusy(true)
        try {
            const ed = editor.current, start = performance.now(), target = updates.current + 6000
            for (let i = updates.current; i < target; i++) {
                if (i % 60 === 0) ed.markHistoryStoppingPoint('memory-drag')
                const id = createShapeId(`memory-${Math.floor(i / 60) % count}`)
                const record = ed.getShape(id)!
                ed.updateShapes([{ id, type: 'geo', x: record.x + 1, y: record.y + 1 }])
                if ((i + 1) % 60 === 0) { setStatus(`editing ${i + 1}/${target}`); await frame() }
            }
            updates.current = target
            if (context.binding.error) throw context.binding.error
            setStatus(`edited ${target}, ${(performance.now() - start).toFixed(1)} ms`)
        } catch (error) { setStatus(`ERROR ${String(error)}`) }
        finally { setBusy(false) }
    }

    return <main>
        <h1 style={{ fontSize: 20 }}>Memory research: {count} shapes</h1>
        <p role="status">{status}</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button disabled={busy || !editor.current} onClick={() => void measure('loaded')}>Measure loaded</button>
            <button disabled={busy || !editor.current} onClick={() => void edit()}>Run 6000 updates</button>
            <button disabled={busy || !editor.current} onClick={() => void measure('edited')}>Measure edited</button>
            <button disabled={busy || !editor.current} onClick={() => void measure('checkpoint', true)}>Checkpoint and measure</button>
            <button disabled={busy || !editor.current} onClick={() => { editor.current?.clearHistory(); void measure('history-cleared', true) }}>Clear history and measure</button>
        </div>
        <pre data-testid="results" style={{ maxHeight: 240, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(samples, null, 2)}</pre>
        <div style={{ height: 550, position: 'relative' }}>
            <Tldraw store={context.value} onMount={ed => {
                editor.current = ed
                const detach = attachTldrawYjsHistory(ed, context.binding, () => { throw Error('unexpected conflict') })
                if (!initialized.current) {
                    initialized.current = true
                    let index = getIndexAbove(null)
                    const records: TLShapePartial[] = []
                    for (let i = 0; i < count; i++) {
                        index = getIndexAbove(index)
                        records.push({ id: createShapeId(`memory-${i}`), type: 'geo', index,
                            x: (i % 100) * 120, y: Math.floor(i / 100) * 120,
                            props: { w: 100, h: 100, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{
                                type: 'text', text: `Record ${i}: ` + 'collaborative board label '.repeat(3),
                            }] }] } } })
                    }
                    ed.createShapes(records)
                    ed.clearHistory()
                }
                setStatus('ready')
                return () => { editor.current = null; detach() }
            }} />
        </div>
    </main>
}

export default function Page() {
    const [count, setCount] = useState<number | null>(null)
    return count === null ? <main>
        <h1>Isolated memory research</h1>
        <button onClick={() => setCount(100)}>100 shapes</button>
        <button onClick={() => setCount(4000)}>4000 shapes</button>
    </main> : <Board count={count} />
}
