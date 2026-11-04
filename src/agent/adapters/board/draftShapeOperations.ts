import {
    b64Vecs,
    createBindingId,
    createShapeId,
    isEqual,
    isShapeId,
    getIndexAbove,
    type Editor,
    type TLArrowBinding,
    type TLAsset,
    type TLShape,
    type TLShapeId,
    type TLShapePartial,
    type TLParentId
} from 'tldraw'
import {
    DRAFT_SHAPE_TYPES,
    documentDiff,
    getDraftChanges,
    isSupportedDraftShape,
    shapePage,
    type BoardDraft,
    type DraftShapeType
} from './draft'

import { DERIVED_SHAPE_PROPS } from './draftShapeSchema'
import { MAX_BOARD_WRITE_SHAPES } from '../../../utils/board/boardCapabilities'
export { DERIVED_SHAPE_PROPS } from './draftShapeSchema'

type CommonInput = {
    /** 相对父对象坐标；parentId 省略时父对象为当前页面，不是屏幕像素。 */
    x?: number
    y?: number
    rotation?: number
    opacity?: number
    isLocked?: boolean
    parentId?: TLParentId
    index?: TLShape['index']
    meta?: TLShape['meta']
}

export type DraftBindings = Partial<
    Record<
        'start' | 'end',
        ({ toId: TLShapeId } & Partial<Omit<TLArrowBinding['props'], 'terminal'>>) | null
    >
>

export type CreateDraftShapeInput = {
    [K in DraftShapeType]: CommonInput & {
        type: K
        x: number
        y: number
        props?: Partial<Extract<TLShape, { type: K }>['props']>

        /** group 使用已有范围内子对象创建；至少两个，不接收空组。 */
        children?: readonly TLShapeId[]

        /** 仅 arrow：省略保留，null 解除对应端点；端点目标必须在范围内。 */
        bindings?: DraftBindings
    }
}[DraftShapeType]

export type UpdateDraftShapeInput = CommonInput & {
    id: TLShapeId
    props?: Partial<TLShape['props']>
    bindings?: DraftBindings
}

export type DraftOperationOptions = {
    /** 完整、已验证的新资产记录；同 ID 不同内容会拒绝。 */
    assets?: readonly TLAsset[]
}

const COMMON_FIELDS = [
    'x',
    'y',
    'rotation',
    'opacity',
    'isLocked',
    'parentId',
    'index',
    'meta'
]

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

function object(value: unknown): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) {
        throw new Error('输入必须是普通对象')
    }
}

function json(value: unknown, depth = 0): void {
    if (depth > 30) {
        throw new Error('数据嵌套过深')
    }
    if (typeof value === 'number' && Number.isFinite(value) || value === null || typeof value === 'boolean'
        || typeof value === 'string') {
        return
    }
    if (Array.isArray(value)) {
        value.forEach(item => json(item, depth + 1))

        return
    }

    object(value)
    Object.values(value).forEach(item => json(item, depth + 1))
}

function safeUrl(value: unknown, media = false) {
    if (value === null || value === '') {
        return
    }
    if (typeof value !== 'string'
        || !(/^https?:\/\//i.test(value)
            || media && /^data:(image|video)\/[\w.+-]+;base64,[\w+/=]+$/i.test(value))) {
        throw new Error('URL 必须使用 http/https 或本地媒体 Data URI')
    }
    if (!value.startsWith('data:')) {
        new URL(value)
    }
}

function task(draft: BoardDraft, editor: Editor) {
    if (draft.status !== 'active' || editor.isDisposed) {
        throw new Error('草稿任务已失效')
    }
    if (editor.store !== draft.store || editor.getCurrentPageId() !== draft.pageId) {
        throw new Error('Editor 或页面与草稿不匹配')
    }
}

function target(draft: BoardDraft, editor: Editor, id: unknown, unlock = false): TLShape {
    if (typeof id !== 'string' || !isShapeId(id) || !draft.scope.has(id)) {
        throw new Error('目标不在本次范围内')
    }

    const shape = editor.getShape(id)

    if (!isSupportedDraftShape(shape) || shapePage(draft.store.serialize('document'), id) !== draft.pageId) {
        throw new Error('目标不存在或类型不受支持')
    }
    if (editor.isShapeOrAncestorLocked(shape)
        && !(unlock && shape.isLocked && !editor.isShapeOrAncestorLocked(shape.parentId as TLShapeId))) {
        throw new Error('请先解锁目标及其父对象')
    }

    return shape
}

function validate(
    editor: Editor,
    type: string,
    input: Record<string, unknown>,
    create: boolean,
    before?: TLShape
) {
    object(input)
    const allowed = [...COMMON_FIELDS, ...(create ? ['type', 'props', 'children', 'bindings'] : ['id', 'props', 'bindings'])]

    if (Object.keys(input).some(key => !allowed.includes(key))) {
        throw new Error('输入包含未知或只读身份字段')
    }

    json(input)

    if (!(DRAFT_SHAPE_TYPES as readonly string[]).includes(type)) {
        throw new Error('不支持该元素类型')
    }

    for (const key of ['x', 'y', 'rotation', 'opacity']) {
        if (own(input, key) && typeof input[key] !== 'number') {
            throw new Error(`${key} 必须是有限数字`)
        }
    }
    if (create && (!own(input, 'x') || !own(input, 'y'))) {
        throw new Error('新增必须指定 x/y')
    }
    if (own(input, 'opacity') && ((input.opacity as number) < 0 || (input.opacity as number) > 1)) {
        throw new Error('opacity 须在 0～1 内')
    }
    if (own(input, 'isLocked') && typeof input.isLocked !== 'boolean') {
        throw new Error('isLocked 必须是布尔值')
    }
    if (own(input, 'index')) {
        if (typeof input.index !== 'string' || !/^[A-Za-z][0-9A-Za-z]+$/.test(input.index)) {
            throw new Error('index 必须是有效的原生排序键')
        }

        getIndexAbove(input.index as TLShape['index'])
    }

    if (own(input, 'meta')) {
        object(input.meta)
    }
    if (own(input, 'bindings') && type !== 'arrow') {
        throw new Error('只有 arrow 可以设置 bindings')
    }
    if (own(input, 'children') && type !== 'group') {
        throw new Error('只有 group 可以设置 children')
    }
    if (input.props !== undefined) {
        object(input.props)
        const validators = (editor.getShapeUtil(type as DraftShapeType).constructor as unknown as { props: Record<string, { validate(value: unknown): unknown }> }).props

        for (const [key, value] of Object.entries(input.props)) {
            if (!own(validators, key) || DERIVED_SHAPE_PROPS[type as DraftShapeType]?.includes(key)) {
                throw new Error(`${type}.${key} 未开放或由原生派生`)
            }

            validators[key].validate(value)

            if (key === 'url') {
                safeUrl(value)
            }
        }

        if (type === 'text' && own(input.props, 'w')
            && (input.props.autoSize ?? (before?.props as { autoSize?: boolean } | undefined)?.autoSize ?? true)) {
            throw new Error('text.w 需要 autoSize=false')
        }
        if (type === 'line' && own(input.props, 'points')
            && Object.keys(input.props.points as object).length < 2) {
            throw new Error('line.points 至少需要两个点')
        }
    }

    if (type === 'draw' || type === 'highlight') {
        const segments = (input.props as { segments?: { path: string }[] } | undefined)?.segments ?? (create ? [] : undefined)

        if (segments) {
            if (!segments.length) {
                throw new Error('画笔路径不能为空')
            }

            for (const segment of segments) {
                const points = b64Vecs.decodePoints(segment.path)

                if (!points.length
                    || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)
                        || point.z !== undefined && !Number.isFinite(point.z))) {
                    throw new Error('画笔路径编码无效')
                }
            }
        }
    }
}

function parent(draft: BoardDraft, editor: Editor, id: TLParentId, child?: TLShapeId) {
    if (id === draft.pageId) {
        return
    }

    const shape = target(draft, editor, id)

    if (!['frame', 'group'].includes(shape.type)) {
        throw new Error('父对象必须为 frame/group')
    }

    let next: TLShape | undefined = shape

    while (next) {
        if (next.id === child) {
            throw new Error('不能把对象移入自身或后代')
        }

        next = editor.getShape(next.parentId as TLShapeId)
    }
}

function importAssets(draft: BoardDraft, editor: Editor, assets: readonly TLAsset[] = []) {
    if (!Array.isArray(assets) || assets.length > 30) {
        throw new Error('每次最多导入 30 个资产')
    }

    for (const asset of assets as readonly TLAsset[]) {
        json(asset)
        draft.store.schema.types.asset.validate(asset)
        safeUrl(asset.props.src, true)

        if (asset.type === 'bookmark') {
            safeUrl(asset.props.image, true)
            safeUrl(asset.props.favicon, true)
        }

        const existing = draft.store.get(asset.id)

        if (existing && !isEqual(existing, asset)) {
            throw new Error('资产 ID 冲突，禁止覆盖已有资产')
        }
        if (!existing) {
            editor.createAssets([asset])
            draft.assets.add(asset.id)
        }
    }
}

function setBindings(draft: BoardDraft, editor: Editor, shape: TLShape, bindings: DraftBindings | undefined) {
    if (bindings === undefined) {
        return
    }

    object(bindings)

    for (const [terminal, binding] of Object.entries(bindings)) {
        if (!['start', 'end'].includes(terminal)) {
            throw new Error('绑定端点只能是 start/end')
        }

        const existing = editor.getBindingsFromShape<TLArrowBinding>(shape.id, 'arrow').filter(item => item.props.terminal === terminal)

        if (existing.length > 1) {
            throw new Error('重复的箭头端点绑定')
        }
        if (binding === null) {
            editor.deleteBindings(existing, { isolateShapes: true })
            continue
        }

        object(binding)

        if (Object.keys(binding).some(key => !['toId', 'normalizedAnchor', 'isExact', 'isPrecise', 'snap'].includes(key))) {
            throw new Error('绑定包含未开放字段')
        }

        const endpoint = target(draft, editor, binding.toId)

        if (endpoint.id === shape.id
            || !editor.canBindShapes({
                fromShape: shape,
                toShape: endpoint,
                binding: 'arrow'
            })) {
            throw new Error('不兼容的绑定目标')
        }

        const { toId, ...props } = binding
        const defaults: TLArrowBinding['props'] = {
            normalizedAnchor: { x: 0.5, y: 0.5 },
            isExact: false,
            isPrecise: true,
            snap: 'none',
            terminal: terminal as 'start' | 'end'
        }
        const fullProps = {
            ...(existing[0]?.props ?? defaults),
            ...props,
            terminal: terminal as 'start' | 'end'
        }

        if (existing.length) {
            editor.updateBindings([{
                id: existing[0].id,
                type: 'arrow',
                toId: toId as TLShapeId,
                props: fullProps
            }])
        } else {
            editor.createBindings([{
                id: createBindingId(),
                type: 'arrow',
                fromId: shape.id,
                toId: toId as TLShapeId,
                props: fullProps
            }])
        }

        const actual = editor.getBindingsFromShape<TLArrowBinding>(shape.id, 'arrow').find(item => item.props.terminal === terminal)

        if (!actual || actual.toId !== toId || !isEqual(actual.props, fullProps)) {
            throw new Error('原生 API 未按输入完成绑定')
        }
    }
}

function assertResult(shape: TLShape | undefined, input: CommonInput & {
    props?: object
    type?: string
}) {
    if (!shape) {
        throw new Error('原生 API 未完成操作')
    }

    for (const key of COMMON_FIELDS) {
        if (own(input, key) && !isEqual(shape[key as keyof TLShape], input[key as keyof CommonInput])) {
            throw new Error(`原生 API 未按输入完成 ${key}`)
        }
    }

    for (const [key, value] of Object.entries(input.props ?? {})) {
        if (!isEqual((shape.props as Record<string, unknown>)[key], value)) {
            throw new Error(`原生 API 未按输入完成 ${shape.type}.${key}`)
        }
    }

    return shape
}

function write(editor: Editor, id: TLShapeId, type: string, input: CommonInput & { props?: object }) {
    // 先运行原生标签/样式排版，再应用明确指定的坐标和尺寸。
    if (input.props) {
        editor.updateShapes([{
            id,
            type,
            props: input.props
        } as TLShapePartial])
    }

    const dimensions = Object.fromEntries(Object.entries(input.props ?? {}).filter(([key]) => ['w', 'h'].includes(key)))
    const common = Object.fromEntries(COMMON_FIELDS.filter(key => own(input, key)).map(key => [key, input[key as keyof CommonInput]]))

    editor.updateShapes([{
        id,
        type,
        ...common,
        ...(Object.keys(dimensions).length ? { props: dimensions } : {})
    } as TLShapePartial])
}

function execute<T>(draft: BoardDraft, editor: Editor, options: DraftOperationOptions, operation: () => T): T {
    const before = structuredClone(draft.store.serialize('document'))
    const scope = new Set(draft.scope)
    const assets = new Set(draft.assets)
    const readonly = editor.getIsReadonly()
    const mark = editor.markHistoryStoppingPoint('draft-operation')

    try {
        editor.registerExternalAssetHandler('url', null)
        editor.updateInstanceState({ isReadonly: false })
        let result!: T
        let failure: { cause: unknown } | undefined

        // HistoryManager 会把逃出 batch 的业务异常标记为 Editor 崩溃，必须在 batch 内捕获。
        editor.run(() => {
            try {
                importAssets(draft, editor, options.assets)
                result = operation()
            } catch (cause) {
                failure = { cause }
            }
        })

        if (failure) {
            throw failure.cause
        }

        const changed = documentDiff(before, draft.store.serialize('document'))

        for (const record of [...Object.values(changed.removed), ...Object.values(changed.updated).map(([old]) => old)]) {
            const after = draft.store.get(record.id)

            if (record.typeName === 'shape' && record.isLocked && (after?.typeName !== 'shape' || after.isLocked)) {
                throw new Error('锁定对象必须先解锁')
            }
        }

        for (const record of [...Object.values(changed.added), ...Object.values(changed.updated).map(([, after]) => after)]) {
            if (record.typeName !== 'shape') {
                continue
            }

            const bounds = editor.getShapeGeometry(record).bounds

            if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)) {
                throw new Error('图形包含无效的几何数据')
            }
        }

        // 资产不进入原生 undo 历史，只清理本任务导入且已无引用的本地记录，不调用外部删除回调。
        const used = new Set(editor.store.allRecords().flatMap(record => record.typeName === 'shape' && 'assetId' in record.props ? [record.props.assetId] : []))

        editor.store.remove([...draft.assets].filter(id => !used.has(id as TLAsset['id'])).map(id => id as TLAsset['id']))
        getDraftChanges(draft)

        return result
    } catch (error) {
        editor.bailToMark(mark)
        // createAssets 使用 history:ignore，因此还必须恢复精确文档快照。
        draft.store.applyDiff(documentDiff(draft.store.serialize('document'), before), { runCallbacks: false })
        draft.scope = scope
        draft.assets = assets
        throw error
    } finally {
        editor.updateInstanceState({ isReadonly: readonly })
    }
}

function batch(inputs: unknown): asserts inputs is Record<string, unknown>[] {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_BOARD_WRITE_SHAPES) {
        throw new Error(`每次操作须包含 1～${MAX_BOARD_WRITE_SHAPES} 项`)
    }

    inputs.forEach(object)
}

/**
 * 在草稿内批量创建 13 类标准元素。输入 type、父坐标 x/y、可选原生 props/通用字段/绑定及新资产。
 * group 必须提供至少两个已授权 children；ID 由程序生成。输出实际原生记录（包含派生属性）。
 * 不接正式同步；非法输入、越界和原生未完成操作时回滚整次调用，保留之前成功步骤。
 */
export function createDraftShapes(
    draft: BoardDraft,
    editor: Editor,
    inputs: readonly CreateDraftShapeInput[],
    options: DraftOperationOptions = {}
): TLShape[] {
    task(draft, editor)
    batch(inputs)
    inputs.forEach(input => validate(editor, input.type, input, true))

    return execute(
        draft,
        editor,
        options,
        () => inputs.map(input => {
            const id = createShapeId()

            parent(draft, editor, input.parentId ?? draft.pageId)
            draft.scope.add(id)

            if (input.type === 'group') {
                if (!Array.isArray(input.children) || input.children.length < 2
                    || new Set(input.children).size !== input.children.length) {
                    throw new Error('group 需要至少两个不重复的子对象')
                }

                input.children.forEach(child => target(draft, editor, child))
                editor.setCurrentTool('select')
                editor.groupShapes([...input.children], { groupId: id, select: false })
                editor.reparentShapes([id], input.parentId ?? draft.pageId)
            } else {
                editor.createShapes([{
                    id,
                    type: input.type,
                    parentId: input.parentId ?? draft.pageId,
                    x: input.x,
                    y: input.y,
                    props: input.props
                } as TLShapePartial])
            }

            write(editor, id, input.type, input)
            setBindings(draft, editor, editor.getShape(id)!, input.bindings)

            return assertResult(editor.getShape(id), input)
        })
    )
}

/**
 * 修改范围内真实 ID；省略字段保留原值（原生联动/派生字段除外），parentId 切换保留页面位置，显式 x/y 随后覆盖。
 * 输入 id、可选 props/通用字段/端点绑定及新资产；输出修改后的完整记录。身份与派生属性只读。
 * 锁定对象只能先显式 isLocked:false 解锁；失败回滚本次批量，包括资产和绑定。
 */
export function updateDraftShapes(
    draft: BoardDraft,
    editor: Editor,
    inputs: readonly UpdateDraftShapeInput[],
    options: DraftOperationOptions = {}
): TLShape[] {
    task(draft, editor)
    batch(inputs)

    if (new Set(inputs.map(item => item.id)).size !== inputs.length) {
        throw new Error('目标 ID 重复')
    }

    const targets = inputs.map(input => {
        const shape = target(draft, editor, input.id, input.isLocked === false)

        validate(editor, shape.type, input, false, shape)

        if (Object.keys(input).length < 2) {
            throw new Error('至少提供一个修改字段')
        }
        if (input.parentId) {
            parent(draft, editor, input.parentId, shape.id)
        }

        return shape
    })

    return execute(
        draft,
        editor,
        options,
        () => inputs.map((input, index) => {
            const shape = targets[index]

            if (input.isLocked === false) {
                editor.updateShapes([{
                    id: shape.id,
                    type: shape.type,
                    isLocked: false
                }])
            }
            if (input.parentId && input.parentId !== shape.parentId) {
                editor.reparentShapes([shape.id], input.parentId)
            }

            write(editor, shape.id, shape.type, input)
            setBindings(draft, editor, editor.getShape(shape.id)!, input.bindings)

            return assertResult(editor.getShape(shape.id), input)
        })
    )
}

/**
 * 输入 1～30 个范围内、不重复且已解锁的 ID；输出删除的请求 ID。容器后代/受影响箭头也须已授权。
 * 原生同时处理子对象与绑定；任何越界副作用将整次回滚。新建后删除的对象不进入正式数据。
 */
export function deleteDraftShapes(draft: BoardDraft, editor: Editor, ids: readonly TLShapeId[]): TLShapeId[] {
    task(draft, editor)

    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BOARD_WRITE_SHAPES || new Set(ids).size !== ids.length) {
        throw new Error(`删除需要 1～${MAX_BOARD_WRITE_SHAPES} 个不重复 ID`)
    }

    ids.forEach(id => target(draft, editor, id))

    return execute(
        draft,
        editor,
        {},
        () => {
            editor.deleteShapes([...ids])

            if (ids.some(id => editor.getShape(id))) {
                throw new Error('原生 API 未完成删除')
            }

            return [...ids]
        }
    )
}
