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
    const { input, setInput, inputRef, isStreaming, error, send, stop,
        questionFields, activeQuestionId, selectQuestion, setQuestionText, canSubmitAnswers } = session
    const { images, setImages, isReadingImages, addImages } = session.attachments

    return (
        <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send() }}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {boardDraft.question && <>
                <p className={styles.notice} role="status">共 {questionFields.length} 个问题，请逐项回答后统一提交，合计最多上传 3 张图片，最多等待 {BOARD_ANSWER_TIMEOUT_MS / 1000} 秒。</p>
                {questionFields.map((field, index) => <div key={field.id} className={styles.questionField} data-active={field.id === activeQuestionId}>
                    <label htmlFor={`${inputHintId}-${field.id}`}>{index + 1}. {field.question}</label>
                    <textarea
                        id={`${inputHintId}-${field.id}`}
                        ref={field.id === activeQuestionId ? inputRef : undefined}
                        autoFocus={index === 0}
                        maxLength={1000}
                        rows={2}
                        value={field.text}
                        placeholder="填写回答，也可为此题上传图片或选择元素…"
                        disabled={isClosing || isReadingImages && field.id !== activeQuestionId}
                        onFocus={() => selectQuestion(field.id)}
                        onChange={event => setQuestionText(field.id, event.target.value)}
                    />
                    {field.id !== activeQuestionId && <>
                        <SelectedElementsAttachment count={field.snapshot?.shapes.length ?? 0} />
                        <ChatAttachments images={field.images} onPreview={onPreview} />
                    </>}
                </div>)}
                <p className={styles.footnote} role="status">附件用于第 {questionFields.findIndex(field => field.id === activeQuestionId) + 1} 题；点击其他问题的输入框可切换。</p>
            </>}
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
            {!boardDraft.question && <textarea
                ref={inputRef}
                autoFocus
                aria-label="聊天消息"
                aria-describedby={inputHintId}
                placeholder="输入问题或白板需求…"
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
            />}
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
                <span id={inputHintId}>{boardDraft.question ? '全部回答后提交' : 'Enter 发送 · Shift + Enter 换行'}</span>
                {boardDraft.question && <button type="submit" className={styles.sendButton} disabled={!canSubmitAnswers || isReadingImages || isSelecting || isClosing}>提交全部回答并继续</button>}
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
