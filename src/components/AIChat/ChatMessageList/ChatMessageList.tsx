'use client'

import { useEffect, useRef } from 'react'
import { Bot } from 'lucide-react'
import Image from 'next/image'
import type { ImageAttachment } from '../../../utils/chat/images'
import type { useBoardDraft } from '../../DrawEditor/BoardDraftProvider'
import type { ChatMessage } from '../types'
import styles from './ChatMessageList.module.scss'
import attachmentStyles from '../ChatAttachments/ChatAttachments.module.scss'

export default function ChatMessageList({ messages, isOpen, resolutions, onPreview }: {
    messages: ChatMessage[]
    isOpen: boolean
    resolutions: ReturnType<typeof useBoardDraft>['resolutions']
    onPreview: (image: ImageAttachment, trigger: HTMLButtonElement) => void
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
                    <Bot size={32} aria-hidden="true" />
                    <h3>从一个问题开始</h3>
                    <p>例如：用一个例子解释 JavaScript 闭包。</p>
                    <p>也可以上传或粘贴图片，每次最多 3 张，单张小于 5MB。</p>
                </div>
            ) : messages.map(message => (
                <article key={message.id} className={styles.message} data-role={message.role}>
                    <span className={styles.messageRole}>{message.role === 'user' ? '你' : 'AI 助手'}</span>
                    {!!message.snapshot?.shapes.length && <span className={styles.messageRole}>已附加 {message.snapshot.shapes.length} 个白板元素</span>}
                    {!!message.images?.length && <div className={attachmentStyles.attachments}>
                        {message.images.map(image => <figure key={image.id} className={attachmentStyles.attachment}>
                            <button type="button" className={attachmentStyles.thumbnail} aria-label={`放大预览 ${image.name}`} onClick={event => onPreview(image, event.currentTarget)}>
                                <Image src={image.dataUrl} alt={image.name} width={128} height={96} unoptimized />
                            </button>
                            <figcaption title={image.name}>{image.name}</figcaption>
                        </figure>)}
                    </div>}
                    {message.clarification && <div className={styles.bubble}>
                        <p>{message.clarification.question}</p>
                        {message.clarification.answer && <p>你的回答：{message.clarification.answer}</p>}
                    </div>}
                    {message.content && <p className={styles.bubble}>{message.content}</p>}
                    {message.status && <p role="status">{message.status}</p>}
                    {message.execution && <p className={styles.execution} role="status">
                        {message.execution.description}
                        {message.execution.draftId && ` · ${resolutions[message.execution.draftId] === 'applied' ? '已应用'
                            : resolutions[message.execution.draftId] === 'discarded' ? '已放弃'
                                : resolutions[message.execution.draftId] === 'unchanged' ? '变更已抵消，无需应用' : '尚未应用'}`}
                    </p>}
                </article>
            ))}
        </div>
        
    )
}
