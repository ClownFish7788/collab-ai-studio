import type { Liveblocks } from '@liveblocks/node'
import { createTLSchema } from '@tldraw/tlschema'
import * as Y from 'yjs'
import { assertBoardV2, initializeBoardV2 } from '@/utils/collaboration/tldrawYjsMigration'

type RoomClient = Pick<Liveblocks, 'createRoom' | 'getRoom' | 'deleteRoom' | 'sendYjsBinaryUpdate' | 'getYjsDocumentAsBinaryUpdate' | 'updateRoom'>

export async function createBoardRoom<T>(client: RoomClient, roomId: string, ownerId: string, publish: () => Promise<T>): Promise<T> {
    let created = false, publishing = false
    try {
        await client.createRoom(roomId, { defaultAccesses: [],
            metadata: { boardProtocol: 'initializing', boardBootstrapOwner: ownerId } })
        created = true
    } catch (cause) {
        if (!cause || typeof cause !== 'object' || !('status' in cause) || cause.status !== 409) throw cause
        const room = await client.getRoom(roomId)
        if (room.metadata.boardBootstrapOwner !== ownerId
            || !['initializing', '2'].includes(String(room.metadata.boardProtocol))) throw cause
    }
    const doc = new Y.Doc(), readBack = new Y.Doc(), schema = createTLSchema()
    try {
        if (created) {
            initializeBoardV2(doc, schema, { allowLegacy: false })
            await client.sendYjsBinaryUpdate(roomId, Y.encodeStateAsUpdate(doc))
        }
        Y.applyUpdate(readBack, new Uint8Array(await client.getYjsDocumentAsBinaryUpdate(roomId)))
        assertBoardV2(readBack, schema)
        publishing = true
        const result = await publish()
        await client.updateRoom(roomId, { metadata: { boardProtocol: '2', boardBootstrapOwner: ownerId } })
        return result
    } catch (cause) {
        if (created && !publishing) {
            try { await client.deleteRoom(roomId) }
            catch (cleanup) { throw new AggregateError([cause, cleanup], '新白板初始化失败，房间已保留供恢复') }
        }
        throw cause
    } finally {
        doc.destroy()
        readBack.destroy()
    }
}

export function getBoardProtocolFailure(metadata: Record<string, string | string[]>, protocol: unknown): { status: number; message: string } | null {
    const version = metadata.boardProtocol
    if (version === undefined || version === '1') return null
    if (version === 'initializing') return { status: 503, message: '白板正在初始化或升级，请稍后重试' }
    if (version === '2' && protocol === 2) return null
    return { status: 409, message: '白板版本已更新，请刷新页面后重试' }
}
