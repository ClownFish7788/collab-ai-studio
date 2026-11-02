'use client'

import { useRef } from 'react'
import { ImagePlus, Send, Square } from 'lucide-react'
import { useStore } from 'zustand'
import { useBoardDraft } from '../../DrawEditor/BoardDraftProvider'
import { useBoardSelectionStore } from '../BoardSelectionProvider'
import SelectBoardElementsButton from '../../SelectBoardElementsButton/SelectBoardElementsButton'
import SelectedElementsAttachment from '../../SelectBoardElementsButton/SelectedElementsAttachment'
import { IMAGE_MIME_TYPES, MAX_IMAGES_PER_MESSAGE, type ImageAttachment } from '../../../utils/chat/images'
import type { useChatSession } from '../../../hooks/useChatSession'
import styles from './ChatComposer.module.scss'
import ChatAttachments from '../ChatAttachments/ChatAttachments'
import { BOARD_ANSWER_TIMEOUT_MS } from '../../../utils/board/boardCapabilities'

export default function ChatComposer({ session, inputHintId, isSelecting, onSelectingChange, isClosing, onPreview }: {
    session: ReturnType<typeof useChatSession>
    inputHintId: string
    isSelecting: boolean
    onSelectingChange: (selecting: boolean) => void
    isClosing: boolean
    onPreview: (image: ImageAttachment, trigger: HTMLButtonElement) => void
}) {
    const boardDraft = useBoardDraft()
    const selectionStore = useBoardSelectionStore()
    const hasSelection = useStore(selectionStore, state => !!state.snapshot?.shapes.length)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const { input, setInput, inputRef, isStreaming, error, send, stop } = session
    const { images, setImages, isReadingImages, addImages } = session.attachments

    return (
        <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send() }}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {boardDraft.question && <p className={styles.notice} role="status">{boardDraft.question.text}（可上传图片或选择元素，最多等待 {BOARD_ANSWER_TIMEOUT_MS / 1000} 秒）</p>}
            <SelectedElementsAttachment onRemove={() => inputRef.current?.focus()} />
            <ChatAttachments images={images} onPreview={onPreview} removingDisabled={isReadingImages}
                onRemove={id => setImages(previous => previous.filter(image => image.id !== id))} />
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
                placeholder={boardDraft.question ? '回答当前问题，继续本次任务…' : '输入问题或白板需求…'}
                maxLength={boardDraft.question ? 1000 : 4000}
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
                {boardDraft.editor && <SelectBoardElementsButton
                    editor={boardDraft.editor}
                    isSelecting={isSelecting}
                    onSelectingChange={onSelectingChange}
                    disabled={isClosing || !boardDraft.question && (isStreaming || boardDraft.active)}
                />}
                <button
                    type="button"
                    className={styles.uploadButton}
                    aria-label="上传图片"
                    title={`上传图片（${images.length}/${MAX_IMAGES_PER_MESSAGE}），单张小于 5MB`}
                    disabled={isClosing || isStreaming && !boardDraft.question || isReadingImages}
                    onClick={() => fileInputRef.current?.click()}
                ><ImagePlus size={18} aria-hidden="true" /></button>
                <span id={inputHintId}>Enter 发送 · Shift + Enter 换行</span>
                {boardDraft.question && <button type="submit" className={styles.sendButton} disabled={(!input.trim() && !images.length && !hasSelection) || isReadingImages || isSelecting}>回答并继续</button>}
                {isStreaming ? <button type="button" className={styles.sendButton} onClick={stop}>
                    <Square size={14} aria-hidden="true" />
                    停止生成
                </button> : <button type="submit" className={styles.sendButton} disabled={(!input.trim() && !images.length && !hasSelection) || isReadingImages}>
                    <Send size={16} aria-hidden="true" />
                    发送
                </button>}
            </div>
            <p className={styles.footnote}>聊天记录刷新后清空。</p>
        </form>
    )
}
