'use client'

import { useEffect, useRef } from 'react'
import { ArrowUpRight, LayoutGrid, Sparkles } from 'lucide-react'
import type { ImageAttachment } from '../../../utils/chat/images'
import type { useBoardDraft } from '../../DrawEditor/BoardDraftProvider'
import type { ChatMessage } from '../types'
import styles from './ChatMessageList.module.scss'
import ChatAttachments from '../ChatAttachments/ChatAttachments'
import SelectedElementsAttachment from '../../SelectBoardElementsButton/SelectedElementsAttachment'

export default function ChatMessageList({ messages, isOpen, isStreaming, isWaitingForAnswer, resolutions, onPreview, onSuggest }: {
    messages: ChatMessage[]
    isOpen: boolean
    isStreaming: boolean
    isWaitingForAnswer: boolean
    resolutions: ReturnType<typeof useBoardDraft>['resolutions']
    onPreview: (image: ImageAttachment, trigger: HTMLButtonElement) => void
    onSuggest?: (text: string) => void
}) {
    const messageListRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const list = messageListRef.current
        if (list) list.scrollTop = list.scrollHeight
    }, [messages, isOpen])

    return (
        <div ref={messageListRef} className={styles.messages} role="log" aria-label="聊天记录" aria-live="polite">
            {messages.length === 0 ? (
                <div className={styles.empty}>
                    <span className={styles.emptyMark}><LayoutGrid size={25} strokeWidth={1.4} aria-hidden="true" /></span>
                    <h3>想在白板上做些什么？</h3>
                    <p>从一个想法开始，一起把它画清楚。</p>
                    {onSuggest && <div className={styles.suggestions}>
                        {['画一个登录流程', '整理选中的内容', '解释这张图片'].map(text => <button key={text} type="button" onClick={() => onSuggest(text)}>
                            {text}<ArrowUpRight size={14} aria-hidden="true" />
                        </button>)}
                    </div>}
                    <p className={styles.emptyHint}>可以选择白板元素，或上传、粘贴图片。</p>
                </div>
            ) : messages.map((message, index) => {
                const isCurrentReply = isStreaming && index === messages.length - 1 && message.role === 'assistant' && !message.failed && !message.execution
                const isGenerating = isCurrentReply && !isWaitingForAnswer
                const status = isCurrentReply && isWaitingForAnswer ? '等待你的回答'
                    : message.status || (isGenerating && !message.content ? '正在思考…' : undefined)
                const isTextStreaming = isGenerating && !!message.content && !status
                return <article key={message.id} className={styles.message} data-role={message.role} aria-busy={isGenerating || undefined}>
                    {message.role !== 'user' && <span className={styles.messageRole}><Sparkles size={13} aria-hidden="true" />白板助手</span>}
                    {!!message.snapshot?.shapes.length && <span className={styles.contextLabel}>已附加 {message.snapshot.shapes.length} 个白板元素</span>}
                    <ChatAttachments images={message.images} onPreview={onPreview} />
                    {message.clarifications?.filter(batch => batch.questions.some(question => question.answer)).map(batch => <details key={batch.callId} className={styles.details}>
                        <summary>补充信息 · {batch.questions.length} 个问题</summary>
                        {batch.questions.map(question => <div key={question.id} className={styles.questionAnswer}>
                            <p>{question.question}</p>
                            <p className={styles.answer}>{question.answer}</p>
                            <SelectedElementsAttachment count={question.snapshot?.shapes.length ?? 0} />
                            <ChatAttachments images={question.images} onPreview={onPreview} />
                        </div>)}
                    </details>)}
                    {message.plan && <details className={styles.details}>
                        <summary>需求拆分</summary>
                        <div>{message.plan}</div>
                    </details>}
                    {message.preview && <details className={styles.details}>
                        <summary>{message.failed ? '未完成的生成预览（未校验）' : '生成预览（未校验，不代表执行结果）'}</summary>
                        <div>{message.preview}</div>
                    </details>}
                    {message.content && <p className={styles.bubble} data-streaming={isTextStreaming || undefined}>{message.content}</p>}
                    {status && <p className={styles.status} role="status" data-loading={isGenerating || undefined}>
                        {isGenerating && <Sparkles className={styles.loadingMark} size={16} strokeWidth={1.5} aria-hidden="true" />}
                        {status}
                    </p>}
                    {message.execution && <p className={styles.execution} role="status">
                        {message.execution.description}
                        {message.execution.draftId && ` · ${resolutions[message.execution.draftId] === 'applied' ? '已应用'
                            : resolutions[message.execution.draftId] === 'discarded' ? '已放弃'
                                : resolutions[message.execution.draftId] === 'unchanged' ? '变更已抵消，无需应用' : '尚未应用'}`}
                    </p>}
                </article>
            })}
        </div>
        
    )
}
