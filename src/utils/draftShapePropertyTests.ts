import {
    createTLStore,
    isEqual,
    toRichText,
    type Editor,
    type TLPageId,
    type TLShape,
    type TLShapeId
} from 'tldraw'
import {
    applyBoardDraft,
    DRAFT_SHAPE_TYPES,
    documentDiff,
    type BoardDraft,
    type DraftShapeType
} from './boardDraft'
import {
    createDraftShapes,
    deleteDraftShapes,
    updateDraftShapes,
    type CreateDraftShapeInput,
    type DraftBindings,
    type UpdateDraftShapeInput
} from './draftShapeOperations'
import {
    BASE_SHAPE_PROPS,
    BINDING_PROPERTY_CASES,
    BINDING_ENUM_PROPERTY_VALUES,
    ENUM_PROPERTY_VALUES,
    SHAPE_PROPERTY_CASES,
    TEST_ASSETS
} from './draftShapeTestCases'

export type PropertyTestResult = {
    type: string
    property: string
    stage: string
    passed: boolean
    message?: string
}

export type PropertyTestReport = {
    results: PropertyTestResult[]
    passed: number
    failed: number
    cancelled: boolean
}

const expect = (condition: unknown, message: string) => {
    if (!condition) {
        throw new Error(message)
    }
}

const same = (actual: unknown, expected: unknown, message: string) => expect(
    isEqual(actual, expected),
    `${message}: ${JSON.stringify(actual)?.slice(0, 300)} != ${JSON.stringify(expected)?.slice(0, 300)}`
)

const props = (shape: TLShape) => shape.props as Record<string, unknown>

const options = { assets: TEST_ASSETS }

/**
 * 在当前临时 Editor 中逐项测试，始终恢复运行前文档；从不写正式 Store。
 * 输入 Editor/页面/进度回调/取消条件，输出每项通过或失败明细。覆盖全部 native props、枚举、通用字段和绑定。
 * 这是数据与原生 Editor 行为验收；不代表远端视频播放、上传或多人网络已验证。
 */
export async function runDraftPropertyTests(
    editor: Editor,
    pageId: TLPageId,
    progress: (report: PropertyTestReport) => void,
    cancelled: () => boolean
): Promise<PropertyTestReport> {
    const report: PropertyTestReport = {
        results: [],
        passed: 0,
        failed: 0,
        cancelled: false
    }
    const original = structuredClone(editor.store.serialize('document'))
    let crashed = false
    const onCrash = () => {
        crashed = true
    }

    editor.on('crash', onCrash)
    let draft: BoardDraft
    let groupChildren: TLShapeId[] = []
    const test = async (type: string, property: string, stage: string, operation: () => void) => {
        if (cancelled() || editor.isDisposed) {
            report.cancelled = true

            return
        }

        const before = structuredClone(editor.store.getStoreSnapshot('document'))

        draft = {
            runId: crypto.randomUUID(),
            pageId,
            store: editor.store,
            baseline: before,
            scope: new Set(),
            assets: new Set(),
            status: 'active'
        }
        const mark = editor.markHistoryStoppingPoint('property-test')

        try {
            groupChildren = type === 'group' ? createDraftShapes(
                draft,
                editor,
                [0, 1].map(i => ({
                    type: 'geo',
                    x: i * 150,
                    y: 0,
                    props: { w: 100, h: 100 }
                }))
            ).map(s => s.id) : []
            operation()
            report.results.push({
                type,
                property,
                stage,
                passed: true
            })
            report.passed++
        } catch (cause) {
            report.results.push({
                type,
                property,
                stage,
                passed: false,
                message: cause instanceof Error ? cause.message : String(cause)
            })
            report.failed++
        } finally {
            if (!editor.isDisposed) {
                editor.bailToMark(mark)
                editor.store.applyDiff(
                    documentDiff(editor.store.serialize('document'), before.store),
                    { runCallbacks: false }
                )
            }
        }

        if (report.results.length % 10 === 0) {
            progress({ ...report, results: [...report.results] })
            await new Promise(resolve => setTimeout(resolve, 0))
        }
    }
    const create = (
        type: DraftShapeType,
        extra: Record<string, unknown> = {},
        common: Record<string, unknown> = {}
    ) => {
        const children = type === 'group' ? groupChildren : undefined

        return createDraftShapes(
            draft,
            editor,
            [{
                type,
                x: 20,
                y: 30,
                props: { ...BASE_SHAPE_PROPS[type], ...extra },
                ...(children ? { children } : {}),
                ...common
            } as CreateDraftShapeInput],
            options
        )[0]
    }
    const commit = (shape: TLShape) => {
        const target = createTLStore({ schema: editor.store.schema, snapshot: draft.baseline })

        try {
            applyBoardDraft(draft, target)
            same(target.get(shape.id), shape, '提交记录不一致')
        } finally {
            target.dispose()
        }
    }
    const reject = (operation: () => void) => {
        const before = structuredClone(editor.store.serialize('document'))
        const scope = [...draft.scope].sort()
        const assets = [...draft.assets].sort()
        let threw = false

        try {
            operation()
        } catch {
            threw = true
        }

        expect(threw, '非法输入被接受')
        same(editor.store.serialize('document'), before, '失败后文档没有精确恢复')
        same([...draft.scope].sort(), scope, '失败后 scope 改变')
        same([...draft.assets].sort(), assets, '失败后资产范围改变')
        expect(!crashed, '预期拒绝导致 Editor 进入崩溃状态')
    }

    try {
        for (const type of DRAFT_SHAPE_TYPES) {
            await test(
                type,
                '*',
                '属性清单完整性',
                () => {
                    const native = (editor.getShapeUtil(type).constructor as unknown as { props: object }).props

                    same(Object.keys(SHAPE_PROPERTY_CASES[type]).sort(), Object.keys(native).sort(), '新增原生属性缺少测试')
                }
            )

            for (const [key, item] of Object.entries(SHAPE_PROPERTY_CASES[type])) {
                if (report.cancelled) {
                    break
                }

                await test(
                    type,
                    key,
                    item.readonly ? '派生属性拒写/读取/提交' : '新增/读取/提交',
                    () => {
                        if (item.readonly) {
                            reject(() => create(type, { [key]: item.value }))
                            const shape = create(type, type === 'geo' ? { richText: toRichText('短标签') } : {})

                            expect(typeof props(shape)[key] === 'number' && Number.isFinite(props(shape)[key]), '派生结果无效')

                            if (type === 'bookmark') {
                                const [changed] = updateDraftShapes(
                                    draft,
                                    editor,
                                    [{ id: shape.id, props: { assetId: SHAPE_PROPERTY_CASES.bookmark.assetId.value } } as UpdateDraftShapeInput],
                                    options
                                )

                                expect(props(changed).h !== props(shape).h, '资产变化未派生书签高度')
                                commit(changed)
                            } else {
                                const [changed] = updateDraftShapes(
                                    draft,
                                    editor,
                                    [{
                                        id: shape.id,
                                        props: { richText: toRichText(key === 'fontSizeAdjustment' ? 'W'.repeat(100) : '很长的文字 '.repeat(120)) }
                                    }],
                                    options
                                )

                                expect(!isEqual(props(shape)[key], props(changed)[key]), '长标签未改变派生属性')
                                commit(changed)
                            }
                        } else {
                            const shape = create(type, { ...item.setup, [key]: item.value })

                            same(props(shape)[key], item.value, '新增属性不一致')
                            commit(shape)
                        }
                    }
                )
                await test(
                    type,
                    key,
                    '修改/保留省略字段/提交',
                    () => {
                        const shape = create(type, item.setup)

                        if (item.readonly) {
                            reject(() => updateDraftShapes(draft, editor, [{ id: shape.id, props: { [key]: item.value } }], options))

                            return
                        }

                        const [updated] = updateDraftShapes(draft, editor, [{ id: shape.id, props: { [key]: item.value } }], options)

                        same(props(updated)[key], item.value, '修改属性不一致')
                        const [moved] = updateDraftShapes(draft, editor, [{ id: shape.id, x: updated.x + 7 }])

                        same(props(moved), props(updated), '只改位置时省略属性被改动')
                        commit(moved)
                    }
                )
                await test(
                    type,
                    key,
                    '非法新增/修改及精确回滚',
                    () => {
                        reject(() => create(type, { ...item.setup, [key]: item.invalid }))
                        const shape = create(type, item.setup)

                        reject(() => updateDraftShapes(draft, editor, [{ id: shape.id, props: { [key]: item.invalid } }], options))
                    }
                )

                for (const value of ENUM_PROPERTY_VALUES[type]?.[key] ?? []) {
                    await test(
                        type,
                        key,
                        `枚举 ${String(value)} 新增及修改`,
                        () => {
                            const initial = create(type, { ...item.setup, [key]: value })

                            same(props(initial)[key], value, '枚举新增不一致')
                            const other = (ENUM_PROPERTY_VALUES[type][key]).find(candidate => !isEqual(candidate, value))

                            if (other !== undefined) {
                                updateDraftShapes(draft, editor, [{ id: initial.id, props: { [key]: other } }])
                            }

                            const [updated] = updateDraftShapes(draft, editor, [{ id: initial.id, props: { [key]: value } }])

                            same(props(updated)[key], value, '枚举修改不一致')
                            commit(updated)
                        }
                    )
                }
            }

            const commonCases: Record<string, {
                value: unknown
                invalid: unknown
            }> = {
                x: { value: -110, invalid: NaN },
                y: { value: 240, invalid: Infinity },
                rotation: { value: 0.5, invalid: 'bad' },
                opacity: { value: 0.4, invalid: 2 },
                index: { value: 'a9', invalid: 'bad index' },
                isLocked: { value: true, invalid: 1 },
                meta: { value: { origin: 'property-test', nested: [1, true, null] }, invalid: { n: Infinity } },
            }

            for (const [key, item] of Object.entries(commonCases)) {
                await test(
                    type,
                    key,
                    '通用字段新增/修改/拒写/提交',
                    () => {
                        reject(() => create(type, {}, { [key]: item.invalid }))
                        const shape = create(type, {}, { [key]: item.value })

                        same(shape[key as keyof TLShape], item.value, '通用字段新增不一致')

                        if (key === 'isLocked') {
                            updateDraftShapes(draft, editor, [{ id: shape.id, isLocked: false }])
                        }

                        reject(() => updateDraftShapes(draft, editor, [{ id: shape.id, [key]: item.invalid }]))
                        const [changed] = updateDraftShapes(draft, editor, [{ id: shape.id, [key]: item.value }])

                        same(changed[key as keyof TLShape], item.value, '通用字段修改不一致')
                        commit(changed)
                    }
                )
            }

            await test(
                type,
                'parentId',
                '创建/重设父对象/坐标/非法父对象',
                () => {
                    const frame = create('frame')
                    const shape = create(type, {}, {
                        parentId: frame.id,
                        x: 40,
                        y: 60
                    })

                    same(shape.parentId, frame.id, '创建父对象不一致')
                    same(shape.x, 40, '父坐标不一致')
                    const [updated] = updateDraftShapes(draft, editor, [{
                        id: shape.id,
                        parentId: pageId,
                        x: 90,
                        y: 100
                    }])

                    same(updated.parentId, pageId, '重设父对象失败')
                    same(updated.x, 90, '重设坐标失败')
                    reject(() => updateDraftShapes(draft, editor, [{ id: shape.id, parentId: shape.id }]))
                    reject(() => create(type, {}, { parentId: 'shape:missing' }))
                    commit(updated)
                }
            )
            await test(
                type,
                'id/type/typeName',
                '身份不可写/越界/删除',
                () => {
                    const shape = create(type)

                    for (const field of ['id', 'typeName']) {
                        reject(() => create(type, {}, { [field]: 'invalid' }))
                    }

                    for (const field of ['type', 'typeName']) {
                        reject(() => updateDraftShapes(draft, editor, [{ id: shape.id, [field]: 'invalid' } as UpdateDraftShapeInput]))
                    }

                    draft.scope.delete(shape.id)
                    reject(() => updateDraftShapes(draft, editor, [{ id: shape.id, x: 9 }]))
                    reject(() => deleteDraftShapes(draft, editor, [shape.id]))
                    draft.scope.add(shape.id)
                    deleteDraftShapes(draft, editor, [shape.id])
                    expect(!editor.getShape(shape.id), '删除失败')
                    const target = createTLStore({ schema: editor.store.schema, snapshot: draft.baseline })

                    try {
                        same(target.get(shape.id), undefined, '删除对象出现在提交结果')
                    } finally {
                        target.dispose()
                    }
                }
            )
            await test(
                type,
                'delete',
                '已有基线对象删除/提交/锁定保护',
                () => {
                    const shape = create(type)

                    updateDraftShapes(draft, editor, [{ id: shape.id, isLocked: true }])
                    draft.baseline = structuredClone(editor.store.getStoreSnapshot('document'))
                    draft.assets.clear()
                    reject(() => deleteDraftShapes(draft, editor, [shape.id]))
                    updateDraftShapes(draft, editor, [{ id: shape.id, isLocked: false }])
                    deleteDraftShapes(draft, editor, [shape.id])
                    const target = createTLStore({ schema: editor.store.schema, snapshot: draft.baseline })

                    try {
                        applyBoardDraft(draft, target)
                        expect(!target.has(shape.id), '基线对象删除没有提交')

                        for (const child of groupChildren) {
                            expect(!target.has(child), '删除组后残留子对象')
                        }
                    } finally {
                        target.dispose()
                    }
                }
            )
        }

        for (const [key, item] of Object.entries(BINDING_PROPERTY_CASES)) {
            const values = BINDING_ENUM_PROPERTY_VALUES[key] ?? [item.value]

            for (const value of values) {
                await test(
                    'binding',
                    key,
                    `绑定新增/修改/提交/解绑 ${String(value)}`,
                    () => {
                        const endpoint = create('geo')
                        const terminal = key === 'terminal' ? value as 'start' | 'end' : 'end'
                        const binding = { toId: endpoint.id, ...(key === 'terminal' ? {} : { [key]: value }) }
                        const arrow = create('arrow', {}, { bindings: { [terminal]: binding } })

                        // 重新指定已有端点，覆盖 updateBindings 路径，防止只验证首次创建。
                        updateDraftShapes(
                            draft,
                            editor,
                            [{
                                id: arrow.id,
                                bindings: {
                                    [terminal]: {
                                        toId: endpoint.id,
                                        normalizedAnchor: { x: 0.9, y: 0.1 },
                                        isExact: false,
                                        isPrecise: true,
                                        snap: 'center'
                                    }
                                }
                            }]
                        )
                        const [bound] = updateDraftShapes(draft, editor, [{ id: arrow.id, bindings: { [terminal]: binding } as DraftBindings }])
                        const actual = editor.getBindingsFromShape(bound.id, 'arrow')[0]

                        same(actual.props[key as keyof typeof actual.props], value, '绑定属性不一致')
                        updateDraftShapes(draft, editor, [{ id: endpoint.id, x: 450 }])
                        expect(editor.getBindingsFromShape(bound.id, 'arrow').length === 1, '移动目标后丢失绑定')
                        const target = createTLStore({ schema: editor.store.schema, snapshot: draft.baseline })

                        try {
                            applyBoardDraft({ ...draft }, target)
                            same(target.get(actual.id), editor.store.get(actual.id), '绑定提交不一致')
                        } finally {
                            target.dispose()
                        }

                        updateDraftShapes(draft, editor, [{ id: arrow.id, bindings: { [terminal]: null } }])
                        expect(!editor.getBindingsFromShape(arrow.id, 'arrow').length, '解绑失败')
                        reject(() => updateDraftShapes(
                            draft,
                            editor,
                            [{
                                id: arrow.id,
                                bindings: key === 'terminal' ? { [String(item.invalid)]: { toId: endpoint.id } } as DraftBindings : { end: { toId: endpoint.id, [key]: item.invalid } } as DraftBindings
                            }]
                        ))
                    }
                )
            }
        }

        await test(
            'batch',
            'atomicity',
            '混合批量失败/资产回滚/保留前次操作',
            () => {
                const initial = create('geo')

                reject(() => createDraftShapes(
                    draft,
                    editor,
                    [{
                        type: 'image',
                        x: 0,
                        y: 0,
                        props: { assetId: TEST_ASSETS[0].id }
                    }, {
                        type: 'group',
                        x: 0,
                        y: 0,
                        children: []
                    }],
                    { assets: TEST_ASSETS }
                ))
                expect(editor.getShape(initial.id), '前次成功对象被撤销')
                reject(() => createDraftShapes(
                    draft,
                    editor,
                    [{
                        type: 'image',
                        x: 0,
                        y: 0,
                        props: { assetId: TEST_ASSETS[2].id }
                    }],
                    options
                ))
            }
        )
        await test(
            'geometry',
            'segments/points',
            '空几何/损坏路径拒绝及回滚',
            () => {
                for (const type of ['draw', 'highlight'] as const) {
                    reject(() => createDraftShapes(draft, editor, [{
                        type,
                        x: 0,
                        y: 0
                    }]))
                    reject(() => create(type, { segments: [{ type: 'free', path: 'bad' }] }))
                    const shape = create(type)

                    reject(() => updateDraftShapes(draft, editor, [{ id: shape.id, props: { segments: [] } }]))
                }

                reject(() => create('line', { points: {} }))
                const line = create('line')

                reject(() => updateDraftShapes(draft, editor, [{ id: line.id, props: { points: {} } }]))
            }
        )
        await test(
            'group',
            'parentId',
            'frame 内子对象组建后默认归属页面',
            () => {
                const frame = create('frame')
                const children = createDraftShapes(draft, editor, [0, 1].map(i => ({
                    type: 'geo',
                    x: i * 100,
                    y: 0,
                    parentId: frame.id
                }))).map(s => s.id)
                const [group] = createDraftShapes(draft, editor, [{
                    type: 'group',
                    x: 70,
                    y: 80,
                    children
                }])

                same(group.parentId, pageId, '省略 parentId 没有使用页面')
                same(group.x, 70, '组坐标错误')
                commit(group)
            }
        )
        await test(
            'editor',
            'lifecycle',
            '原生 Editor 在所有预期失败后仍可正常使用',
            () => {
                expect(!crashed, 'Editor 已崩溃')
                const shape = create('line')

                updateDraftShapes(draft, editor, [{ id: shape.id, x: 240 }])
                deleteDraftShapes(draft, editor, [shape.id])
            }
        )
    } finally {
        editor.off('crash', onCrash)

        if (!editor.isDisposed) {
            editor.store.applyDiff(documentDiff(editor.store.serialize('document'), original), { runCallbacks: false })
        }

        progress({ ...report, results: [...report.results] })
    }

    return report
}
