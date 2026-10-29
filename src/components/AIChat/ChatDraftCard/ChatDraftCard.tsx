'use client'

import { useBoardDraft } from '../../DrawEditor/BoardDraftProvider'
import styles from './ChatDraftCard.module.scss'

export default function ChatDraftCard({ isStreaming, onAbortRequest }: {
    isStreaming: boolean
    onAbortRequest: () => void
}) {
    const boardDraft = useBoardDraft()
    return (
        boardDraft.active && <div className={styles.draftCard} role="region" aria-label="当前白板草稿">
            <p>未应用草稿：新增 {boardDraft.changes.added.length}，修改 {boardDraft.changes.updated.length}，删除 {boardDraft.changes.removed.length}</p>
            <button type="button" disabled={isStreaming || boardDraft.running || boardDraft.applying || !boardDraft.canRun
                || !boardDraft.changes.added.length && !boardDraft.changes.updated.length && !boardDraft.changes.removed.length}
                onClick={() => void boardDraft.apply()}>应用到白板</button>
            <button type="button" onClick={() => { onAbortRequest(); boardDraft.discard() }}>放弃草稿</button>
            {boardDraft.error && <p role="alert">{boardDraft.error}</p>}
        </div>
    )
}
