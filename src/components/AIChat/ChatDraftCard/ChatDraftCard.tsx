'use client'

import { Layers } from 'lucide-react'
import { useBoardDraft } from '../../DrawEditor/BoardDraftProvider'
import styles from './ChatDraftCard.module.scss'

export default function ChatDraftCard({ isStreaming, onAbortRequest }: {
    isStreaming: boolean
    onAbortRequest: () => void
}) {
    const boardDraft = useBoardDraft()
    return (
        boardDraft.active && <div className={styles.draftCard} role="region" aria-label="当前白板草稿">
            <div className={styles.summary}>
                <Layers size={17} aria-hidden="true" />
                <div>
                    <h3>{boardDraft.applying ? '正在应用草稿…' : isStreaming || boardDraft.running ? '正在生成草稿…' : '草稿已就绪'}</h3>
                    <p>新增 {boardDraft.changes.added.length} · 修改 {boardDraft.changes.updated.length} · 删除 {boardDraft.changes.removed.length}</p>
                </div>
            </div>
            <div className={styles.actions}>
                <button type="button" className={styles.applyButton} disabled={isStreaming || boardDraft.running || boardDraft.applying || !boardDraft.canRun
                    || !boardDraft.changes.added.length && !boardDraft.changes.updated.length && !boardDraft.changes.removed.length}
                    onClick={() => void boardDraft.apply()}>应用到白板</button>
                <button type="button" className={styles.discardButton} onClick={() => { onAbortRequest(); boardDraft.discard() }}>放弃草稿</button>
            </div>
            {boardDraft.error && <p className={styles.error} role="alert">{boardDraft.error}</p>}
        </div>
    )
}
