import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRoom, useStatus } from '@liveblocks/react'
import type { LiveblocksYjsProvider } from '@liveblocks/yjs'
import type { JsonObject } from '@liveblocks/client'
import { IndexeddbPersistence, storeState } from 'y-indexeddb'
import * as Y from 'yjs'
import {
    atom, createPresenceStateDerivation, createTLStore, defaultShapeUtils,
    InstancePresenceRecordType, react, type TLAnyShapeUtilConstructor, type TLInstancePresence,
} from 'tldraw'
import useNetworkStore from '@/app/store/useNetworkStore'
import CustomBoradcastChannel from '@/utils/collaboration/BoradcastChannelProvider'
import { bindTldrawYjs, type TldrawYjsBinding } from '@/utils/collaboration/bindTldrawYjs'
import { assertBoard, BOARD_FORMAT, BOARD_META, BOARD_RECORDS } from '@/utils/collaboration/tldrawYjsMigration'
import { bindLegacyBoardReadOnly, canLoadBoard } from '@/utils/collaboration/legacyBoard'
import type { BoardYjsStoreState } from './boardYjsStoreState'
import { toast } from '@/components/Toast'

export function useOnlineYjsStore(yDoc: Y.Doc, provider: LiveblocksYjsProvider, {
    shapeUtils = [], user, canEdit,
}: {
    shapeUtils?: TLAnyShapeUtilConstructor[]
    user: { id: string; name: string; color: string }
    canEdit: boolean
}) {
    const room = useRoom()
    const connection = useStatus()
    const permission = useRef(canEdit)
    const verifiedWrite = useRef(false)
    const [preferences] = useState(() => atom('board-user', user))
    useLayoutEffect(() => {
        permission.current = canEdit
        const self = room.getSelf()
        if (!canEdit) verifiedWrite.current = false
        else if (self) verifiedWrite.current = self.canWrite
        preferences.set(user)
    }, [canEdit, connection, preferences, room, user])
    const isOpenNetwork = useNetworkStore(state => state.isOpenNetwork)
    const [store] = useState(() => createTLStore({ shapeUtils: [...defaultShapeUtils, ...shapeUtils] }))
    const [state, setState] = useState<BoardYjsStoreState>({ status: 'loading' })

    useEffect(() => {
        if (isOpenNetwork) room.connect()
        else room.disconnect()
        if (!isOpenNetwork) return
        const channel = new CustomBoradcastChannel(room.id, yDoc)
        return () => channel.destroy()
    }, [isOpenNetwork, room, yDoc])

    useEffect(() => {
        let disposed = false, localLoaded = false
        let binding: TldrawYjsBinding | undefined
        let stopLegacy: (() => void) | undefined
        let presenceStarted = false
        const persistence = new IndexeddbPersistence(`room-${room.id}`, yDoc)
        const unsubs: (() => void)[] = []
        const fail = (cause: unknown) => {
            if (!disposed) setState({ status: 'error', error: cause instanceof Error ? cause : new Error(String(cause)) })
        }
        const ready = () => {
            if (!disposed) setState({ store, binding, readOnly: !binding, status: 'synced-remote',
                connectionStatus: room.getStatus() === 'connected' ? 'online' : 'offline' })
        }

        function startPresence() {
            if (presenceStarted) return
            presenceStarted = true
            const presenceId = InstancePresenceRecordType.createId(provider.awareness.doc.clientID.toString())
            const presence = createPresenceStateDerivation(preferences, presenceId)(store)
            unsubs.push(react('board-presence', () => {
                const value = presence.get()
                const payload = value ? {
                    ...value, selectedShapeIds: value.selectedShapeIds.length > 10 ? [] : value.selectedShapeIds,
                } : null
                // tldraw's JSON-safe presence interfaces lack Liveblocks' JSON index signature.
                provider.awareness.setLocalStateField('presence', payload as unknown as JsonObject | null)
            }))
            const updatePresence = (update: { added: number[]; updated: number[]; removed: number[] }) => {
                const states = provider.awareness.getStates() as Map<number, { presence?: TLInstancePresence }>
                const toPut = [...update.added, ...update.updated].flatMap(id => {
                    const value = states.get(id)?.presence
                    return value && value.id !== presenceId ? [value] : []
                })
                const toRemove = update.removed.map(id => InstancePresenceRecordType.createId(String(id)))
                store.mergeRemoteChanges(() => {
                    if (toRemove.length) store.remove(toRemove)
                    if (toPut.length) store.put(toPut)
                })
            }
            provider.awareness.on('change', updatePresence)
            unsubs.push(() => provider.awareness.off('change', updatePresence))
            updatePresence({ added: [...provider.awareness.getStates().keys()], updated: [], removed: [] })
        }

        function start() {
            if (disposed || binding || !localLoaded) return
            // A valid cache is usable offline; an empty cache must await the authoritative cloud snapshot.
            if (!canLoadBoard(yDoc, provider.synced)) return
            try {
                if (yDoc.getMap(BOARD_META).get('format') !== BOARD_FORMAT) {
                    if (!stopLegacy) {
                        stopLegacy = bindLegacyBoardReadOnly(store, yDoc, error => { if (error) fail(error); else ready() })
                        startPresence()
                    }
                    return
                }
                stopLegacy?.()
                stopLegacy = undefined
                assertBoard(yDoc, store.schema)
                binding = bindTldrawYjs(store, yDoc.getMap(BOARD_RECORDS), (error, source) => {
                    if (source === 'write') { if (error) toast.show(error.message); return }
                    if (error) fail(error); else ready()
                }, () => permission.current && verifiedWrite.current && room.getSelf()?.canWrite !== false)

                startPresence()
                ready()
            } catch (cause) { fail(cause) }
        }
        yDoc.getMap(BOARD_META).observe(start)
        unsubs.push(() => yDoc.getMap(BOARD_META).unobserve(start))
        provider.on('sync', start)
        unsubs.push(() => provider.off('sync', start))
        void persistence.whenSynced.then(() => { localLoaded = true; start() }).catch(fail)
        const beforeUnload = () => { void storeState(persistence).catch(fail) }
        window.addEventListener('beforeunload', beforeUnload)
        return () => {
            disposed = true
            window.removeEventListener('beforeunload', beforeUnload)
            unsubs.forEach(unsubscribe => unsubscribe())
            stopLegacy?.()
            binding?.dispose()
            provider.awareness.setLocalStateField('presence', null)
            void persistence.destroy()
        }
    }, [preferences, provider, room, store, yDoc])

    const connectionStatus: 'online' | 'offline' = connection === 'connected' ? 'online' : 'offline'
    const visibleState: BoardYjsStoreState = state.status === 'synced-remote' ? { ...state, connectionStatus } : state
    return { ...visibleState, backup: () => Y.encodeStateAsUpdate(yDoc) }
}
