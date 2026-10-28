'use client'

import {
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode
} from 'react'
import { useSearchParams } from 'next/navigation'
import { Editor, Tldraw, type TLShapeId } from 'tldraw'
import useEditorStore from '@/app/store/useEditorStore'
import useStyleStore from '@/app/store/useStyleStore'
import {
    applyBoardDraft,
    createBoardDraft,
    discardBoardDraft,
    getDraftChanges,
    type BoardDraft,
    type DraftChanges
} from '@/utils/boardDraft'
import {
    createDraftShapes,
    updateDraftShapes,
    deleteDraftShapes,
    type CreateDraftShapeInput
} from '@/utils/draftShapeOperations'
import { DRAFT_SHAPE_TYPES, type DraftShapeType } from '@/utils/boardDraft'
import { BASE_SHAPE_PROPS, SHAPE_PROPERTY_CASES, TEST_ASSETS } from '@/utils/draftShapeTestCases'
import { runDraftPropertyTests, type PropertyTestReport } from '@/utils/draftShapePropertyTests'
import { getConfirmedRoomRole } from '@/utils/roomAccess'
import { createBoardToolRunner } from '@/utils/executeBoardCreateTool'
import { streamBoardCreateRun, type CreateAgentStep } from '@/utils/streamBoardCreateRun'
import { toast } from '@/components/Toast'
import Modal from '../Modal/Modal'
import styles from './BoardDraft.module.scss'

const BoardDraftContext = createContext({
    active: false,
    canStart: false,
    startDraft: () => { }
})

export const useBoardDraft = () => useContext(BoardDraftContext)

const EMPTY_CHANGES: DraftChanges = {
    added: [],
    updated: [],
    removed: []
}

type Preview = {
    draft: BoardDraft
    camera: {
        x: number
        y: number
        z: number
    }
    center: {
        x: number
        y: number
    }
}

type Props = {
    editor: Editor | null
    licenseKey: string
    roomId: string
    canEdit: boolean
    local?: boolean
    children: ReactNode
}

export default function BoardDraftProvider({ editor, licenseKey, roomId, canEdit, local = false, children }: Props) {
    const [preview, setPreview] = useState<Preview | null>(null)
    const [ready, setReady] = useState(false)
    const [applying, setApplying] = useState(false)
    const [error, setError] = useState('')
    const [changes, setChanges] = useState<DraftChanges>(EMPTY_CHANGES)
    const [targetId, setTargetId] = useState<TLShapeId | null>(null)
    const [operationResult, setOperationResult] = useState('')
    const [shapeType, setShapeType] = useState<DraftShapeType>('geo')
    const [testing, setTesting] = useState(false)
    const [testReport, setTestReport] = useState<PropertyTestReport | null>(null)
    const [agentPrompt, setAgentPrompt] = useState('画一个蓝色的圆')
    const [agentRunning, setAgentRunning] = useState(false)
    const [agentSteps, setAgentSteps] = useState<CreateAgentStep[]>([])
    const [agentText, setAgentText] = useState('')
    const draftEditorRef = useRef<Editor | null>(null)
    const activeRef = useRef<BoardDraft | null>(null)
    const requestRef = useRef<AbortController | null>(null)
    const agentRequestRef = useRef<AbortController | null>(null)
    const canEditRef = useRef(canEdit)
    const triggerRef = useRef<HTMLElement | null>(null)
    const theme = useStyleStore(state => state.theme)
    const mode = useSearchParams().get('mode')

    useEffect(
        () => {
            canEditRef.current = canEdit

            if (!canEdit) {
                agentRequestRef.current?.abort()
            }

            if (!editor || editor.isDisposed) {
                return
            }

            editor.updateInstanceState({ isReadonly: !!preview || !canEdit })
        },
        [editor, preview, canEdit]
    )

    useLayoutEffect(
        () => () => {
            if (activeRef.current) {
                discardBoardDraft(activeRef.current)
            }

            activeRef.current = null
            requestRef.current?.abort()
            requestRef.current = null
            agentRequestRef.current?.abort()
            agentRequestRef.current = null
            setPreview(null)
            setReady(false)
            setApplying(false)
            setError('')
            setChanges(EMPTY_CHANGES)
            setTargetId(null)
            setOperationResult('')
            setTesting(false)
            setTestReport(null)
            setAgentRunning(false)
            setAgentSteps([])
            setAgentText('')
            draftEditorRef.current = null
        },
        [roomId, mode]
    )

    const closeDraft = () => {
        if (activeRef.current) {
            discardBoardDraft(activeRef.current)
        }

        activeRef.current = null
        requestRef.current?.abort()
        requestRef.current = null
        agentRequestRef.current?.abort()
        agentRequestRef.current = null
        setPreview(null)
        setReady(false)
        setApplying(false)
        setError('')
        setChanges(EMPTY_CHANGES)
        setTargetId(null)
        setOperationResult('')
        setTesting(false)
        setTestReport(null)
        setAgentRunning(false)
        setAgentSteps([])
        setAgentText('')
        draftEditorRef.current = null
        requestAnimationFrame(() => triggerRef.current?.isConnected && triggerRef.current.focus())
    }

    const startDraft = () => {
        if (!editor || editor.isDisposed || !canEdit || activeRef.current || mode !== 'edgeless') {
            return
        }

        try {
            editor.complete()
            const selectedIds = editor.getSelectedShapeIds()
            const draft = createBoardDraft(editor.store, editor.getCurrentPageId(), selectedIds)
            const { x, y, z } = editor.getCamera()
            const { x: centerX, y: centerY } = editor.getViewportPageBounds().center

            triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            activeRef.current = draft
            editor.updateInstanceState({ isReadonly: true })
            editor.blur()
            setError('')
            setReady(false)
            setChanges(EMPTY_CHANGES)
            setTargetId(selectedIds[0] ?? null)
            setOperationResult('')
            setPreview({
                draft,
                camera: {
                    x,
                    y,
                    z
                },
                center: { x: centerX, y: centerY }
            })
        } catch (cause) {
            toast.show(cause instanceof Error ? cause.message : '无法创建草稿')
        }
    }

    // 固定数据仅用于人工验证；所有写入均经过三个操作入口。
    const testOperation = (kind: 'create' | 'update' | 'delete') => {
        const draftEditor = draftEditorRef.current

        if (!preview || !draftEditor || activeRef.current !== preview.draft || !ready || testing || applying || agentRequestRef.current || !canEdit) {
            return
        }

        try {
            setError('')

            if (kind === 'create') {
                const children = shapeType === 'group' ? createDraftShapes(
                    preview.draft,
                    draftEditor,

                    [0, 1].map(i => ({
                        type: 'geo',
                        x: preview.center.x + i * 140,
                        y: preview.center.y,
                        props: { w: 100, h: 100 }
                    }))
                ).map(shape => shape.id) : undefined
                const [shape] = createDraftShapes(
                    preview.draft,
                    draftEditor,
                    [{
                        type: shapeType,
                        x: preview.center.x - 100,
                        y: preview.center.y - 60,
                        props: BASE_SHAPE_PROPS[shapeType],
                        ...(children ? { children } : {})
                    } as CreateDraftShapeInput],
                    { assets: TEST_ASSETS }
                )

                setTargetId(shape.id)
                setOperationResult(JSON.stringify(shape, null, 2))
            } else if (kind === 'update' && targetId) {
                const target = draftEditor.getShape(targetId)

                if (!target) {
                    throw new Error('目标不存在')
                }

                const sample = Object.entries(SHAPE_PROPERTY_CASES[target.type]).find(([key, item]) => !item.readonly && key !== 'assetId')
                const [shape] = updateDraftShapes(
                    preview.draft,
                    draftEditor,
                    [{
                        id: targetId,
                        x: preview.center.x + 70,
                        y: preview.center.y - 20,
                        ...(sample ? { props: { ...sample[1].setup, [sample[0]]: sample[1].value } } : {})
                    }],
                    { assets: TEST_ASSETS }
                )

                setOperationResult(JSON.stringify(shape, null, 2))
            } else if (kind === 'delete' && targetId) {
                const [id] = deleteDraftShapes(preview.draft, draftEditor, [targetId])

                setTargetId([...preview.draft.scope].find(candidate => candidate !== id && preview.draft.store.has(candidate)) ?? null)
                setOperationResult('删除成功：' + id)
            }

            setChanges(getDraftChanges(preview.draft))
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '操作失败，本次调用已回滚')
        }
    }

    const testAllProperties = async () => {
        const draft = activeRef.current
        const draftEditor = draftEditorRef.current

        if (!draft || !draftEditor || testing || applying || agentRequestRef.current || !ready) {
            return
        }

        setTesting(true)
        setTestReport(null)
        setError('')

        try {
            await runDraftPropertyTests(
                draftEditor,
                draft.pageId,
                report => {
                    if (activeRef.current === draft) {
                        setTestReport(report)
                    }
                },
                () => activeRef.current !== draft || draft.status !== 'active'
            )
        } catch (cause) {
            if (activeRef.current === draft) {
                setError(cause instanceof Error ? cause.message : '属性测试无法完成')
            }
        } finally {
            if (activeRef.current === draft) {
                setTesting(false)
            }
        }
    }

    // 前端只启动任务、接收事件和执行本地工具；模型循环由后端持有。
    const runAgent = async () => {
        const draft = activeRef.current
        const draftEditor = draftEditorRef.current

        if (!draft || !draftEditor || !preview || !ready || testing || applying || agentRequestRef.current || !canEdit) {
            return
        }

        const prompt = agentPrompt.trim()
        if (!prompt) return

        const controller = new AbortController()
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(80000)])
        const reference = { ...preview.center }

        agentRequestRef.current = controller
        setAgentRunning(true)
        setAgentSteps([])
        setAgentText('')
        setError('')

        const assertActive = () => {
            signal.throwIfAborted()

            if (activeRef.current !== draft || draft.status !== 'active' || draftEditorRef.current !== draftEditor || !canEditRef.current) {
                throw new Error('任务已失效或编辑权限已改变')
            }
        }

        const execute = createBoardToolRunner({
            reference,
            assertActive,
            create: inputs => {
                assertActive()
                const shapes = createDraftShapes(draft, draftEditor, inputs)

                setTargetId(shapes[0].id)
                setChanges(getDraftChanges(draft))
                setOperationResult(JSON.stringify(shapes, null, 2))
                return shapes
            },
        })

        try {
            const result = await streamBoardCreateRun({ roomId, prompt, reference }, signal, execute, step => {
                if (activeRef.current === draft && agentRequestRef.current === controller) {
                    setAgentSteps(previous => [...previous, step])
                }
            })

            assertActive()
            setAgentText(result.text)
        } catch (cause) {
            if (activeRef.current === draft && !controller.signal.aborted) {
                setError(cause instanceof Error ? cause.message : 'AI 新增失败，已成功的内容保留在草稿中')
            }
        } finally {
            if (agentRequestRef.current === controller) {
                agentRequestRef.current = null
                setAgentRunning(false)
            }
        }
    }

    const applyDraft = async () => {
        const draft = activeRef.current

        if (!editor || editor.isDisposed || !draft || !ready || testing || agentRequestRef.current || requestRef.current) {
            return
        }

        const controller = new AbortController()

        requestRef.current = controller
        setApplying(true)
        setError('')

        try {
            if (!canEdit) {
                throw new Error('当前没有白板编辑权限')
            }
            if (!local) {
                const response = await fetch(
                    '/api/entry-validations',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ roomId }),
                        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
                    }
                )
                const result = await response.json()

                if (activeRef.current !== draft || controller.signal.aborted) {
                    return
                }

                const confirmedRole = getConfirmedRoomRole(response.status, result)

                if (confirmedRole !== undefined) {
                    useEditorStore.getState().setRole(confirmedRole)
                }
                if (confirmedRole !== 'owner' && confirmedRole !== 'collaborator') {
                    throw new Error('编辑权限已失效，无法应用草稿')
                }

                const role = useEditorStore.getState().role

                if (role !== 'owner' && role !== 'collaborator') {
                    throw new Error('当前没有白板编辑权限')
                }
            }

            if (activeRef.current !== draft || controller.signal.aborted) {
                return
            }
            if (editor.getCurrentPageId() !== draft.pageId) {
                throw new Error('当前页面已切换，请放弃草稿后重试')
            }

            editor.markHistoryStoppingPoint('apply-board-draft')
            const summary = applyBoardDraft(draft, editor.store)

            editor.setSelectedShapes(editor.getSelectedShapeIds().filter(id => !!editor.getShape(id)))
            closeDraft()
            toast.show(`已应用：新增 ${summary.added}，修改 ${summary.updated}，删除 ${summary.removed}`)
        } catch (cause) {
            if (activeRef.current === draft && !controller.signal.aborted) {
                setError(cause instanceof Error ? cause.message : '应用失败，请重试或放弃草稿')
            }
        } finally {
            if (requestRef.current === controller) {
                requestRef.current = null
                setApplying(false)
            }
        }
    }

    return <BoardDraftContext.Provider value={{
        active: !!preview,
        canStart: !!editor && canEdit && !preview && mode === 'edgeless',
        startDraft
    }}>

        <div className={styles.official} inert={!!preview}>
            {children}
        </div>

        <Modal
            isOpen={!!preview}
            closeFn={closeDraft}
            className={styles.overlay}
            containerClassName={styles.container}
        >

            {preview && <section
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-label="白板草稿预览"
                onPaste={event => event.stopPropagation()}
                onKeyUp={event => event.stopPropagation()}
                onKeyDown={event => {
                    event.stopPropagation()

                    if (event.key === 'Escape') {
                        event.preventDefault()
                        closeDraft()
                    }

                    if (event.key !== 'Tab') {
                        return
                    }

                    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
                        .filter(button => !button.closest('[inert]'))
                    const first = buttons[0]
                    const last = buttons[buttons.length - 1]

                    if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault()
                        last?.focus()
                    }

                    if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault()
                        first?.focus()
                    }
                }}
            >

                <header className={styles.header}>

                    <div>
                        <h2>白板草稿</h2>
                        <p>修改先进入草稿，确认后应用到正式白板</p>
                    </div>

                    <button
                        type="button"
                        onClick={closeDraft}
                        autoFocus
                    >{agentRunning ? '停止并放弃草稿' : '放弃草稿'}</button>

                </header>

                <div className={styles.tests}>

                    <form className={styles.agent} onSubmit={event => { event.preventDefault(); void runAgent() }}>
                        <label htmlFor={`create-agent-${preview.draft.runId}`}>AI 新增 · 最小闭环</label>
                        <div className={styles.testActions}>
                            <input
                                id={`create-agent-${preview.draft.runId}`}
                                aria-label="AI 新增需求"
                                value={agentPrompt}
                                maxLength={1000}
                                disabled={agentRunning || testing || applying || !canEdit}
                                onChange={event => setAgentPrompt(event.target.value)}
                            />
                            <button type="submit" disabled={!ready || agentRunning || testing || applying || !canEdit || !agentPrompt.trim()}>
                                {agentRunning ? 'AI 新增中…' : '让 AI 新增'}
                            </button>
                        </div>
                        <p>本版新增圆/椭圆、矩形、菱形，每次最多 5 个；以进入草稿时的视口中心为参照点。</p>
                        {agentSteps.length > 0 && <details className={styles.report} open>
                            <summary>工具闭环记录（{agentSteps.length}/4）</summary>
                            <ol aria-label="新增工具执行记录">
                                {agentSteps.map(step => <li key={step.stage}>
                                    {step.message}
                                    {step.data && <pre>{JSON.stringify(step.data, null, 2)}</pre>}
                                </li>)}
                            </ol>
                        </details>}
                        {agentText && <p role="status" className={styles.result}>模型说明：{agentText}</p>}
                    </form>

                    <div
                        className={styles.testActions}
                        role="group"
                        aria-label="固定数据操作测试"
                    >

                        <label>元素类型 <select
                            aria-label="元素类型"
                            value={shapeType}
                            disabled={testing || applying || agentRunning}
                            onChange={event => setShapeType(event.target.value as DraftShapeType)}
                        >
                            {DRAFT_SHAPE_TYPES.map(type => <option key={type} value={type}>
                                {type}
                            </option>)}
                        </select></label>

                        <button
                            type="button"
                            disabled={!ready || applying || testing || agentRunning || !canEdit}
                            onClick={() => testOperation('create')}
                        >测试新增</button>

                        <button
                            type="button"
                            disabled={!ready || applying || testing || agentRunning || !canEdit || !targetId}
                            onClick={() => testOperation('update')}
                        >测试修改</button>

                        <button
                            type="button"
                            disabled={!ready || applying || testing || agentRunning || !canEdit || !targetId}
                            onClick={() => testOperation('delete')}
                        >测试删除</button>

                    </div>

                    <button
                        type="button"
                        disabled={!ready || applying || testing || agentRunning || !canEdit}
                        onClick={() => void testAllProperties()}
                    >
                        {testing ? '逐属性测试中…' : '运行全属性测试'}
                    </button>

                    <p>覆盖 13 类元素；逐属性测试在当前临时 Editor 中运行并恢复现场。计数包含图形、绑定和资产记录。</p>

                    <p>目标：{targetId || '无。请先新增；也可选中正式白板上的已有图形后重新进入。'}</p>

                    {operationResult && <pre role="status" className={styles.result}>
                        {operationResult}
                    </pre>}

                    {testReport && <details className={styles.report} open={testReport.failed > 0}>

                        <summary role="status">属性测试：通过 {testReport.passed}，失败 {testReport.failed}{testing ? '（运行中）' : testReport.cancelled ? '（已取消）' : '（已完成）'}</summary>

                        <textarea
                            aria-label="逐属性测试报告"
                            readOnly
                            value={JSON.stringify(testReport, null, 2)}
                        />

                    </details>}

                </div>

                <div className={styles.canvas} inert>

                    <Tldraw
                        key={preview.draft.runId}
                        store={preview.draft.store}
                        licenseKey={licenseKey}
                        hideUi
                        autoFocus={false}
                        onMount={draftEditor => {
                            if (activeRef.current !== preview.draft) {
                                return
                            }

                            draftEditor.user.updateUserPreferences({ locale: 'zh-cn', colorScheme: theme === 'dark' ? 'dark' : 'light' })
                            draftEditor.registerExternalAssetHandler('url', null)
                            draftEditor.setCurrentPage(preview.draft.pageId)
                            draftEditor.setCamera(preview.camera)
                            // 弹窗视口比正式画板小，按同一页面中心重新取景，不改变图形坐标。
                            draftEditor.centerOnPoint(preview.center)
                            draftEditor.updateInstanceState({ isReadonly: true })
                            draftEditorRef.current = draftEditor
                            setReady(true)

                            return () => {
                                if (draftEditorRef.current === draftEditor) {
                                    draftEditorRef.current = null
                                }
                            }
                        }}
                    />

                </div>

                <footer className={styles.footer}>

                    <p role={error ? 'alert' : 'status'}>
                        {error || (applying ? '正在检查权限并应用…' : `待应用：新增 ${changes.added.length}，修改 ${changes.updated.length}，删除 ${changes.removed.length}`)}
                    </p>

                    <button
                        type="button"
                        className={styles.apply}
                        disabled={!ready || applying || testing || agentRunning || !canEdit || !changes.added.length && !changes.updated.length && !changes.removed.length}
                        onClick={() => void applyDraft()}
                    >

                        {applying ? '正在应用…' : '应用到白板'}

                    </button>

                </footer>

            </section>}

        </Modal>

    </BoardDraftContext.Provider>
}
