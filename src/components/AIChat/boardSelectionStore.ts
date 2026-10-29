import { createStore } from 'zustand'
import type { RegionSnapshot } from '../../utils/board/snapshot/collectRegionSnapshot'

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
