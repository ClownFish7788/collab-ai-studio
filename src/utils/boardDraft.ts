import { createTLStore, isEqual, type TLPageId, type TLShape, type TLStore, type TLStoreSnapshot } from 'tldraw'

export type BoardDraft = {
    runId: string
    pageId: TLPageId
    baseline: TLStoreSnapshot
    store: TLStore
    status: 'active' | 'applied' | 'discarded'
}

export function createBoardDraft(source: TLStore, pageId: TLPageId): BoardDraft {
    if (source.get(pageId)?.typeName !== 'page') throw new Error('当前页面不存在')
    const baseline = structuredClone(source.getStoreSnapshot('document'))
    return {
        runId: crypto.randomUUID(), pageId, baseline, status: 'active',
        store: createTLStore({ schema: source.schema, snapshot: baseline }),
    }
}

export function getDraftAdditions(draft: BoardDraft, target: TLStore): TLShape[] {
    if (draft.status !== 'active') throw new Error('草稿任务已失效')
    const current = draft.store.serialize('document')
    for (const record of Object.values(draft.baseline.store)) {
        if (!isEqual(record, current[record.id])) throw new Error('本阶段仅支持新增图形，请放弃草稿后重试')
    }
    if (!isEqual(target.get(draft.pageId), draft.baseline.store[draft.pageId])) {
        throw new Error('正式页面已被修改或删除，请放弃草稿后重试')
    }
    const additions: TLShape[] = []
    for (const record of Object.values(current)) {
        if (draft.baseline.store[record.id]) continue
        // shortcut: 首个闭环仅新增当前页面的基础图形，修改、删除及绑定在操作函数阶段开放。
        if (record.typeName !== 'shape' || record.type !== 'geo') throw new Error('本阶段仅支持新增基础图形')
        if (record.parentId !== draft.pageId) throw new Error('草稿图形不属于当前页面')
        if (target.has(record.id)) throw new Error('新增图形 ID 冲突，请放弃草稿后重试')
        additions.push(record)
    }
    return additions
}

export function applyBoardDraft(draft: BoardDraft, target: TLStore): number {
    const additions = getDraftAdditions(draft, target)
    if (!additions.length) throw new Error('草稿没有可应用的修改')
    // 只写净新增记录；正式 Store 的既有监听负责写入 Y.Doc。
    target.put(additions)
    draft.status = 'applied'
    return additions.length
}

export function discardBoardDraft(draft: BoardDraft) {
    if (draft.status === 'active') draft.status = 'discarded'
}
