'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import { useBoardDraftSession, type BoardDraftSession } from '@/hooks/useBoardDraftSession'
import styles from './BoardDraft.module.scss'

type BoardDraftContextValue = Omit<BoardDraftSession, 'preview' | 'ready' | 'canApply' | 'onDraftMount' | 'panPreview' | 'draftId'> & {
    draftId?: string
    launcherHost: HTMLDivElement | null
    registerLauncher: (kind: 'official' | 'draft', host: HTMLDivElement | null) => void
}

const BoardDraftContext = createContext<BoardDraftContextValue>({ editor: null, launcherHost: null, registerLauncher: () => {}, canRun: false, active: false, changes: { added: [], updated: [], removed: [] }, running: false, applying: false,
    question: null, resolutions: {}, error: '', run: async () => { throw new Error('白板尚未就绪') },
    cancel: () => {}, apply: async () => {}, discard: () => {} })

export const useBoardDraft = () => useContext(BoardDraftContext)

/** 沿用 tldraw SharePanel 的布局位置；Portal 只迁移入口，聊天组件始终挂载在 Provider 内。 */
export function BoardChatSlot({ draft = false }: { draft?: boolean }) {
    const { registerLauncher } = useBoardDraft()
    const register = useCallback((host: HTMLDivElement | null) => registerLauncher(draft ? 'draft' : 'official', host), [registerLauncher, draft])
    return <div ref={register} />
}
function DraftChatSlot() { return <BoardChatSlot draft /> }

/** 提供会话上下文与草稿预览；Editor 和请求的生命周期统一交给会话 Hook。 */
export default function BoardDraftProvider({ editor, licenseKey, roomId, canEdit, local = false, children, chat }: {
    editor: Editor | null; licenseKey: string; roomId: string; canEdit: boolean; local?: boolean; children: ReactNode; chat: ReactNode
}) {
    const { preview, ready, canApply, onDraftMount, panPreview, ...session } = useBoardDraftSession({ editor, roomId, canEdit, local })
    const { changes, running, applying, error, apply, discard } = session
    const [launcherHosts, setLauncherHosts] = useState<{ official: HTMLDivElement | null; draft: HTMLDivElement | null }>({ official: null, draft: null })
    const registerLauncher = useCallback((kind: 'official' | 'draft', host: HTMLDivElement | null) => {
        setLauncherHosts(previous => previous[kind] === host ? previous : { ...previous, [kind]: host })
    }, [])

    return <BoardDraftContext.Provider value={{ ...session, launcherHost: preview ? launcherHosts.draft : launcherHosts.official, registerLauncher }}>
        <div className={styles.root}>
            <div className={styles.official} data-preview={!!preview} inert={!!preview}>{children}</div>
            {preview && <div className={styles.preview} aria-label="白板草稿预览" onPaste={event => event.stopPropagation()}>
                <Tldraw key={preview.draft.runId} store={preview.draft.store} licenseKey={licenseKey} autoFocus={false} initialState="hand"
                    components={{ SharePanel: DraftChatSlot, Toolbar: null, StylePanel: null, MainMenu: null, PageMenu: null }}
                    onMount={onDraftMount} />
                <div className={styles.toolbar} role="region" aria-label="草稿操作">
                    <span role="status">{running ? 'AI 正在处理白板…' : '草稿待确认'} · 新增 {changes.added.length}，修改 {changes.updated.length}，删除 {changes.removed.length}</span>
                    <button type="button" disabled={!ready} onClick={panPreview}>拖动画布</button>
                    <button type="button" disabled={!canApply} onClick={() => void apply()}>{applying ? '正在应用…' : '应用到白板'}</button>
                    <button type="button" onClick={discard}>{running ? '停止并放弃' : '放弃草稿'}</button>
                    {error && <p role="alert">{error}</p>}
                </div>
            </div>}
            {chat}
        </div>
    </BoardDraftContext.Provider>
}
