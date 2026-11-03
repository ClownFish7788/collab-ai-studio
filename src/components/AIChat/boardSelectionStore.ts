import { createStore } from 'zustand'
import type { RegionSnapshot } from '../../agent/adapters/board/tldraw'

type BoardSelectionState = {
    snapshot: RegionSnapshot | null
    setSnapshot: (snapshot: RegionSnapshot) => void
    clearSnapshot: () => void
}

export const createBoardSelectionStore = () => createStore<BoardSelectionState>(set => ({
    snapshot: null,
    setSnapshot: snapshot => set({ snapshot }),
    clearSnapshot: () => set({ snapshot: null }),
}))
