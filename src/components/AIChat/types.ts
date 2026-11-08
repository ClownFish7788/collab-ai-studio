import type { ImageAttachment } from '../../utils/chat/images'
import type { RegionSnapshot } from '../../agent/adapters/board/tldraw'
import type { BoardQuestion } from '../../agent/domain/tool'

export type QuestionAnswerDraft = { text: string; images: ImageAttachment[]; snapshot?: RegionSnapshot }
export type ChatClarification = { callId: string; questions: (BoardQuestion & { answer?: string; images?: ImageAttachment[]; snapshot?: RegionSnapshot })[] }

export type ChatMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
    images?: ImageAttachment[]
    snapshot?: RegionSnapshot
    status?: string
    failed?: boolean
    plan?: string
    preview?: string
    clarifications?: ChatClarification[]
    execution?: { description: string; draftId?: string }
}
