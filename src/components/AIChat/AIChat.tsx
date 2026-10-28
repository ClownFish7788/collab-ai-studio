'use client'

import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Bot, ImagePlus, Send, Square, Trash2, X } from 'lucide-react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { useStore } from 'zustand'
import Modal from '../Modal/Modal'
import ImagePreviewModal from '../Modal/ImagePreviewModal/ImagePreviewModal'
import SelectBoardElementsButton from '../SelectBoardElementsButton/SelectBoardElementsButton'
import SelectedElementsAttachment from '../SelectBoardElementsButton/SelectedElementsAttachment'
import { BoardSelectionProvider, useBoardSelectionStore } from './BoardSelectionProvider'
import { streamChat } from '../../utils/streamChat'
import { validateChatSnapshot } from '../../utils/chatSnapshots'
import type { RegionSnapshot } from '../../utils/collectRegionSnapshot'
import { IMAGE_MIME_TYPES, MAX_IMAGES_PER_MESSAGE, readImage, toMessageContent, type ImageAttachment } from '../../utils/images'
import styles from './AIChat.module.scss'
import { useBoardDraft } from '../DrawEditor/BoardDraftProvider'

type ChatMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
    images?: ImageAttachment[]
    snapshot?: RegionSnapshot
}

const AIChatPanel = () => {
    const boardDraft = useBoardDraft()
    const selectionStore = useBoardSelectionStore()
    const hasSelection = useStore(selectionStore, state => !!state.snapshot?.shapes.length)
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState('')
    const messageListRef = useRef<HTMLDivElement>(null)
    const inputHintId = useId()
    const panelId = useId()
    const [isOpen, setIsOpen] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const [isSelecting, setIsSelecting] = useState(false)
    const launcherRef = useRef<HTMLButtonElement>(null)
    const requestRef = useRef<AbortController | null>(null)
    const [isStreaming, setIsStreaming] = useState(false)
    const [error, setError] = useState('')
    const [images, setImages] = useState<ImageAttachment[]>([])
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const [isReadingImages, setIsReadingImages] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const imageReadVersionRef = useRef(0)
    const [previewImage, setPreviewImage] = useState<ImageAttachment | null>(null)
    const previewTriggerRef = useRef<HTMLButtonElement | null>(null)

    useEffect(() => {
        if (!previewImage) previewTriggerRef.current?.focus()
    }, [previewImage])

    const openImagePreview = (image: ImageAttachment, trigger: HTMLButtonElement) => {
        previewTriggerRef.current = trigger
        setPreviewImage(image)
    }

    useEffect(() => () => {
        requestRef.current?.abort()
        requestRef.current = null
        imageReadVersionRef.current++
    }, [])

    useEffect(() => {
        const list = messageListRef.current
        if (list) list.scrollTop = list.scrollHeight
    }, [messages, isOpen])

    const handleClose = () => {
        requestRef.current?.abort()
        imageReadVersionRef.current++
        setIsReadingImages(false)
        setIsClosing(true)
    }

    const addImages = async (files: File[]) => {
        if (!files.length || requestRef.current || isReadingImages || isClosing) return
        const version = ++imageReadVersionRef.current
        setIsReadingImages(true)
        setError('')
        const accepted: ImageAttachment[] = [], errors: string[] = []
        for (const file of files) {
            if (images.length + accepted.length >= MAX_IMAGES_PER_MESSAGE) {
                errors.push('每条消息最多上传 3 张图片')
                break
            }
            try {
                accepted.push(await readImage(file))
            } catch (error) {
                errors.push(error instanceof Error ? error.message : '图片读取失败')
            }
            if (version !== imageReadVersionRef.current) return
        }
        setImages(previous => [...previous, ...accepted])
        setError(errors.join('；'))
        setIsReadingImages(false)
    }

    const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
        // 聊天中的粘贴不能触发 document 上的画板粘贴监听。
        event.stopPropagation()
        const files = Array.from(event.clipboardData.items)
            // kind 只有 file / string；图片属于 file，随后由 readImage 检查 MIME 和文件头。
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file): file is File => file !== null)
        if (files.length) {
            event.preventDefault()
            void addImages(files)
        }
    }

    const handleSend = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const content = input.trim()
        const selectedSnapshot = selectionStore.getState().snapshot
        const snapshot = selectedSnapshot?.shapes.length ? selectedSnapshot : undefined
        if ((!content && !images.length && !snapshot) || requestRef.current || isReadingImages || isClosing) return
        if (snapshot) {
            try {
                validateChatSnapshot(snapshot)
            } catch (error) {
                setError(error instanceof Error ? error.message : '白板快照不合法')
                return
            }
        }

        const history: ChatMessage[] = [
            ...messages.filter(message => message.content.trim() || message.images?.length || message.snapshot?.shapes.length),
            { id: crypto.randomUUID(), role: 'user', content, images, snapshot },
        ]
        const assistantId = crypto.randomUUID()
        const controller = new AbortController()
        requestRef.current = controller
        setMessages([...history, { id: assistantId, role: 'assistant', content: '' }])
        setInput('')
        setImages([])
        selectionStore.getState().clearSnapshot()
        setError('')
        setIsStreaming(true)
        try {
            await streamChat(history.map(({ role, content, images, snapshot }) => ({ role, content: toMessageContent(content, images), snapshot })), controller.signal, text => {
                setMessages(previous => previous.map(message => message.id === assistantId
                    ? { ...message, content: message.content + text } : message))
            })
        } catch (error) {
            if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '对话失败，请重试')
        } finally {
            if (requestRef.current === controller) {
                requestRef.current = null
                setIsStreaming(false)
                setMessages(previous => previous.filter(message => message.id !== assistantId || message.content))
            }
        }
    }

    // shortcut: 聊天仅保存在组件内存中，接入任务控制时按房间隔离并处理取消。
    return (
        <>
            <button
                ref={launcherRef}
                type="button"
                hidden={isSelecting}
                className={styles.launcher}
                aria-label="打开 AI 助手"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setIsOpen(true)}
            >
                <Bot size={18} aria-hidden="true" />
                AI 助手
            </button>
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
                    role="dialog"
                    aria-modal="true"
                    aria-label="白板 AI 助手"
                    inert={previewImage !== null || isSelecting || boardDraft.active}
                    aria-hidden={previewImage || isSelecting || boardDraft.active ? true : undefined}
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
                        if (event.key !== 'Tab') return
                        const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea')
                        const first = controls[0]
                        const last = controls[controls.length - 1]
                        if (event.shiftKey && document.activeElement === first) {
                            event.preventDefault()
                            last?.focus()
                        } else if (!event.shiftKey && document.activeElement === last) {
                            event.preventDefault()
                            first?.focus()
                        }
                    }}
                >
                    <header className={styles.header}>
                        <div className={styles.title}>
                            <Bot size={20} aria-hidden="true" />
                            <h2>白板 AI 助手</h2>
                        </div>
                        <div className={styles.headerActions}>
                            <button
                                type="button"
                                className={styles.clearButton}
                                aria-label="清空聊天记录"
                                title="清空聊天记录"
                                disabled={messages.length === 0 || isStreaming || isReadingImages}
                                onClick={() => { setMessages([]); setError('') }}
                            >
                                <Trash2 size={16} aria-hidden="true" />
                            </button>
                            <button type="button" className={styles.clearButton} aria-label="关闭 AI 助手" onClick={handleClose}>
                                <X size={18} aria-hidden="true" />
                            </button>
                        </div>
                    </header>

                    <p className={styles.notice}>普通对话用于分析；需要 AI 新增图形时，请进入下方草稿演示。</p>

                    <div ref={messageListRef} className={styles.messages} role="log" aria-label="聊天记录" aria-live="polite">
                        {messages.length === 0 ? (
                            <div className={styles.empty}>
                                <Bot size={32} aria-hidden="true" />
                                <h3>从一个问题开始</h3>
                                <p>例如：用一个例子解释 JavaScript 闭包。</p>
                                <p>也可以上传或粘贴图片，每次最多 3 张，单张小于 5MB。</p>
                            </div>
                        ) : messages.map(message => (
                            <article key={message.id} className={styles.message} data-role={message.role}>
                                <span className={styles.messageRole}>{message.role === 'user' ? '你' : 'AI 助手'}</span>
                                {!!message.snapshot?.shapes.length && <span className={styles.messageRole}>已附加 {message.snapshot.shapes.length} 个白板元素</span>}
                                {!!message.images?.length && <div className={styles.attachments}>
                                    {message.images.map(image => <figure key={image.id} className={styles.attachment}>
                                        <button type="button" className={styles.thumbnail} aria-label={`放大预览 ${image.name}`} onClick={event => openImagePreview(image, event.currentTarget)}>
                                            <Image src={image.dataUrl} alt={image.name} width={128} height={96} unoptimized />
                                        </button>
                                        <figcaption title={image.name}>{image.name}</figcaption>
                                    </figure>)}
                                </div>}
                                {(message.content || message.role === 'assistant') && <p className={styles.bubble}>{message.content || '正在回复…'}</p>}
                            </article>
                        ))}
                    </div>

                    <div className={styles.draftDemo}>
                        <button type="button" disabled={!boardDraft.canStart || isStreaming || isReadingImages || isSelecting} onClick={boardDraft.startDraft}>
                            AI 新增 / 草稿测试
                        </button>
                        <span>在独立草稿里体验 AI 新增，确认后应用</span>
                    </div>
                    <form className={styles.composer} onSubmit={handleSend}>
                        {error && <p className={styles.error} role="alert">{error}</p>}
                        <SelectedElementsAttachment onRemove={() => inputRef.current?.focus()} />
                        {!!images.length && <div className={styles.attachments} aria-label="待发送图片">
                            {images.map(image => <figure key={image.id} className={styles.attachment}>
                                <button type="button" className={styles.thumbnail} aria-label={`放大预览 ${image.name}`} onClick={event => openImagePreview(image, event.currentTarget)}>
                                    <Image src={image.dataUrl} alt={image.name} width={72} height={72} unoptimized />
                                </button>
                                <figcaption title={image.name}>{image.name}</figcaption>
                                <button
                                    type="button"
                                    className={styles.removeImage}
                                    aria-label={`移除图片 ${image.name}`}
                                    disabled={isReadingImages}
                                    onClick={() => setImages(previous => previous.filter(item => item.id !== image.id))}
                                ><X size={12} aria-hidden="true" /></button>
                            </figure>)}
                        </div>}
                        {isReadingImages && <p className={styles.footnote} role="status">正在读取图片…</p>}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={IMAGE_MIME_TYPES.join(',')}
                            multiple
                            hidden
                            onChange={event => {
                                const files = Array.from(event.target.files || [])
                                event.target.value = ''
                                void addImages(files)
                            }}
                        />
                        <textarea
                            ref={inputRef}
                            autoFocus
                            aria-label="聊天消息"
                            aria-describedby={inputHintId}
                            placeholder="输入你的问题…"
                            maxLength={4000}
                            rows={3}
                            value={input}
                            onChange={event => setInput(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                                    event.preventDefault()
                                    event.currentTarget.form?.requestSubmit()
                                }
                            }}
                        />
                        <div className={styles.composerFooter}>
                            <SelectBoardElementsButton
                                isSelecting={isSelecting}
                                onSelectingChange={setIsSelecting}
                                disabled={isClosing}
                            />
                            <button
                                type="button"
                                className={styles.uploadButton}
                                aria-label="上传图片"
                                title={`上传图片（${images.length}/${MAX_IMAGES_PER_MESSAGE}），单张小于 5MB`}
                                disabled={isStreaming || isReadingImages}
                                onClick={() => fileInputRef.current?.click()}
                            ><ImagePlus size={18} aria-hidden="true" /></button>
                            <span id={inputHintId}>Enter 发送 · Shift + Enter 换行</span>
                            {isStreaming ? <button type="button" className={styles.sendButton} onClick={() => requestRef.current?.abort()}>
                                <Square size={14} aria-hidden="true" />
                                停止生成
                            </button> : <button type="submit" className={styles.sendButton} disabled={(!input.trim() && !images.length && !hasSelection) || isReadingImages}>
                                <Send size={16} aria-hidden="true" />
                                发送
                            </button>}
                        </div>
                        <p className={styles.footnote}>聊天记录刷新后清空。</p>
                    </form>
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
