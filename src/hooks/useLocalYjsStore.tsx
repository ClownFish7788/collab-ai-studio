import { useEffect, useRef, useState } from 'react'
import { IndexeddbPersistence, fetchUpdates, storeState } from 'y-indexeddb'
import * as Y from 'yjs'
import { createTLStore, defaultShapeUtils } from 'tldraw'
import { bindTldrawYjs, type TldrawYjsBinding } from '@/utils/collaboration/bindTldrawYjs'
import { assertBoard, BOARD_META, BOARD_RECORDS, initializeBoard } from '@/utils/collaboration/tldrawYjsMigration'
import CustomBoradcastChannel from '@/utils/collaboration/BoradcastChannelProvider'
import type { BoardYjsStoreState } from './boardYjsStoreState'
import { toast } from '@/components/Toast'

export function useLocalYjsStore(yDoc: Y.Doc, roomId: string) {
    const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }))
    const [state, setState] = useState<BoardYjsStoreState>({ status: 'loading' })
    const upgrade = useRef<(() => Promise<void>) | null>(null)

    useEffect(() => {
        let disposed = false
        let binding: TldrawYjsBinding | undefined
        const persistence = new IndexeddbPersistence(`room-${roomId}`, yDoc)
        const channel = new CustomBoradcastChannel(roomId, yDoc)
        const fail = (cause: unknown) => {
            if (!disposed) setState({ status: 'error', error: cause instanceof Error ? cause : new Error(String(cause)) })
        }
        const ready = () => {
            if (!disposed) setState({ store, status: 'synced-local', binding })
        }

        async function start(allowLegacy = false) {
            if (binding) throw new Error('此白板已升级，请先导出备份并检查错误')
            await persistence.whenSynced
            if (disposed) return
            if (!navigator.locks) throw new Error('此浏览器不支持安全初始化，请换用支持 Web Locks 的浏览器')
            await navigator.locks.request(`board-init-${roomId}`, async () => {
                if (disposed) return
                await fetchUpdates(persistence)
                if (disposed) return
                initializeBoard(yDoc, store.schema, { allowLegacy })
                await storeState(persistence, true)
            })
            if (disposed) return
            if (binding) return
            assertBoard(yDoc, store.schema)
            binding = bindTldrawYjs(store, yDoc.getMap(BOARD_RECORDS), (error, source) => {
                if (source === 'write') { if (error) toast.show(error.message); return }
                if (error) fail(error); else ready()
            })
            ready()
        }
        void start().catch(fail)
        upgrade.current = () => start(true).catch(fail)
        const beforeUnload = () => { void storeState(persistence).catch(fail) }
        window.addEventListener('beforeunload', beforeUnload)
        return () => {
            disposed = true
            upgrade.current = null
            window.removeEventListener('beforeunload', beforeUnload)
            binding?.dispose()
            channel.destroy()
            void persistence.destroy()
        }
    }, [roomId, store, yDoc])

    const format = yDoc.getMap(BOARD_META).get('format')
    const canUpgrade = state.status === 'error' && (format === undefined || format === 1 || format === 2)
    return { ...state, backup: () => Y.encodeStateAsUpdate(yDoc),
        upgrade: canUpgrade ? () => upgrade.current?.() : undefined }
}
