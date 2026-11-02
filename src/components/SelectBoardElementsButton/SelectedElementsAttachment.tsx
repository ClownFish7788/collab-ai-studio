'use client'

import { Scan, X } from 'lucide-react'
import { useStore } from 'zustand'
import { useBoardSelectionStore } from '../AIChat/BoardSelectionProvider'
import styles from './SelectBoardElementsButton.module.scss'

export default function SelectedElementsAttachment({ onRemove, count: suppliedCount }: { onRemove?: () => void; count?: number }) {
    const store = useBoardSelectionStore()
    const selectedCount = useStore(store, state => state.snapshot?.shapes.length ?? 0)
    const count = suppliedCount ?? selectedCount
    if (!count) return null

    return <div className={styles.attachment}>
        <Scan size={16} aria-hidden="true" />
        <span role="status">已选中 {count} 个元素</span>
        {onRemove && <button
            type="button"
            className={styles.remove}
            aria-label="取消已选白板元素"
            title="取消选择"
            onClick={() => {
                store.getState().clearSnapshot()
                onRemove()
            }}
        ><X size={12} aria-hidden="true" /></button>}
    </div>
}
