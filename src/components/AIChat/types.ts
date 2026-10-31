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
    plan?: string
    preview?: string
    clarification?: { question: string; answer?: string }
    execution?: { description: string; draftId?: string }
}
