import type { ImageAttachment } from '../../utils/chat/images'
import type { RegionSnapshot } from '../../utils/board/snapshot/collectRegionSnapshot'

export type ChatMessage = {
    id: string
    role: 'user' | 'assistant'
    content: string
    images?: ImageAttachment[]
    snapshot?: RegionSnapshot
    status?: string
    failed?: boolean
    clarification?: { question: string; answer?: string }
    execution?: { description: string; draftId?: string }
}
