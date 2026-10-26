'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bot, Send, Trash2, X } from 'lucide-react'
import Modal from '../Modal/Modal'
import styles from './AIChat.module.scss'

type ChatMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
}

const AIChat = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState('')
    const messageListRef = useRef<HTMLDivElement>(null)
    const inputHintId = useId()
    const panelId = useId()
    const [isOpen, setIsOpen] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const launcherRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        const list = messageListRef.current
        if (list) list.scrollTop = list.scrollHeight
    }, [messages, isOpen])

    const handleSend = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const content = input.trim()
        if (!content) return

        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'user', content }])
        setInput('')
        // TODO: 在这里接入模型请求，收到真实响应后追加 assistant 消息。
    }

    // shortcut: 聊天仅保存在组件内存中，接入任务控制时按房间隔离并处理取消。
    return (
        <>
            <button
                ref={launcherRef}
                type="button"
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
                closeFn={() => setIsClosing(true)}
                className={styles.drawer}
                containerClassName={styles.drawerContainer}
            >
                <section
                    id={panelId}
                    className={styles.chat}
                    role="dialog"
                    aria-modal="true"
                    aria-label="白板 AI 助手"
                    data-closing={isClosing}
                    onAnimationEnd={event => {
                        if (event.target !== event.currentTarget || !isClosing) return
                        setIsOpen(false)
                        setIsClosing(false)
                        launcherRef.current?.focus()
                    }}
                    onKeyDown={event => {
                        event.stopPropagation()
                        if (event.key === 'Escape') setIsClosing(true)
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
                                disabled={messages.length === 0}
                                onClick={() => setMessages([])}
                            >
                                <Trash2 size={16} aria-hidden="true" />
                            </button>
                            <button type="button" className={styles.clearButton} aria-label="关闭 AI 助手" onClick={() => setIsClosing(true)}>
                                <X size={18} aria-hidden="true" />
                            </button>
                        </div>
                    </header>

                    <p className={styles.notice}>AI 接口尚未接入，消息仅在当前页面展示。</p>

                    <div ref={messageListRef} className={styles.messages} role="log" aria-label="聊天记录" aria-live="polite">
                        {messages.length === 0 ? (
                            <div className={styles.empty}>
                                <Bot size={32} aria-hidden="true" />
                                <h3>描述你的白板想法</h3>
                                <p>例如：画两个圆，用箭头连接。</p>
                                <p>修改已有内容时，请先在白板上选中对象。</p>
                            </div>
                        ) : messages.map(message => (
                            <article key={message.id} className={styles.message} data-role={message.role}>
                                <span className={styles.messageRole}>{message.role === 'user' ? '你' : 'AI 助手'}</span>
                                <p className={styles.bubble}>{message.content}</p>
                            </article>
                        ))}
                    </div>

                    <form className={styles.composer} onSubmit={handleSend}>
                        <textarea
                            autoFocus
                            aria-label="聊天消息"
                            aria-describedby={inputHintId}
                            placeholder="输入你的白板需求…"
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
                            <span id={inputHintId}>Enter 发送 · Shift + Enter 换行</span>
                            <button type="submit" className={styles.sendButton} disabled={!input.trim()}>
                                <Send size={16} aria-hidden="true" />
                                发送
                            </button>
                        </div>
                        <p className={styles.footnote}>聊天记录刷新后清空。</p>
                    </form>
                </section>
            </Modal>
        </>
    )
}

export default AIChat
