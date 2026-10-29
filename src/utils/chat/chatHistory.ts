import { getBoardConversationHistory, type BoardConversationTurn } from '../board/agent/boardCreateProtocol'
import { toMessageContent, type ImageAttachment } from './images'
import type { RegionSnapshot } from '../board/snapshot/collectRegionSnapshot'

type ChatHistoryMessage = {
    role: 'user' | 'assistant'; content: string; images?: ImageAttachment[]; failed?: boolean
    snapshot?: RegionSnapshot; clarification?: { question: string; answer?: string }
}

/** 仅回传完成的完整轮次；保留图片与真实回答，旧快照和工具结果不承担新任务授权。 */
export function toAgentHistory(messages: readonly ChatHistoryMessage[]): BoardConversationTurn[] {
    const turns: BoardConversationTurn[] = []
    for (let i = 0; i < messages.length - 1; i++) {
        const user = messages[i], assistant = messages[i + 1]
        if (user.role !== 'user' || assistant.role !== 'assistant' || !assistant.content || assistant.failed) continue
        const answer = assistant.clarification
        const reply = (answer?.answer ? `追问：${answer.question}\n用户回答：${answer.answer}\n回复：` : '') + assistant.content
        if (reply.length > 8000) continue // 不截断一个轮次里的问答含义。
        turns.push({ prompt: user.content || (user.images?.length ? '' : '附加的白板选区'), reply,
            ...(user.images?.length ? { images: user.images.map(image => image.dataUrl) } : {}) })
    }
    return getBoardConversationHistory(turns)
}

/** 展示用的停止/失败行不构成模型消息，避免空 assistant 使后续普通聊天持续被拒绝。 */
export function toChatMessages(messages: readonly ChatHistoryMessage[]) {
    return messages.filter(message => !message.failed && (message.content.trim() || message.images?.length || message.snapshot?.shapes.length))
        .map(({ role, content, images, snapshot }) => ({ role, content: toMessageContent(content, images), snapshot }))
}
