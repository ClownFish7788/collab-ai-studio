'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Editor } from 'tldraw'
import useEditorStore from '@/app/store/useEditorStore'
import useStyleStore from '@/app/store/useStyleStore'
import { applyBoardDraft, createBoardDraft, discardBoardDraft, getDraftChanges, type BoardDraft, type DraftChanges } from '@/agent/adapters/board/draft'
import { createDraftShapes, updateDraftShapes, deleteDraftShapes } from '@/agent/adapters/board/draftShapeOperations'
import { getConfirmedRoomRole } from '@/utils/collaboration/roomAccess'
import { createTldrawTools, captureBoardSnapshot, captureBoardScreenshot } from '@/agent/adapters/board/tldraw'
import { createBrowserToolDispatcher } from '@/agent/adapters/browser/toolDispatcher'
import { requestBoardAnswer, type BoardQuestion } from '@/agent/adapters/interaction/askUser'
import { validateChatSnapshot } from '@/utils/board/snapshot/chatSnapshots'
import { BoardProtocolError } from '../agent/adapters/transport/errors'
import { ERROR_CODES, type BoardCreateRequest } from '../agent/adapters/transport/boardProtocol'
import { reportAgentOperation } from '@/utils/agent-traces/client'
import { streamBoardRun, type CreateAgentStep } from '@/agent/adapters/browser/streamBoardRun'
import { toast } from '@/components/Toast'
import { BOARD_RUN_TIMEOUT_MS } from '@/utils/board/boardCapabilities'

type AgentInput = Omit<BoardCreateRequest, 'roomId'>
type AgentResult = Awaited<ReturnType<typeof streamBoardRun>> & { draftId?: string }
type Resolutions = Record<string, 'applied' | 'discarded' | 'unchanged'>
type Preview = { draft: BoardDraft; camera: { x: number; y: number; z: number } }
const EMPTY_CHANGES: DraftChanges = { added: [], updated: [], removed: [] }
const hasChanges = (changes: DraftChanges) => !!(changes.added.length || changes.updated.length || changes.removed.length)

/** 管理一次白板会话的草稿、请求和挂载握手；界面布局由 Provider 渲染。 */
export function useBoardDraftSession({ editor, roomId, canEdit, local = false }: {
    editor: Editor | null; roomId: string; canEdit: boolean; local?: boolean
}) {
    const [preview, setPreview] = useState<Preview | null>(null)
    const [ready, setReady] = useState(false)
    const [running, setRunning] = useState(false)
    const [applying, setApplying] = useState(false)
    const [error, setError] = useState('')
    const [changes, setChanges] = useState(EMPTY_CHANGES)
    const [question, setQuestion] = useState<BoardQuestion | null>(null)
    const [resolutions, setResolutions] = useState<Resolutions>({})
    const activeRef = useRef<BoardDraft | null>(null)
    // 草稿可以跨多条消息累积，应用/放弃时通知所有参与过的后端任务。
    const draftTraceIds = useRef(new Map<string, Set<string>>())
    const draftEditorRef = useRef<Editor | null>(null)
    const mountWaitRef = useRef<{ id: string; resolve: (editor: Editor) => void } | null>(null)
    const agentRef = useRef<AbortController | null>(null)
    const applyRef = useRef<AbortController | null>(null)
    const canEditRef = useRef(canEdit)
    const theme = useStyleStore(state => state.theme)
    const mode = useSearchParams().get('mode')
    const canRun = !!editor && canEdit && !local && mode === 'edgeless'

    useEffect(() => {
        canEditRef.current = canEdit
        if (!canEdit) { agentRef.current?.abort(); applyRef.current?.abort() }
        if (editor && !editor.isDisposed) editor.updateInstanceState({ isReadonly: !!preview || !canEdit })
    }, [editor, preview, canEdit])

    useEffect(() => {
        draftEditorRef.current?.user.updateUserPreferences({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
    }, [theme])

    useLayoutEffect(() => () => {
        agentRef.current?.abort(); agentRef.current = null
        applyRef.current?.abort(); applyRef.current = null
        if (activeRef.current) {
            const draft = activeRef.current
            try {
                discardBoardDraft(draft)
                for (const id of draftTraceIds.current.get(draft.runId) ?? []) void reportAgentOperation(id, 'draft_discard', 'cancelled')
            } catch (cause) {
                for (const id of draftTraceIds.current.get(draft.runId) ?? []) void reportAgentOperation(id, 'draft_discard', 'error', cause)
            }
        }
        draftTraceIds.current.clear()
        activeRef.current = null; draftEditorRef.current = null; mountWaitRef.current = null
        setPreview(null); setReady(false); setRunning(false); setApplying(false)
        setChanges(EMPTY_CHANGES); setQuestion(null); setError(''); setResolutions({})
    }, [roomId, mode])

    const clearPreview = () => {
        if (activeRef.current) draftTraceIds.current.delete(activeRef.current.runId)
        activeRef.current = null; draftEditorRef.current = null
        setPreview(null); setReady(false); setChanges(EMPTY_CHANGES); setError('')
    }
    const discard = () => {
        agentRef.current?.abort(); applyRef.current?.abort()
        const draft = activeRef.current
        const ids = [...(draft ? draftTraceIds.current.get(draft.runId) ?? [] : [])]
        try {
            if (draft) { discardBoardDraft(draft); setResolutions(previous => ({ ...previous, [draft.runId]: 'discarded' })) }
            for (const id of ids) void reportAgentOperation(id, 'draft_discard', 'success')
            clearPreview()
        } catch (cause) {
            for (const id of ids) void reportAgentOperation(id, 'draft_discard', 'error', cause)
            setError(cause instanceof Error ? cause.message : '放弃草稿失败')
        }
    }

    /** 一次消息对应一次后端任务；首个白板工具惰性创建草稿，等待挂载也受同一停止信号控制。 */
    const run = async (input: AgentInput, callerSignal: AbortSignal, onStep: (step: CreateAgentStep) => void): Promise<AgentResult> => {
        if (!editor || !canRun || agentRef.current || applyRef.current) throw new Error('当前无法启动白板任务')
        callerSignal.throwIfAborted()
        if (input.snapshot) validateChatSnapshot(input.snapshot)
        const controller = new AbortController()
        const signal = AbortSignal.any([callerSignal, controller.signal, AbortSignal.timeout(BOARD_RUN_TIMEOUT_MS)])
        const pageId = editor.getCurrentPageId()
        let draft = activeRef.current
        let draftEditor = draftEditorRef.current
        let traceId: string | undefined
        const linkTrace = () => {
            if (!draft || !traceId) return
            const ids = draftTraceIds.current.get(draft.runId) ?? new Set<string>()
            ids.add(traceId)
            draftTraceIds.current.set(draft.runId, ids)
        }
        agentRef.current = controller
        setRunning(true); setQuestion(null); setError('')
        const assertActive = () => {
            signal.throwIfAborted()
            if (agentRef.current !== controller || editor.isDisposed || editor.getCurrentPageId() !== pageId || !canEditRef.current
                || draft && (draft.status !== 'active' || activeRef.current !== draft)
                || draftEditor && (draftEditor.isDisposed || draftEditor.getCurrentPageId() !== pageId)) throw new Error('任务、页面或编辑权限已失效')
        }
        let mounting: Promise<void> | undefined
        const ensureEditor = () => mounting ??= mountEditor()
        const mountEditor = async () => {
            assertActive()
            if (draftEditor) { linkTrace(); return }
            if (!draft) {
                editor.complete()
                const ids = input.snapshot?.shapes.map(shape => shape.id) ?? []
                if (ids.some(id => !editor.getCurrentPageShapeIds().has(id))) throw new Error('选区已失效，请重新选择')
                draft = createBoardDraft(editor.store, pageId, ids)
                activeRef.current = draft
            }
            linkTrace()
            const currentDraft = draft
            draftEditor = await new Promise<Editor>((resolve, reject) => {
                const onAbort = () => {
                    mountWaitRef.current = null
                    reject(signal.reason)
                }
                signal.addEventListener('abort', onAbort, { once: true })
                mountWaitRef.current = { id: currentDraft.runId, resolve: mounted => {
                    signal.removeEventListener('abort', onAbort)
                    mountWaitRef.current = null
                    resolve(mounted)
                } }
                const { x, y, z } = editor.getCamera()
                editor.updateInstanceState({ isReadonly: true })
                setPreview({ draft: currentDraft, camera: { x, y, z } })
            })
            assertActive()
        }
        const target = () => {
            assertActive()
            if (!draft || !draftEditor) throw new Error('草稿尚未就绪')
            return { draft, editor: draftEditor }
        }
        const board = createTldrawTools({
            snapshot: input.snapshot, pageId, assertActive,
            getShape: id => draftEditor?.getShape(id),
            read: (range, reference) => captureBoardSnapshot(target().editor, range, reference),
            readSelection: async (ids, reference) => { await ensureEditor(); return captureBoardSnapshot(target().editor, 'page', reference, ids) },
            screenshot: (range, reference) => captureBoardScreenshot(target().editor, range, reference),
            authorize: ids => { const current = target(); ids.forEach(id => current.draft.scope.add(id)) },
            create: inputs => { const current = target(); const result = createDraftShapes(current.draft, current.editor, inputs); setChanges(getDraftChanges(current.draft)); return result },
            update: inputs => { const current = target(); const result = updateDraftShapes(current.draft, current.editor, inputs); setChanges(getDraftChanges(current.draft)); return result },
            remove: ids => { const current = target(); const result = deleteDraftShapes(current.draft, current.editor, ids); setChanges(getDraftChanges(current.draft)); return result },
        })
        const execute = createBrowserToolDispatcher({
            board, assertActive,
            ask: text => requestBoardAnswer(text, signal, pending => {
                if (agentRef.current === controller) setQuestion(pending)
            }, reason => controller.abort(reason)),
            onReadRetry: (callId, attempt) => { void reportAgentOperation(traceId, 'tool_retry', 'error', new Error(`调用 ${callId} 第${attempt}次读取失败，正在重试`)) },
        })
        try {
            const result = await streamBoardRun({ ...input, roomId }, signal, async call => {
                if (call.function.name !== 'ask_user') await ensureEditor()
                assertActive()
                return execute(call)
            }, step => { assertActive(); if (step.runId) traceId = step.runId; onStep(step) })
            assertActive()
            return { ...result, ...(draft ? { draftId: draft.runId } : {}) }
        } finally {
            if (agentRef.current === controller) {
                agentRef.current = null; setRunning(false); setQuestion(null)
                if (draft && activeRef.current === draft && !hasChanges(getDraftChanges(draft))) {
                    try {
                        discardBoardDraft(draft)
                        for (const id of draftTraceIds.current.get(draft.runId) ?? []) void reportAgentOperation(id, 'draft_discard', 'success')
                    } catch (cause) {
                        for (const id of draftTraceIds.current.get(draft.runId) ?? []) void reportAgentOperation(id, 'draft_discard', 'error', cause)
                        throw cause
                    }
                    const id = draft.runId
                    setResolutions(previous => ({ ...previous, [id]: 'unchanged' }))
                    clearPreview()
                }
            }
        }
    }

    /** 用户确认后复核在线角色、页面和文档冲突；失败保留草稿供检查或放弃。 */
    const apply = async () => {
        const draft = activeRef.current
        if (!editor || editor.isDisposed || !draft || !ready || agentRef.current || applyRef.current) return
        const controller = new AbortController()
        applyRef.current = controller; setApplying(true); setError('')
        const ids = [...(draftTraceIds.current.get(draft.runId) ?? [])]
        const began = Date.now()
        let outcome: 'success' | 'error' | 'cancelled' = 'cancelled'
        let failure: unknown
        try {
            if (!canEditRef.current) throw new BoardProtocolError({ code: ERROR_CODES.ACCESS_DENIED, message: '当前没有白板编辑权限' })
            if (!local) {
                const response = await fetch('/api/entry-validations', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId }),
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
                })
                const role = getConfirmedRoomRole(response.status, await response.json())
                if (activeRef.current !== draft || controller.signal.aborted) return
                if (role !== undefined) useEditorStore.getState().setRole(role)
                if (role !== 'owner' && role !== 'collaborator') throw new BoardProtocolError({ code: ERROR_CODES.ACCESS_DENIED, message: '编辑权限已失效，无法应用草稿' })
            }
            if (activeRef.current !== draft || controller.signal.aborted) return
            if (!canEditRef.current || editor.getCurrentPageId() !== draft.pageId) throw new Error('当前页面或编辑权限已改变')
            editor.markHistoryStoppingPoint('apply-board-draft')
            const summary = applyBoardDraft(draft, editor.store)
            editor.setSelectedShapes(editor.getSelectedShapeIds().filter(id => !!editor.getShape(id)))
            setResolutions(previous => ({ ...previous, [draft.runId]: 'applied' }))
            clearPreview()
            toast.show(`已应用：新增 ${summary.added}，修改 ${summary.updated}，删除 ${summary.removed}`)
            outcome = 'success'
        } catch (cause) {
            failure = cause
            outcome = controller.signal.aborted ? 'cancelled' : 'error'
            if (activeRef.current === draft && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '应用失败，草稿已保留')
        } finally {
            for (const id of ids) void reportAgentOperation(id, 'draft_apply', outcome, failure, Date.now() - began)
            if (applyRef.current === controller) { applyRef.current = null; setApplying(false) }
        }
    }

    // 只接收当前草稿的挂载结果，防止已放弃或切换房间的旧 Editor 唤醒新任务。
    const onDraftMount = (mounted: Editor) => {
        if (!preview) return
        if (activeRef.current !== preview.draft) return
        mounted.user.updateUserPreferences({ locale: 'zh-cn', colorScheme: theme === 'dark' ? 'dark' : 'light' })
        mounted.registerExternalAssetHandler('url', null)
        mounted.setCurrentPage(preview.draft.pageId)
        mounted.setCamera(preview.camera)
        mounted.updateInstanceState({ isReadonly: true })
        draftEditorRef.current = mounted; setReady(true)
        if (mountWaitRef.current?.id === preview.draft.runId) mountWaitRef.current.resolve(mounted)
        return () => { if (draftEditorRef.current === mounted) draftEditorRef.current = null }
    }
    return {
        editor: question && preview ? draftEditorRef.current : editor,
        canRun, active: !!preview, draftId: preview?.draft.runId,
        changes, running, applying, question, resolutions, error, run,
        cancel: () => agentRef.current?.abort(), apply, discard,
        preview, ready, canApply: ready && !running && !applying && canEdit && hasChanges(changes),
        onDraftMount, panPreview: () => draftEditorRef.current?.setCurrentTool('hand').focus(),
    }
}

export type BoardDraftSession = ReturnType<typeof useBoardDraftSession>
