import type { Editor, TLShapeId } from 'tldraw'
import { collectRegionSnapshot, type RegionSnapshot } from '../snapshot/collectRegionSnapshot'
import { MAX_CHAT_SNAPSHOT_BYTES, validateRegionSnapshot } from '../snapshot/chatSnapshots'
import { MAX_BOARD_SNAPSHOT_SHAPES, type SnapshotRange, type SnapshotToolSuccess, type ScreenshotToolSuccess } from './boardCreateProtocol'

/**
 * 只读取任务绑定的草稿 Editor，按视口或当前页面收集有界快照，不修改 Store 或授权集合。
 * 首次以返回元素中最靠左上的元素为参照；后续始终使用固定参照坐标，空首快照回退视口原点。
 */
export function captureBoardSnapshot(editor: Editor, range: SnapshotRange, reference?: RegionSnapshot['reference'], selectedIds?: readonly TLShapeId[]): SnapshotToolSuccess {
    const region = range === 'page' ? editor.getCurrentPageBounds() ?? editor.getViewportPageBounds() : editor.getViewportPageBounds()
    const collected = collectRegionSnapshot(editor, region, undefined, selectedIds)
    if (selectedIds && (selectedIds.length !== collected.shapes.length || selectedIds.length > MAX_BOARD_SNAPSHOT_SHAPES)) throw new Error('所选元素已失效，请重新选择')
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
                ...(shape.origin ? { origin: {
                    x: shape.origin.x + collected.reference.x - point.x,
                    y: shape.origin.y + collected.reference.y - point.y,
                } } : {}),
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
    if (selectedIds && shapes.length !== selectedIds.length) throw new Error('所选元素上下文过大，请减少选区')
    return { ok: true, state: 'draft', range, snapshot, truncated: shapes.length < collected.shapes.length }
}

/** 截图只提供视觉上下文；真实 ID 的授权仍由结构快照单独完成。 */
export async function captureBoardScreenshot(editor: Editor, range: SnapshotRange, reference: RegionSnapshot['reference']): Promise<ScreenshotToolSuccess> {
    const region = range === 'page' ? editor.getCurrentPageBounds() ?? editor.getViewportPageBounds() : editor.getViewportPageBounds()
    if (![region.x, region.y, region.w, region.h].every(Number.isFinite) || region.w <= 0 || region.h <= 0) throw new Error('截图区域无效')
    const shapes = editor.getCurrentPageShapesSorted()
    let scale = Math.min(1, 1600 / Math.max(region.w, region.h))
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await editor.toImage(shapes, { format: 'jpeg', background: true, bounds: region, padding: 0, pixelRatio: 1, scale })
        if (result.blob.size < 2 * 1024 * 1024) {
            const image = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('截图读取失败'))
                reader.onerror = () => reject(new Error('截图读取失败'))
                reader.readAsDataURL(result.blob)
            })
            return { ok: true, state: 'draft', range, image, reference: { ...reference },
                bounds: { x: region.x - reference.x, y: region.y - reference.y, w: region.w, h: region.h } }
        }
        scale /= 2
    }
    throw new Error('截图过大，请缩小观察范围')
}
