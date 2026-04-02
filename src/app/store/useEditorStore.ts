import { create } from "zustand";

interface EditorStore {
    id: string
    title: string
    docData: unknown
    editorData: unknown
    toggleId: (id: string) => void
    updateTitle: (newTitle: string) => void
    updateDoc: (newData: unknown) => void
    updateEditor: (newData: unknown) => void
}

const useEditorStore = create<EditorStore>((set) => ({
    id: "",
    title: "",
    docData: null,
    editorData: null,
    toggleId: (newId: string) => set((state) => {
        if(newId !== state.id) return {
            id: newId,
            docData: null,
            editorData: null
        }
        return {
            id: newId
        }
    }),
    updateTitle: (newTitle) => set({title: newTitle}),
    updateDoc: (newData) => set(() => ({
        docData: newData
    })),
    updateEditor: (newDate) => set(() => ({
        editorData: newDate
    })) 
}))

export default useEditorStore