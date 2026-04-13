import { create } from "zustand";

type Role = 'owner' | 'collaborator' | 'viewer' | null

interface EditorStore {
    id: string
    title: string
    role: Role
    docData: unknown
    editorData: unknown
    toggleId: (id: string) => void
    updateTitle: (newTitle: string) => void
    updateDoc: (newData: unknown) => void
    updateEditor: (newData: unknown) => void
    setRole: (role: Role) => void
}

const useEditorStore = create<EditorStore>((set) => ({
    id: "",
    title: "",
    role: null,
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
    updateTitle: (newTitle) => {
        set({title: newTitle})
        console.trace('setTitle 被调用，新值为:', newTitle);
    },
    updateDoc: (newData) => set(() => ({
        docData: newData
    })),
    updateEditor: (newDate) => set(() => ({
        editorData: newDate
    })),
    setRole: (role) => set(() => ({
        role
    }))
}))

export default useEditorStore