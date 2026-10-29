import type { Editor } from 'tldraw'
import { collectRegionSnapshot, type RegionSnapshot } from '../snapshot/collectRegionSnapshot'
import { MAX_CHAT_SNAPSHOT_BYTES, validateRegionSnapshot } from '../snapshot/chatSnapshots'
import { MAX_BOARD_SNAPSHOT_SHAPES, type SnapshotRange, type SnapshotToolSuccess } from './boardCreateProtocol'

/**
 * 只读取任务绑定的草稿 Editor，按视口或当前页面收集有界快照，不修改 Store 或授权集合。
 * 首次以返回元素中最靠左上的元素为参照；后续始终使用固定参照坐标，空首快照回退视口原点。
 */
export function captureBoardSnapshot(editor: Editor, range: SnapshotRange, reference?: RegionSnapshot['reference']): SnapshotToolSuccess {
    const region = range === 'page' ? editor.getCurrentPageBounds() ?? editor.getViewportPageBounds() : editor.getViewportPageBounds()
    const collected = collectRegionSnapshot(editor, region)
    const viewport = editor.getViewportPageBounds()
    // shortcut: 单次最多 30 个元素和 64KB；大画板精确查询时再增加过滤或分页。
    let shapes = collected.shapes.slice(0, MAX_BOARD_SNAPSHOT_SHAPES)
    const encoder = new TextEncoder()
    let snapshot: RegionSnapshot

    do {
        const anchor = shapes.reduce<RegionSnapshot['shapes'][number] | undefined>((first, shape) =>
            !first || shape.y < first.y || shape.y === first.y && shape.x < first.x ? shape : first, undefined)
        const point = reference ?? (anchor
            ? { id: anchor.id, x: collected.reference.x + anchor.x, y: collected.reference.y + anchor.y }
            : { id: null, x: editor.getViewportPageBounds().x, y: editor.getViewportPageBounds().y })
        snapshot = {
            reference: { ...point },
            viewport: { x: viewport.x - point.x, y: viewport.y - point.y, w: viewport.w, h: viewport.h },
            shapes: shapes.map(shape => ({ ...shape,
                x: shape.x + collected.reference.x - point.x,
                y: shape.y + collected.reference.y - point.y,
            })),
        }
        if (encoder.encode(JSON.stringify(snapshot)).byteLength <= MAX_CHAT_SNAPSHOT_BYTES) break
        shapes = shapes.slice(0, -1)
    } while (shapes.length)

    // 单个超长元素可能使全部候选被移除，返回明确截断的空结果，不冒充空页面。
    if (!shapes.length) {
        const point = reference ?? { id: null, x: viewport.x, y: viewport.y }
        snapshot = {
            reference: { ...point },
            viewport: { x: viewport.x - point.x, y: viewport.y - point.y, w: viewport.w, h: viewport.h },
            shapes: [],
        }
    }
    validateRegionSnapshot(snapshot)
    return { ok: true, state: 'draft', range, snapshot, truncated: shapes.length < collected.shapes.length }
}
