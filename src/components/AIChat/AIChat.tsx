'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Sparkles, Trash2, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { createPortal } from 'react-dom'
import Modal from '../Modal/Modal'
import ImagePreviewModal from '../Modal/ImagePreviewModal/ImagePreviewModal'
import { BoardSelectionProvider } from './BoardSelectionProvider'
import type { ImageAttachment } from '../../utils/chat/images'
import { useBoardDraft } from '../DrawEditor/BoardDraftProvider'
import { useChatSession } from '../../hooks/useChatSession'
import ChatMessageList from './ChatMessageList/ChatMessageList'
import ChatDraftCard from './ChatDraftCard/ChatDraftCard'
import ChatComposer from './ChatComposer/ChatComposer'
import styles from './AIChat.module.scss'

const AIChatPanel = () => {
    const boardDraft = useBoardDraft()
    const inputHintId = useId()
    const panelId = useId()
    const [isOpen, setIsOpen] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const [isSelecting, setIsSelecting] = useState(false)
    const launcherRef = useRef<HTMLButtonElement>(null)
    // Modal 关闭会卸载表单，会话和输入状态须保留在面板中。
    const session = useChatSession({ boardDraft, isClosing })
    const { messages, isStreaming, attachments: { isReadingImages, handlePaste } } = session
    const [previewImage, setPreviewImage] = useState<ImageAttachment | null>(null)
    const previewTriggerRef = useRef<HTMLButtonElement | null>(null)

    useEffect(() => {
        if (!previewImage) previewTriggerRef.current?.focus()
    }, [previewImage])

    const openImagePreview = (image: ImageAttachment, trigger: HTMLButtonElement) => {
        previewTriggerRef.current = trigger
        setPreviewImage(image)
    }

    const handleClose = () => {
        session.close()
        setIsClosing(true)
    }

    // shortcut: 聊天仅保存在按房间挂载的组件内存中，刷新后清空。
    return (
        <>
            {boardDraft.launcherHost && createPortal(<button
                ref={launcherRef}
                type="button"
                hidden={isSelecting}
                className={styles.launcher}
                aria-label="打开 AI 助手"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setIsOpen(true)}
            >
                <Sparkles size={16} aria-hidden="true" />
                AI 助手
            </button>, boardDraft.launcherHost)}
            <Modal
                isOpen={isOpen}
                closeFn={handleClose}
                // 选择时只视觉隐藏遮罩与面板，保留 DOM、输入、附件和流式请求。
                className={isSelecting ? `${styles.drawer} ${styles.selecting}` : styles.drawer}
                containerClassName={styles.drawerContainer}
            >
                <section
                    id={panelId}
                    className={styles.chat}
                    role="complementary"
                    aria-label="白板 AI 助手"
                    inert={previewImage !== null || isSelecting}
                    aria-hidden={previewImage || isSelecting ? true : undefined}
                    data-closing={isClosing}
                    onPaste={handlePaste}
                    onAnimationEnd={event => {
                        if (event.target !== event.currentTarget || !isClosing) return
                        setIsOpen(false)
                        setIsClosing(false)
                        launcherRef.current?.focus()
                    }}
                    onKeyDown={event => {
                        event.stopPropagation()
                        if (event.key === 'Escape') handleClose()
                    }}
                >
                    <header className={styles.header}>
                        <div className={styles.title}>
                            <Sparkles size={18} aria-hidden="true" />
                            <h2>白板 AI 助手</h2>
                        </div>
                        <div className={styles.headerActions}>
                            <button
                                type="button"
                                className={styles.clearButton}
                                aria-label="清空聊天记录"
                                title="清空聊天记录"
                                disabled={messages.length === 0 || isStreaming || isReadingImages || boardDraft.active}
                                onClick={session.clear}
                            >
                                <Trash2 size={16} aria-hidden="true" />
                            </button>
                            <button type="button" className={styles.clearButton} aria-label="关闭 AI 助手" title="关闭 AI 助手" onClick={handleClose}>
                                <X size={18} aria-hidden="true" />
                            </button>
                        </div>
                    </header>

                    <p className={styles.notice}>{boardDraft.canRun ? '修改先生成草稿，由你确认后应用到白板。' : '当前可进行图文对话；白板操作需要在线编辑权限。'}</p>

                    <ChatMessageList messages={messages} isOpen={isOpen} isStreaming={isStreaming} isWaitingForAnswer={!!boardDraft.question}
                        resolutions={boardDraft.resolutions} onPreview={openImagePreview}
                        onSuggest={text => { session.setInput(text); session.inputRef.current?.focus() }} />
                    <ChatDraftCard isStreaming={isStreaming} onAbortRequest={session.abortRequest} />
                    <ChatComposer session={session} inputHintId={inputHintId} isSelecting={isSelecting}
                        onSelectingChange={setIsSelecting} isClosing={isClosing} onPreview={openImagePreview} />
                </section>
            </Modal>
            <ImagePreviewModal image={previewImage} closeFn={() => setPreviewImage(null)} />
        </>
    )
}

const AIChat = () => {
    const { workId } = useParams<{ workId: string }>()
    return <BoardSelectionProvider scopeId={workId}>
        <AIChatPanel />
    </BoardSelectionProvider>
}

export default AIChat
