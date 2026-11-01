'use client'

import { useEffect, useRef, useState } from 'react'
import type { useBoardDraft } from '../components/DrawEditor/BoardDraftProvider'
import { useBoardSelectionStore } from '../components/AIChat/BoardSelectionProvider'
import { streamChat } from '../utils/chat/streamChat'
import { validateChatSnapshot } from '../utils/board/snapshot/chatSnapshots'
import { parseAskInput } from '../utils/board/agent/boardCreateProtocol'
import { toAgentHistory, toChatMessages } from '../utils/chat/chatHistory'
import { useChatImages } from './useChatImages'
import type { ChatMessage } from '../components/AIChat/types'

export function useChatSession({ boardDraft, isClosing }: {
    boardDraft: ReturnType<typeof useBoardDraft>
    isClosing: boolean
}) {
    const selectionStore = useBoardSelectionStore()
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [input, setInput] = useState('')
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const requestRef = useRef<AbortController | null>(null)
    const assistantRef = useRef<string | null>(null)
    const [isStreaming, setIsStreaming] = useState(false)
    const [error, setError] = useState('')
    const attachments = useChatImages({ requestRef, isClosing, setError })
    const { images, setImages, isReadingImages, cancelReading } = attachments

    useEffect(() => () => {
        requestRef.current?.abort()
        requestRef.current = null
    }, [])

    const abortRequest = () => { requestRef.current?.abort() }
    const stop = () => {
        abortRequest()
        boardDraft.cancel()
    }
    const close = () => {
        stop()
        cancelReading()
    }
    const clear = () => { setMessages([]); setError('') }

    const send = async () => {
        const content = input.trim()
        // 回答只唤醒原任务，不启动下一次模型任务。
        if (boardDraft.question && requestRef.current) {
            if (!content || content.length > 1000) return
            const pending = boardDraft.question
            setMessages(previous => previous.map(message => message.id === assistantRef.current
                ? { ...message, clarification: { question: pending.text, answer: content }, status: '正在继续处理…' } : message))
            setInput('')
            pending.submit(content)
            return
        }
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
            ...messages.filter(message => message.content.trim() || message.images?.length || message.snapshot?.shapes.length || message.status || message.clarification),
            { id: crypto.randomUUID(), role: 'user', content, images, snapshot },
        ]
        const assistantId = crypto.randomUUID()
        const controller = new AbortController()
        requestRef.current = controller
        assistantRef.current = assistantId
        setMessages([...history, { id: assistantId, role: 'assistant', content: '', status: '正在思考…' }])
        setInput('')
        setImages([])
        selectionStore.getState().clearSnapshot()
        setError('')
        setIsStreaming(true)
        const updateReply = (update: (message: ChatMessage) => ChatMessage) => {
            if (requestRef.current !== controller || controller.signal.aborted) return
            setMessages(previous => previous.map(message => message.id === assistantId ? update(message) : message))
        }
        try {
            if (boardDraft.canRun) {
                const result = await boardDraft.run({ prompt: content, history: toAgentHistory(messages),
                    ...(images.length ? { images: images.map(image => image.dataUrl) } : {}), ...(snapshot ? { snapshot } : {}) }, controller.signal, step => {
                    if (step.stage === 'text') updateReply(message => ({ ...message, content: message.content + step.message }))
                    if (step.stage === 'request') updateReply(message => ({ ...message, status: step.message }))
                    if (step.stage === 'preview') updateReply(message => ({ ...message, preview: step.message }))
                    if (step.stage === 'plan') updateReply(message => ({ ...message, plan: step.message, preview: undefined, status: '需求已拆分，正在规划并执行…' }))
                    if (step.stage === 'call' && step.data && 'function' in step.data) {
                        const call = step.data
                        const labels = { get_board_snapshot: '正在读取白板…', ask_user: '等待你的回答', create_shapes: '正在生成草稿…', update_shapes: '正在更新草稿…', delete_shapes: '正在生成删除草稿…' }
                        updateReply(message => ({ ...message, status: labels[call.function.name],
                            ...(call.function.name === 'ask_user' ? { clarification: parseAskInput(call.function.arguments) } : {}) }))
                        if (call.function.name === 'ask_user') inputRef.current?.focus()
                    }
                })
                const description = result.results.map(({ output }) => 'ids' in output ? `草稿删除 ${output.ids.length} 个元素`
                    : `草稿${'operation' in output ? '更新' : '新增'} ${output.shapes.length} 个元素`).join('；') || '本轮未更改白板'
                updateReply(message => ({ ...message, content: result.text, preview: undefined, status: undefined,
                    execution: { description, ...(result.results.length && result.draftId ? { draftId: result.draftId } : {}) } }))
            } else {
                await streamChat(toChatMessages(history), controller.signal,
                    text => updateReply(message => ({ ...message, content: message.content + text, status: undefined })))
            }
        } catch (error) {
            if (requestRef.current === controller) {
                if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '对话失败，请重试')
                setMessages(previous => previous.map(message => message.id === assistantId
                    ? { ...message, failed: true, status: controller.signal.aborted ? '已停止，已有草稿可在白板侧检查' : '任务未完成，请检查错误提示' } : message))
            }
        } finally {
            if (requestRef.current === controller) {
                requestRef.current = null
                assistantRef.current = null
                setIsStreaming(false)
            }
        }
    }

    return { messages, input, setInput, inputRef, isStreaming, error, attachments, send, stop, close, clear, abortRequest }
}
