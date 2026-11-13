'use client'

import { useRef, type MouseEvent } from 'react'
import { ArrowUp, ChevronLeft, ChevronRight, ImagePlus, MessageCircleQuestion, Square, X } from 'lucide-react'
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
    const isAsking = !!boardDraft.question
    const questionIndex = Math.max(0, questionFields.findIndex(field => field.id === activeQuestionId))
    const question = questionFields[questionIndex]
    const isLastQuestion = questionIndex === questionFields.length - 1
    const isBusy = isClosing || isReadingImages || isSelecting
    const unansweredQuestions = questionFields.flatMap((field, index) =>
        !field.text.trim() && !field.images.length && !field.snapshot?.shapes.length ? [index] : [])
    const navigateQuestion = (event: MouseEvent<HTMLButtonElement>, id: string) => {
        // 翻页可能把当前 DOM 按钮变成 submit，必须取消这次点击的原生提交行为。
        event.preventDefault()
        selectQuestion(id)
    }

    return (
        <form className={styles.composer} onSubmit={event => {
            event.preventDefault()
            if (isBusy) return
            if (isAsking ? !isLastQuestion || !canSubmitAnswers : isStreaming || boardDraft.active) return
            void send()
        }}>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.inputCard} data-asking={isAsking}>
                {isAsking && question && <>
                    <div className={styles.questionHeader}>
                        <span><MessageCircleQuestion size={15} aria-hidden="true" />需要你补充</span>
                        <span className={styles.progress} role="status" aria-label={`第 ${questionIndex + 1} 题，共 ${questionFields.length} 题`}>{`${questionIndex + 1}/${questionFields.length}`}</span>
                        <button type="button" className={styles.iconButton} aria-label="取消本次任务" title="取消本次任务" onClick={stop} disabled={isClosing}>
                            <X size={15} aria-hidden="true" />
                        </button>
                    </div>
                    <div className={styles.questionField} key={question.id}>
                        <label htmlFor={`${inputHintId}-${question.id}`}>{question.question}</label>
                        <textarea
                            id={`${inputHintId}-${question.id}`}
                            ref={inputRef}
                            autoFocus
                            aria-describedby={inputHintId}
                            maxLength={1000}
                            rows={2}
                            value={question.text}
                            placeholder="填写回答，也可以添加图片或白板元素…"
                            disabled={isClosing}
                            onFocus={() => selectQuestion(question.id)}
                            onChange={event => setQuestionText(question.id, event.target.value)}
                        />
                    </div>
                </>}
                {!isAsking && <textarea
                    ref={inputRef}
                    autoFocus
                    aria-label="聊天消息"
                    aria-describedby={inputHintId}
                    placeholder="描述你的想法，或选中白板内容来提问…"
                    maxLength={4000}
                    rows={3}
                    value={input}
                    disabled={isClosing}
                    onChange={event => setInput(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                            event.preventDefault()
                            event.currentTarget.form?.requestSubmit()
                        }
                    }}
                />}
                <div className={styles.context}>
                    <SelectedElementsAttachment onRemove={() => inputRef.current?.focus()} />
                    <ChatAttachments images={images} onPreview={onPreview} removingDisabled={isReadingImages}
                        onRemove={id => setImages(previous => previous.filter(image => image.id !== id))} />
                    {isReadingImages && <p className={styles.footnote} role="status">正在读取图片…</p>}
                </div>
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
                <div className={styles.composerFooter}>
                    <div className={styles.tools}>
                        {boardDraft.editor && <SelectBoardElementsButton
                            editor={boardDraft.editor}
                            isSelecting={isSelecting}
                            onSelectingChange={onSelectingChange}
                            disabled={isBusy || !isAsking && (isStreaming || boardDraft.active)}
                        />}
                        <button
                            type="button"
                            className={styles.iconButton}
                            aria-label="上传图片"
                            title={`上传图片（${images.length}/${MAX_IMAGES_PER_MESSAGE}），单张小于 5MB`}
                            disabled={isBusy || isStreaming && !isAsking}
                            onClick={() => fileInputRef.current?.click()}
                        ><ImagePlus size={18} aria-hidden="true" /></button>
                    </div>
                    {!isAsking && (isStreaming ? <button type="button" className={styles.sendButton} onClick={stop} aria-label="停止生成" title="停止生成" disabled={isClosing}>
                        <Square size={15} fill="currentColor" aria-hidden="true" />
                    </button> : <button type="submit" className={styles.sendButton} aria-label="发送消息" title="发送消息" disabled={(!input.trim() && !images.length && !hasSelection) || isBusy || boardDraft.active}>
                        <ArrowUp size={19} aria-hidden="true" />
                    </button>)}
                </div>
                {isAsking && isLastQuestion && unansweredQuestions.length > 0 && <div className={styles.answerNotice} role="status">
                    <p>{`第 ${unansweredQuestions.map(index => index + 1).join('、')} 题尚未回答，请补充后提交。`}</p>
                    <button type="button" disabled={isBusy} onClick={event => navigateQuestion(event, questionFields[unansweredQuestions[0]].id)}>
                        {`补答第 ${unansweredQuestions[0] + 1} 题`}<ChevronRight size={14} aria-hidden="true" />
                    </button>
                </div>}
                {isAsking && <div className={styles.questionNavigation}>
                    <button type="button" className={styles.previousButton} disabled={questionIndex === 0 || isBusy} onClick={event => navigateQuestion(event, questionFields[questionIndex - 1].id)}>
                        <ChevronLeft size={15} aria-hidden="true" />上一题
                    </button>
                    {isLastQuestion ? <button type="submit" className={styles.nextButton} disabled={!canSubmitAnswers || isBusy}>提交回答并继续<ArrowUp size={15} aria-hidden="true" /></button>
                        : <button type="button" className={styles.nextButton} disabled={!question || isBusy} onClick={event => navigateQuestion(event, questionFields[questionIndex + 1].id)}>下一题<ChevronRight size={15} aria-hidden="true" /></button>}
                </div>}
            </div>
            <p id={inputHintId} className={styles.footnote}>{isAsking
                ? `附件仅用于当前题 · 全部回答合计最多 3 张图片 · 请在 ${BOARD_ANSWER_TIMEOUT_MS / 1000} 秒内完成`
                : 'Enter 发送 · Shift + Enter 换行 · 刷新后清空记录'}</p>
        </form>
    )
}
