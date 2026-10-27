'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { createShapeId, Editor, Tldraw } from 'tldraw'
import useEditorStore from '@/app/store/useEditorStore'
import useStyleStore from '@/app/store/useStyleStore'
import { applyBoardDraft, createBoardDraft, discardBoardDraft, type BoardDraft } from '@/utils/boardDraft'
import { getConfirmedRoomRole } from '@/utils/roomAccess'
import { toast } from '@/components/Toast'
import Modal from '../Modal/Modal'
import styles from './BoardDraft.module.scss'

const BoardDraftContext = createContext({ active: false, canStart: false, startDraft: () => {} })
export const useBoardDraft = () => useContext(BoardDraftContext)

type Preview = {
    draft: BoardDraft
    camera: { x: number; y: number; z: number }
    center: { x: number; y: number }
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
    const activeRef = useRef<BoardDraft | null>(null)
    const requestRef = useRef<AbortController | null>(null)
    const triggerRef = useRef<HTMLElement | null>(null)
    const theme = useStyleStore(state => state.theme)
    const mode = useSearchParams().get('mode')

    useEffect(() => {
        if (!editor || editor.isDisposed) return
        editor.updateInstanceState({ isReadonly: !!preview || !canEdit })
    }, [editor, preview, canEdit])

    useLayoutEffect(() => () => {
        if (activeRef.current) discardBoardDraft(activeRef.current)
        activeRef.current = null
        requestRef.current?.abort()
        requestRef.current = null
        setPreview(null)
        setReady(false)
        setApplying(false)
        setError('')
    }, [roomId, mode])

    const closeDraft = () => {
        if (activeRef.current) discardBoardDraft(activeRef.current)
        activeRef.current = null
        requestRef.current?.abort()
        requestRef.current = null
        setPreview(null)
        setReady(false)
        setApplying(false)
        setError('')
        requestAnimationFrame(() => triggerRef.current?.isConnected && triggerRef.current.focus())
    }

    const startDraft = () => {
        if (!editor || editor.isDisposed || !canEdit || activeRef.current || mode !== 'edgeless') return
        try {
            editor.complete()
            const draft = createBoardDraft(editor.store, editor.getCurrentPageId())
            const { x, y, z } = editor.getCamera()
            const { x: centerX, y: centerY } = editor.getViewportPageBounds().center
            triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            activeRef.current = draft
            editor.updateInstanceState({ isReadonly: true })
            editor.blur()
            setError('')
            setReady(false)
            setPreview({ draft, camera: { x, y, z }, center: { x: centerX, y: centerY } })
        } catch (cause) {
            toast.show(cause instanceof Error ? cause.message : '无法创建草稿')
        }
    }

    const applyDraft = async () => {
        const draft = activeRef.current
        if (!editor || editor.isDisposed || !draft || !ready || requestRef.current) return
        const controller = new AbortController()
        requestRef.current = controller
        setApplying(true)
        setError('')
        try {
            if (!canEdit) throw new Error('当前没有白板编辑权限')
            if (!local) {
                const response = await fetch('/api/entry-validations', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roomId }),
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
                })
                const result = await response.json()
                if (activeRef.current !== draft || controller.signal.aborted) return
                const confirmedRole = getConfirmedRoomRole(response.status, result)
                if (confirmedRole !== undefined) useEditorStore.getState().setRole(confirmedRole)
                if (confirmedRole !== 'owner' && confirmedRole !== 'collaborator') {
                    throw new Error('编辑权限已失效，无法应用草稿')
                }
                const role = useEditorStore.getState().role
                if (role !== 'owner' && role !== 'collaborator') throw new Error('当前没有白板编辑权限')
            }
            if (activeRef.current !== draft || controller.signal.aborted) return
            if (editor.getCurrentPageId() !== draft.pageId) throw new Error('当前页面已切换，请放弃草稿后重试')
            editor.markHistoryStoppingPoint('apply-board-draft')
            editor.run(() => applyBoardDraft(draft, editor.store))
            closeDraft()
            toast.show('已应用：新增 1 个圆')
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

    return <BoardDraftContext.Provider value={{ active: !!preview, canStart: !!editor && canEdit && !preview && mode === 'edgeless', startDraft }}>
        <div className={styles.official} inert={!!preview}>{children}</div>
        <Modal isOpen={!!preview} closeFn={closeDraft} className={styles.overlay} containerClassName={styles.container}>
            {preview && <section
                className={styles.dialog} role="dialog" aria-modal="true" aria-label="白板草稿预览"
                onPaste={event => event.stopPropagation()}
                onKeyUp={event => event.stopPropagation()}
                onKeyDown={event => {
                    event.stopPropagation()
                    if (event.key === 'Escape') { event.preventDefault(); closeDraft() }
                    if (event.key !== 'Tab') return
                    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
                    const first = buttons[0], last = buttons[buttons.length - 1]
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
                    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
                }}
            >
                <header className={styles.header}>
                    <div><h2>白板草稿</h2><p>本地演示 · 新增 1 个圆，确认后应用到正式白板</p></div>
                    <button type="button" onClick={closeDraft} autoFocus>放弃草稿</button>
                </header>
                <div className={styles.canvas} inert>
                    <Tldraw key={preview.draft.runId} store={preview.draft.store} licenseKey={licenseKey} hideUi autoFocus={false}
                        onMount={draftEditor => {
                            if (activeRef.current !== preview.draft) return
                            draftEditor.user.updateUserPreferences({ locale: 'zh-cn', colorScheme: theme === 'dark' ? 'dark' : 'light' })
                            draftEditor.setCurrentPage(preview.draft.pageId)
                            draftEditor.setCamera(preview.camera)
                            const id = createShapeId(preview.draft.runId)
                            if (!draftEditor.getShape(id)) {
                                draftEditor.createShapes([{ id, type: 'geo', parentId: preview.draft.pageId, x: preview.center.x - 80, y: preview.center.y - 80,
                                    props: { geo: 'ellipse', w: 160, h: 160, color: 'blue' } }])
                            }
                            draftEditor.updateInstanceState({ isReadonly: true })
                            setReady(true)
                        }}
                    />
                </div>
                <footer className={styles.footer}>
                    <p role={error ? 'alert' : 'status'}>{error || (applying ? '正在检查权限并应用…' : '草稿尚未应用，可随时放弃。')}</p>
                    <button type="button" className={styles.apply} disabled={!ready || applying || !canEdit} onClick={() => void applyDraft()}>
                        {applying ? '正在应用…' : '应用到白板'}
                    </button>
                </footer>
            </section>}
        </Modal>
    </BoardDraftContext.Provider>
}
