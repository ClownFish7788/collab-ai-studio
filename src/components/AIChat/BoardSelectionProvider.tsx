'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { createBoardSelectionStore } from './boardSelectionStore'

const BoardSelectionContext = createContext<ReturnType<typeof createBoardSelectionStore> | null>(null)

export function BoardSelectionProvider({ scopeId, children }: { scopeId: string; children: ReactNode }) {
    const [scope, setScope] = useState(() => ({ id: scopeId, store: createBoardSelectionStore() }))
    // 切换文档时替换 store，保留尚未迁移的聊天和图片状态。
    if (scope.id !== scopeId) setScope({ id: scopeId, store: createBoardSelectionStore() })
    return <BoardSelectionContext.Provider value={scope.store}>{children}</BoardSelectionContext.Provider>
}

export function useBoardSelectionStore() {
    const store = useContext(BoardSelectionContext)
    if (!store) throw new Error('白板选区必须在 BoardSelectionProvider 内使用')
    return store
}
