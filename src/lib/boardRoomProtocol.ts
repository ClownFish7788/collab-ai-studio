import type { Liveblocks } from '@liveblocks/node'
import { createTLSchema } from '@tldraw/tlschema'
import * as Y from 'yjs'
import { assertBoardV2, initializeBoardV2 } from '@/utils/collaboration/tldrawYjsMigration'

type RoomClient = Pick<Liveblocks, 'createRoom' | 'sendYjsBinaryUpdate' | 'getYjsDocumentAsBinaryUpdate' | 'updateRoom'>

export async function createBoardRoom(client: RoomClient, roomId: string): Promise<void> {
    await client.createRoom(roomId, { defaultAccesses: [], metadata: { boardProtocol: 'initializing' } })
    const doc = new Y.Doc(), readBack = new Y.Doc(), schema = createTLSchema()
    try {
        initializeBoardV2(doc, schema, { allowLegacy: false })
        await client.sendYjsBinaryUpdate(roomId, Y.encodeStateAsUpdate(doc))
        Y.applyUpdate(readBack, new Uint8Array(await client.getYjsDocumentAsBinaryUpdate(roomId)))
        assertBoardV2(readBack, schema)
        await client.updateRoom(roomId, { metadata: { boardProtocol: '2' } })
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
