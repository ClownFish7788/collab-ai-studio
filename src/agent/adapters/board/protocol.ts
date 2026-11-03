import { boardSnapshotSchema } from '../../domain/observation'
import type { BoardToolName } from '../../domain/tool'
import type { BoardToolCall } from '../../../utils/board/agent/boardCreateProtocol'
import type { RegionSnapshot } from '../../../utils/board/snapshot/collectRegionSnapshot'

/** 保留完整白板上下文，并在适配入口丢弃原生对象/传输附带的非契约字段。 */
export function toAgentSnapshot(snapshot: RegionSnapshot) {
    const { id, x, y } = snapshot.reference
    return boardSnapshotSchema.parse({ reference: { id, x, y },
        ...(snapshot.viewport ? { viewport: { x: snapshot.viewport.x, y: snapshot.viewport.y, w: snapshot.viewport.w, h: snapshot.viewport.h } } : {}),
        shapes: snapshot.shapes.map(shape => ({ id: shape.id, type: shape.type, x: shape.x, y: shape.y, w: shape.w, h: shape.h,
            text: shape.text, opacity: shape.opacity, props: shape.props, color: shape.color, labelColor: shape.labelColor,
            fill: shape.fill, geo: shape.geo, assetId: shape.assetId, url: shape.url,
            ...(shape.origin ? { origin: { x: shape.origin.x, y: shape.origin.y } } : {}),
        })),
    })
}

export function toBoardToolCall(call: { id: string; name: BoardToolName; input: unknown }, input: unknown = call.input): BoardToolCall {
    return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(input) } }
}

