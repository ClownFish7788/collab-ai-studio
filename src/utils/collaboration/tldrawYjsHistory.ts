import { atom } from '@tldraw/state'
import type { Editor } from 'tldraw'
import * as Y from 'yjs'
import type { TldrawYjsBinding } from './bindTldrawYjs'

/** Route public history commands, including gesture cancellation, through one guarded document history. */
export function attachTldrawYjsHistory(editor: Editor, binding: TldrawYjsBinding, onConflict: () => void): () => void {
    const manager = binding.undoManager
    const revision = atom('board-history', 0)
    const refresh = () => revision.update(value => value + 1)
    const marks = new Map<string, number>()
    const original = {
        undo: editor.undo, redo: editor.redo,
        getCanUndo: editor.getCanUndo, getCanRedo: editor.getCanRedo,
        clearHistory: editor.clearHistory,
        markHistoryStoppingPoint: editor.markHistoryStoppingPoint,
        getMarkIdMatching: (editor as Editor & { getMarkIdMatching(name: string): string | undefined }).getMarkIdMatching,
        bail: editor.bail, bailToMark: editor.bailToMark, squashToMark: editor.squashToMark,
    }
    const events = ['stack-item-added', 'stack-item-updated', 'stack-item-popped', 'stack-cleared'] as const
    for (const event of events) manager.on(event, refresh)

    function replay(direction: 'undo' | 'redo') {
        if (editor.getIsReadonly()) return editor
        editor.complete()
        editor.store._flushHistory()
        const stack = direction === 'undo' ? manager.undoStack : manager.redoStack
        if (stack.length && !binding[direction]()) onConflict()
        refresh()
        return editor
    }

    function cancelTo(index: number) {
        if (editor.getIsReadonly()) return editor
        editor.store._flushHistory()
        const steps = manager.undoStack.slice(index)
        if (!steps.length) return editor
        if (steps.some(step => !binding.canReplay(step))) { onConflict(); return editor }
        while (manager.undoStack.length > index) {
            if (!binding.undo()) { onConflict(); return editor }
        }
        manager.clear(false, true)
        refresh()
        return editor
    }

    Object.assign(editor, {
        undo: () => replay('undo'),
        redo: () => replay('redo'),
        getCanUndo: () => { revision.get(); return manager.undoStack.length > 0 },
        getCanRedo: () => { revision.get(); return manager.redoStack.length > 0 },
        clearHistory: () => { manager.clear(); marks.clear(); original.clearHistory.call(editor); refresh(); return editor },
        markHistoryStoppingPoint: (name?: string) => {
            editor.store._flushHistory()
            manager.stopCapturing()
            const id = original.markHistoryStoppingPoint.call(editor, name)
            marks.set(id, manager.undoStack.length)
            return id
        },
        getMarkIdMatching: (name: string) => [...marks.keys()].reverse().find(id => id.includes(name)),
        bail: () => cancelTo(Math.max(0, manager.undoStack.length - 1)),
        bailToMark: (id: string) => cancelTo(marks.get(id) ?? manager.undoStack.length),
        squashToMark: (id: string) => {
            editor.store._flushHistory()
            const index = marks.get(id)
            if (index === undefined) return editor
            const steps = manager.undoStack.slice(index)
            if (steps.length < 2) return editor
            const first = steps[0]
            first.insertions = Y.mergeDeleteSets(steps.map(step => step.insertions))
            first.deletions = Y.mergeDeleteSets(steps.map(step => step.deletions))
            const footprint = new Map<string, number>()
            for (const step of steps) {
                const values: Map<string, number> = step.meta.get('board-footprint')
                for (const [key, value] of values) {
                    footprint.set(key, footprint.has(key) && footprint.get(key) !== value ? -1 : value)
                }
            }
            first.meta.set('board-footprint', footprint)
            manager.undoStack.splice(index, steps.length, first)
            manager.stopCapturing()
            refresh()
            return editor
        },
    })
    return () => {
        for (const event of events) manager.off(event, refresh)
        Object.assign(editor, original)
    }
}
