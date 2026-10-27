'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Scan } from 'lucide-react'
import { useEditor, useValue, type TLPageId, type TLShapeId } from 'tldraw'
import { collectRegionSnapshot } from '../../utils/collectRegionSnapshot'
import styles from './SelectBoardElementsButton.module.scss'

type Props = {
    isSelecting: boolean
    onSelectingChange: (isSelecting: boolean) => void
    disabled?: boolean
}

type SelectionSession = {
    pageId: TLPageId
    toolId: string
    selectedIds: TLShapeId[]
}

/**
 * 只负责选取 AI 上下文：框选与点选沿用 tldraw，确认时读取快照，不提交白板修改。
 * 由 AIChat 视觉隐藏面板；确认栏 portal 到 body，避免随面板一起隐藏或被 inert 禁用。
 */
export default function SelectBoardElementsButton({ isSelecting, onSelectingChange, disabled }: Props) {
    const editor = useEditor()
    const buttonRef = useRef<HTMLButtonElement>(null)
    const sessionRef = useRef<SelectionSession | null>(null)
    const [error, setError] = useState('')
    const selectedCount = useValue('AI context selection count', () => editor.getSelectedShapeIds().length, [editor])

    const restoreSession = useCallback((restoreSelection: boolean) => {
        const session = sessionRef.current
        sessionRef.current = null
        if (!session || editor.isDisposed) return

        // 只切换到同一个 select 工具不会退出 brushing；先取消仍在进行的原生交互。
        if (restoreSelection) editor.cancel()
        editor.setCurrentTool(session.toolId)
        // 协作者可能删除元素或把它移到别页；只恢复仍属于原页的 ID。
        if (restoreSelection && editor.getCurrentPageId() === session.pageId) {
            const currentIds = editor.getCurrentPageShapeIds()
            editor.setSelectedShapes(session.selectedIds.filter(id => currentIds.has(id)))
        }
    }, [editor])

    const finishSelection = useCallback((cancelled: boolean) => {
        restoreSession(cancelled)
        onSelectingChange(false)
        // 等聊天面板恢复可见且解除 inert 后，再将焦点交回入口。
        requestAnimationFrame(() => buttonRef.current?.focus())
    }, [onSelectingChange, restoreSession])

    useEffect(() => {
        if (!isSelecting) return
        editor.focus()

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            finishSelection(true)
        }
        // capture 保证 Esc 只结束选取，不继续触发聊天关闭或 tldraw 的其他快捷键。
        document.addEventListener('keydown', handleEscape, true)
        const stopListening = editor.store.listen(() => {
            if (sessionRef.current && editor.getCurrentPageId() !== sessionRef.current.pageId) {
                finishSelection(true)
            }
        }, { scope: 'session' })
        return () => {
            document.removeEventListener('keydown', handleEscape, true)
            stopListening()
        }
    }, [editor, finishSelection, isSelecting])

    // 离开白板/卸载时也要恢复工具，不能把临时选择会话留给下次挂载。
    useEffect(() => () => restoreSession(true), [restoreSession])

    const startSelection = () => {
        if (disabled || sessionRef.current) return
        sessionRef.current = {
            pageId: editor.getCurrentPageId(),
            toolId: editor.getCurrentToolId(),
            selectedIds: [...editor.getSelectedShapeIds()],
        }
        setError('')
        editor.setCurrentTool('select')
        onSelectingChange(true)
    }

    const confirmSelection = () => {
        if (!sessionRef.current) return
        if (editor.getCurrentPageId() !== sessionRef.current.pageId) {
            finishSelection(true)
            return
        }
        try {
            editor.complete()
            const selectedIds = editor.getSelectedShapeIds()
            const region = editor.getSelectionPageBounds() ?? undefined
            // 外接矩形只确定范围；ID 才确定选区。过滤必须发生在参照物选择之前。
            // shortcut: 分组只收集原生选中 ID；需要组内语义时再显式展开子元素。
            const snapshot = collectRegionSnapshot(editor, region, undefined, selectedIds)
            console.log('白板选区快照', snapshot)
            finishSelection(false)
        } catch (error) {
            // 失败时留在选取模式，允许调整后重试；不能把失败伪装成一次空选区确认。
            setError(error instanceof Error ? error.message : '读取白板选区失败，请重试')
        }
    }

    return <>
        <button
            ref={buttonRef}
            type="button"
            className={styles.button}
            aria-label="选择白板元素"
            title="选择白板元素"
            disabled={disabled}
            onClick={startSelection}
        ><Scan size={18} aria-hidden="true" /></button>
        {isSelecting && createPortal(
            <div
                className={styles.selectionToolbar}
                role="region"
                aria-label="白板元素选择"
                onPointerDown={event => event.stopPropagation()}
                onKeyDown={event => event.stopPropagation()}
            >
                <span role="status">已选 {selectedCount} 个元素 · 从空白处拖拽框选</span>
                <button type="button" onClick={confirmSelection}>确认选择</button>
                <button type="button" onClick={() => finishSelection(true)}>取消</button>
                {error && <p className={styles.error} role="alert">{error}</p>}
            </div>,
            document.body,
        )}
    </>
}
