import { create } from "zustand";

type ModalType = 'SETTINGS' | 'SEARCH' | null

export type Theme = 'light' | 'dark'

interface StyleState {
    leftBarOpen: boolean
    settingModalOpen: boolean
    searchModalOpen: boolean
    theme: 'light' | 'dark'
    toggleTheme: (theme: Theme) => void
    toggleModalOpen: (modalType: ModalType) => void
    toggleLeftBarOpen: () => void
}

const useStyleStore = create<StyleState>((set) => ({
    leftBarOpen: true,
    settingModalOpen: false,
    searchModalOpen: false,
    theme: 'light',
    toggleTheme: (newTheme) => set(() => ({theme: newTheme})),
    toggleModalOpen: (modalType) => set(() => ({
        settingModalOpen: modalType === 'SETTINGS',
        searchModalOpen: modalType === 'SEARCH',
    })),
    toggleLeftBarOpen: () => set((state) => ({leftBarOpen: !state.leftBarOpen}))
}))

export default useStyleStore