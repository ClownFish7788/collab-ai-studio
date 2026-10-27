import {
    Box, type BoxModel, type Editor, type TLAssetId, type TLShapeId,
    type TLDefaultColorStyle, type TLDefaultFillStyle,
} from 'tldraw'

export type RegionSnapshot = {
    reference: { id: TLShapeId | null; x: number; y: number }
    shapes: {
        id: TLShapeId
        type: string
        x: number
        y: number
        w: number
        h: number
        text: string
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
    }
    return { reference, shapes }
}
