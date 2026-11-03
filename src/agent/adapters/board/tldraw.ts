import { Box, type BoxModel, type Editor, type TLShape, type TLShapeId, type TLAssetId, type TLDefaultColorStyle, type TLDefaultFillStyle } from 'tldraw'
import { isEqual } from '@tldraw/utils'
import { resolveBoardReference } from '../../domain/observation'
import { DRAFT_SHAPE_TYPES } from '../../../utils/board/draft/draftShapeSchema'
import type { CreateDraftShapeInput, UpdateDraftShapeInput } from '../../../utils/board/draft/draftShapeOperations'
import { MAX_CHAT_SNAPSHOT_BYTES, validateRegionSnapshot, validateChatSnapshot } from '../../../utils/board/snapshot/chatSnapshots'
import { MAX_BOARD_SNAPSHOT_SHAPES, validateBoardToolSuccess, BoardProtocolError, ERROR_CODES,
    type CreateToolSuccess, type UpdateToolSuccess, type DeleteToolSuccess,
    type SnapshotToolSuccess, type ScreenshotToolSuccess, type SnapshotRange,
} from '../../../utils/board/agent/boardCreateProtocol'
import type { CreateShapesInput, UpdateShapesInput, DeleteShapesInput, SnapshotInput } from '../../../utils/board/agent/boardToolInputSchema'

export type RegionSnapshot = {
    reference: { id: TLShapeId | null; x: number; y: number }
    /** 当前视口的页面尺寸及相对 reference 的左上角；旧附件可能没有此字段。 */
    viewport?: BoxModel
    shapes: {
        id: TLShapeId
        type: string
        x: number
        y: number
        w: number
        h: number
        text: string
        /** 原生元素原点的页面坐标，相对 reference；与外接框左上角可能不同。 */
        origin?: { x: number; y: number }
        /** 原生属性只读上下文；更新时仅提交需要改变的可写字段。 */
        props?: TLShape['props']
        /** 原生色名：图形描边色、文本颜色或便笺背景色，具体含义由 type 决定。 */
        color?: TLDefaultColorStyle
        /** 图形的标签文字颜色；与图形自身的 color 分开保留。 */
        labelColor?: TLDefaultColorStyle
        /** 填充模式（如 none / solid），不是另一种颜色。 */
        fill?: TLDefaultFillStyle
        /** 元素自身的透明度，不包含父级透明度的叠乘。 */
        opacity: number
        geo?: string
        assetId?: TLAssetId
        url?: string
    }[]
}

/**
 * 收集页面坐标区域内的元素（外接矩形相交，含边界），默认区域为当前视口。
 * reference 保存页面坐标；元素 x/y 相对于 reference，w/h 为页面外接矩形尺寸。
 * 默认参照物按 y、x 升序选取；空区域的原点是视口左上角，id 为 null。
 * 指定 referenceId 时，该元素必须在收集范围内。只读取白板，不修改元素。
 * selectedIds 未传时收集区域内所有元素；传入时仅收集这些 ID，空数组表示空选区。
 */
export function collectRegionSnapshot(
    editor: Editor,
    region: BoxModel = editor.getViewportPageBounds(),
    referenceId?: TLShapeId,
    selectedIds?: readonly TLShapeId[],
): RegionSnapshot {
    if (![region.x, region.y, region.w, region.h].every(Number.isFinite) || region.w < 0 || region.h < 0) {
        throw new RangeError('区域坐标必须为有限数值，宽高不能为负数')
    }

    const area = Box.From(region)
    const allowedIds = selectedIds === undefined ? undefined : new Set(selectedIds)
    const shapes: RegionSnapshot['shapes'] = []
    for (const shape of editor.getCurrentPageShapes()) {
        // 先按真实选区过滤，避免外接矩形内未选中的元素混入快照或被选为参照物。
        if (allowedIds && !allowedIds.has(shape.id)) continue
        const bounds = editor.getShapePageBounds(shape)
        if (!bounds || !area.collides(bounds)) continue

        shapes.push({
            id: shape.id,
            type: shape.type,
            x: bounds.x,
            y: bounds.y,
            w: bounds.w,
            h: bounds.h,
            text: editor.getShapeUtil(shape).getText(shape) ?? '',
            origin: editor.getShapePageTransform(shape).applyToPoint({ x: 0, y: 0 }),
            props: structuredClone(shape.props),
            opacity: shape.opacity,
            ...('color' in shape.props ? { color: shape.props.color } : {}),
            ...('labelColor' in shape.props ? { labelColor: shape.props.labelColor } : {}),
            ...('fill' in shape.props ? { fill: shape.props.fill } : {}),
            ...(shape.type === 'geo' ? { geo: shape.props.geo } : {}),
            ...('assetId' in shape.props && shape.props.assetId ? { assetId: shape.props.assetId } : {}),
            ...('url' in shape.props ? { url: shape.props.url } : {}),
        })
    }

    const anchor = referenceId !== undefined
        ? shapes.find(shape => shape.id === referenceId)
        : shapes.reduce<RegionSnapshot['shapes'][number] | undefined>((first, shape) => {
            return !first || shape.y < first.y || (shape.y === first.y && shape.x < first.x) ? shape : first
        }, undefined)
    if (referenceId !== undefined && !anchor) throw new Error('参照物不在收集区域内或已不存在')

    const viewport = editor.getViewportPageBounds()
    const reference = anchor
        ? { id: anchor.id, x: anchor.x, y: anchor.y }
        : { id: null, x: viewport.x, y: viewport.y }

    for (const shape of shapes) {
        shape.x -= reference.x
        shape.y -= reference.y
        if (shape.origin) shape.origin = { x: shape.origin.x - reference.x, y: shape.origin.y - reference.y }
    }
    return {
        reference,
        viewport: { x: viewport.x - reference.x, y: viewport.y - reference.y, w: viewport.w, h: viewport.h },
        shapes,
    }
}

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
        // 采集结果已相对 collected.reference；先还原页面坐标，再换到任务固定参照，避免视口变化导致漂移。
        snapshot = {
            reference: { ...point },
            viewport: { x: viewport.x - point.x, y: viewport.y - point.y, w: viewport.w, h: viewport.h },
            shapes: shapes.map(shape => ({ ...shape,
                x: shape.x + collected.reference.x - point.x,
                y: shape.y + collected.reference.y - point.y,
                ...(shape.origin ? { origin: {
                    // 原生原点与外接框分别换算；箭头/路径的两者可能不同，不能互相覆盖。
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
            // region 是页面坐标，输出 bounds 与结构快照共用参照；宽高保持页面单位，不受导出缩放影响。
            return { ok: true, state: 'draft', range, image, reference: { ...reference },
                bounds: { x: region.x - reference.x, y: region.y - reference.y, w: region.w, h: region.h } }
        }
        scale /= 2
    }
    throw new Error('截图过大，请缩小观察范围')
}

/** Editor 的读取与草稿增删改共用本任务的参照和授权；询问与调用分发保持独立。 */
export function createTldrawTools({ snapshot, assertActive, read, readSelection: readSelected, screenshot, authorize, create, getShape, pageId, update, remove }: {
    snapshot?: RegionSnapshot
    assertActive: () => void
    read: (range: SnapshotRange, reference?: RegionSnapshot['reference']) => SnapshotToolSuccess
    screenshot: (range: SnapshotRange, reference: RegionSnapshot['reference']) => Promise<ScreenshotToolSuccess>
    readSelection: (ids: readonly TLShapeId[], reference?: RegionSnapshot['reference']) => Promise<SnapshotToolSuccess>
    authorize: (ids: readonly TLShapeId[]) => void
    create: (inputs: readonly CreateDraftShapeInput[]) => readonly TLShape[]
    getShape: (id: TLShapeId) => TLShape | undefined
    pageId: string
    update: (inputs: readonly UpdateDraftShapeInput[]) => readonly TLShape[]
    remove: (ids: readonly TLShapeId[]) => readonly TLShapeId[]
}) {
    if (snapshot) validateChatSnapshot(snapshot)
    const context = {
        reference: snapshot ? { ...snapshot.reference } : undefined,
        seenIds: new Set(snapshot?.shapes.map(shape => shape.id)),
    }
    const acceptSnapshot = (snapshot: RegionSnapshot) => {
        const { id, x, y } = snapshot.reference
        resolveBoardReference(context.reference, { id, x, y })
        assertActive()
        context.reference ??= { id, x, y }
        // 所有读取路径复用此入口，真实快照通过校验后才授权，用户选区也不例外。
        authorize(snapshot.shapes.map(shape => shape.id))
        snapshot.shapes.forEach(shape => context.seenIds.add(shape.id))
    }
    const retryRead = async <T>(read: () => T | Promise<T>, onRetry?: (attempt: number) => void): Promise<T> => {
        for (let attempt = 0; ; attempt++) {
            assertActive()
            try { return await read() }
            catch (cause) {
                assertActive()
                if (cause instanceof BoardProtocolError && cause.detail.code === ERROR_CODES.INVALID_ARGUMENTS || attempt === 2) throw cause
                onRetry?.(attempt + 1)
            }
        }
    }
    const checkTargets = (ids: readonly string[]) => {
        // 整批预检后再写入，避免后项越界时前项已经改变草稿。
        for (const id of ids) {
            const target = getShape(id as TLShapeId)
            if (!context.seenIds.has(id as TLShapeId) || !target || target.id !== id || !DRAFT_SHAPE_TYPES.includes(target.type)
                || target.parentId !== pageId || target.rotation !== 0 || target.isLocked) {
                throw new Error('目标须为已读取、未锁定、无旋转的页面直属元素')
            }
        }
    }

    return {
        async get_board_snapshot({ range }: SnapshotInput, onRetry?: (attempt: number) => void): Promise<SnapshotToolSuccess> {
            // 只重试原生读取；校验失败或授权失败直接终止，不把它们当成临时读取错误。
            const captured = await retryRead(() => {
                const captured = read(range, context.reference)
                context.reference ??= { ...captured.snapshot.reference }
                return captured
            }, onRetry)
            const result = validateBoardToolSuccess('get_board_snapshot', captured)
            if (result.range !== range) throw new Error('快照范围不匹配')
            acceptSnapshot(result.snapshot)
            return result
        },
        async get_board_screenshot({ range }: SnapshotInput, onRetry?: (attempt: number) => void): Promise<ScreenshotToolSuccess> {
            // 结构读取只用于固定坐标参照；截图路径不能调用 acceptSnapshot，也不授予额外写入权限。
            const image = await retryRead(() => {
                const captured = read(range, context.reference)
                context.reference ??= { ...captured.snapshot.reference }
                return screenshot(range, context.reference)
            }, onRetry)
            const result = validateBoardToolSuccess('get_board_screenshot', image)
            if (result.range !== range) throw new Error('截图范围不匹配')
            const { id, x, y } = result.reference
            resolveBoardReference(context.reference, { id, x, y })
            assertActive()
            return result
        },
        async readSelection(ids: readonly string[]): Promise<RegionSnapshot> {
            assertActive()
            // 字符串 ID 到 TLShapeId 的转换仅在原生边界发生；仍须读取并核对实际返回的选区。
            const result = validateBoardToolSuccess('get_board_snapshot', await readSelected(ids as readonly TLShapeId[], context.reference))
            if (result.snapshot.shapes.length !== ids.length || result.snapshot.shapes.some(shape => !ids.includes(shape.id))) {
                throw new Error('回答选区与真实快照不匹配')
            }
            acceptSnapshot(result.snapshot)
            return result.snapshot
        },
        delete_shapes({ ids }: DeleteShapesInput): DeleteToolSuccess {
            checkTargets(ids)
            assertActive()
            const removed = remove(ids as TLShapeId[])
            if (removed.length !== ids.length || removed.some((id, index) => id !== ids[index])) throw new Error('删除结果不匹配')
            removed.forEach(id => context.seenIds.delete(id))
            return validateBoardToolSuccess('delete_shapes', { ok: true, state: 'draft', operation: 'delete', ids: removed })
        },
        update_shapes({ shapes: patches }: UpdateShapesInput): UpdateToolSuccess {
            const point = context.reference
            if (!point) throw new Error('更新前须取得快照参照点')
            checkTargets(patches.map(patch => patch.id))
            const inputs = patches.map(({ id, type, x, y, props }) => {
                if (getShape(id as TLShapeId)?.type !== type) throw new Error('更新不能改变元素类型')
                return {
                    id: id as TLShapeId,
                    // 只把显式 x/y 从任务相对坐标还原到页面坐标；省略轴和属性保持原值。
                    ...(x !== undefined ? { x: point.x + x } : {}),
                    ...(y !== undefined ? { y: point.y + y } : {}),
                    ...(props !== undefined ? { props } : {}),
                }
            })
            assertActive()
            const updated = update(inputs)
            if (updated.length !== patches.length) throw new Error('更新数量不匹配')
            const shapes = patches.map((patch, index) => {
                const actual = updated[index], input = inputs[index]
                if (actual.id !== patch.id || actual.type !== patch.type
                    || input.x !== undefined && actual.x !== input.x
                    || input.y !== undefined && actual.y !== input.y
                    || Object.entries(input.props ?? {}).some(([key, value]) => !isEqual((actual.props as Record<string, unknown>)[key], value))) {
                    throw new Error('更新结果与请求不一致')
                }
                // 核对原生结果后回报相对坐标，不能把页面坐标误当成模型下一步输入。
                return { ...patch }
            })
            return validateBoardToolSuccess('update_shapes', { ok: true, state: 'draft', operation: 'update', shapes })
        },
        create_shapes(input: CreateShapesInput): CreateToolSuccess {
            const point = context.reference
            if (!point) throw new Error('首次新增前须取得快照参照点')
            input.shapes.forEach(shape => { if (shape.children) checkTargets(shape.children) })
            assertActive()
            // 只平移元素原点；arrow.start/end、line.points 等 props 内部仍使用元素局部坐标。
            const inputs = input.shapes.map(shape => ({ ...shape, x: point.x + shape.x, y: point.y + shape.y } as CreateDraftShapeInput))
            const shapes = create(inputs)
            if (shapes.length !== inputs.length) throw new Error('新增数量不匹配')
            const result = validateBoardToolSuccess('create_shapes', {
                ok: true, state: 'draft',
                shapes: shapes.map((shape, index) => {
                    const requested = inputs[index]
                    if (shape.type !== requested.type || shape.x !== requested.x || shape.y !== requested.y
                        || Object.entries(requested.props ?? {}).some(([key, value]) => !isEqual((shape.props as Record<string, unknown>)[key], value))) {
                        throw new Error('新增结果与请求不一致')
                    }
                    // ID 来自实际创建结果，其余为已核对的相对输入，不回写原生默认或派生属性。
                    return { ...input.shapes[index], id: shape.id }
                }),
            })
            result.shapes.forEach(shape => context.seenIds.add(shape.id as TLShapeId))
            return result
        },
    }
}
