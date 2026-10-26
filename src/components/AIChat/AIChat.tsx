'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bot, Send, Square, Trash2, X } from 'lucide-react'
import Modal from '../Modal/Modal'
import { streamChat } from './streamChat'
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
    const requestRef = useRef<AbortController | null>(null)
    const [isStreaming, setIsStreaming] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => () => {
        requestRef.current?.abort()
        requestRef.current = null
    }, [])

    useEffect(() => {
        const list = messageListRef.current
        if (list) list.scrollTop = list.scrollHeight
    }, [messages, isOpen])

    const handleClose = () => {
        requestRef.current?.abort()
        setIsClosing(true)
    }

    const handleSend = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const content = input.trim()
        if (!content || requestRef.current) return

        const history: ChatMessage[] = [...messages.filter(message => message.content.trim()), { id: crypto.randomUUID(), role: 'user', content }]
        const assistantId = crypto.randomUUID()
        const controller = new AbortController()
        requestRef.current = controller
        setMessages([...history, { id: assistantId, role: 'assistant', content: '' }])
        setInput('')
        setError('')
        setIsStreaming(true)
        try {
            await streamChat(history.map(({ role, content }) => ({ role, content })), controller.signal, text => {
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
                                disabled={messages.length === 0 || isStreaming}
                                onClick={() => { setMessages([]); setError('') }}
                            >
                                <Trash2 size={16} aria-hidden="true" />
                            </button>
                            <button type="button" className={styles.clearButton} aria-label="关闭 AI 助手" onClick={handleClose}>
                                <X size={18} aria-hidden="true" />
                            </button>
                        </div>
                    </header>

                    <p className={styles.notice}>当前支持文字对话，暂不执行白板操作。</p>

                    <div ref={messageListRef} className={styles.messages} role="log" aria-label="聊天记录" aria-live="polite">
                        {messages.length === 0 ? (
                            <div className={styles.empty}>
                                <Bot size={32} aria-hidden="true" />
                                <h3>从一个问题开始</h3>
                                <p>例如：用一个例子解释 JavaScript 闭包。</p>
                            </div>
                        ) : messages.map(message => (
                            <article key={message.id} className={styles.message} data-role={message.role}>
                                <span className={styles.messageRole}>{message.role === 'user' ? '你' : 'AI 助手'}</span>
                                <p className={styles.bubble}>{message.content || '正在回复…'}</p>
                            </article>
                        ))}
                    </div>

                    <form className={styles.composer} onSubmit={handleSend}>
                        {error && <p className={styles.error} role="alert">{error}</p>}
                        <textarea
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
                            <span id={inputHintId}>Enter 发送 · Shift + Enter 换行</span>
                            {isStreaming ? <button type="button" className={styles.sendButton} onClick={() => requestRef.current?.abort()}>
                                <Square size={14} aria-hidden="true" />
                                停止生成
                            </button> : <button type="submit" className={styles.sendButton} disabled={!input.trim()}>
                                <Send size={16} aria-hidden="true" />
                                发送
                            </button>}
                        </div>
                        <p className={styles.footnote}>聊天记录刷新后清空。</p>
                    </form>
                </section>
            </Modal>
        </>
    )
}

export default AIChat
