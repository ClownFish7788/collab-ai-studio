import type { ImageAttachment } from '../../utils/chat/images'
import type { RegionSnapshot } from '../../agent/adapters/board/tldraw'

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
    clarification?: { question: string; answer?: string; images?: ImageAttachment[]; snapshot?: RegionSnapshot }
    execution?: { description: string; draftId?: string }
}
