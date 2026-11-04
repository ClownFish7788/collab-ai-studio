import {
    createTLStore,
    isEqual,
    type TLPageId,
    type TLRecord,
    type TLShape,
    type TLShapeId,
    type TLStore,
    type TLStoreSnapshot,
    type RecordsDiff
} from 'tldraw'

import { DRAFT_SHAPE_TYPES } from './draftShapeSchema'
export { DRAFT_SHAPE_TYPES, type DraftShapeType } from './draftShapeSchema'

export type BoardDraft = {
    runId: string
    pageId: TLPageId
    baseline: TLStoreSnapshot
    store: TLStore
    /** 明确附加选区、任务读取实际返回的对象与本次新建对象；依赖检查不扩大范围。 */
    scope: Set<TLShapeId>
    /** 新导入资产；正式白板已有资产保持不可变。 */
    assets: Set<string>
    status: 'active' | 'applied' | 'discarded'
}

export type DraftChanges = {
    added: TLRecord[]
    updated: [TLRecord, TLRecord][]
    removed: TLRecord[]
}

/** 输入正式 Store、页面及明确选中 ID；输出不接持久化/同步的独立文档草稿。 */
export function createBoardDraft(source: TLStore, pageId: TLPageId, selectionIds: readonly TLShapeId[] = []): BoardDraft {
    if (source.get(pageId)?.typeName !== 'page') {
        throw new Error('当前页面不存在')
    }

    const baseline = structuredClone(source.getStoreSnapshot('document'))

    return {
        runId: crypto.randomUUID(),
        pageId,
        baseline,
        status: 'active',
        scope: new Set(selectionIds),
        assets: new Set(),
        store: createTLStore({ schema: source.schema, snapshot: baseline })
    }
}

export function isSupportedDraftShape(record: TLRecord | undefined): record is TLShape {
    return record?.typeName === 'shape' && (DRAFT_SHAPE_TYPES as readonly string[]).includes(record.type)
}

/** 返回实际所属页面；拒绝循环、缺失父对象和非法容器。 */
export function shapePage(records: Record<string, TLRecord>, id: string): string {
    const seen = new Set<string>()
    let record = records[id]

    while (record?.typeName === 'shape') {
        if (seen.has(record.id)) {
            throw new Error('父子关系存在循环')
        }

        seen.add(record.id)
        const parent = records[record.parentId]

        if (parent?.typeName === 'shape' && !['group', 'frame'].includes(parent.type)) {
            throw new Error('父对象必须是 frame 或 group')
        }

        record = parent
    }

    if (record?.typeName !== 'page') {
        throw new Error('图形所属页面不存在')
    }

    return record.id
}

/** 输入两个文档快照；输出精确差异，供提交及单次调用回滚复用。 */
export function documentDiff(before: Record<string, TLRecord>, after: Record<string, TLRecord>): RecordsDiff<TLRecord> {
    const diff: RecordsDiff<TLRecord> = {
        added: {},
        updated: {},
        removed: {}
    }

    for (const record of Object.values(before)) {
        if (!after[record.id]) {
            diff.removed[record.id] = record
        } else if (!isEqual(record, after[record.id])) {
            diff.updated[record.id] = [record, after[record.id]]
        }
    }

    for (const record of Object.values(after)) {
        if (!before[record.id]) {
            diff.added[record.id] = record
        }
    }

    return diff
}

/** 校验操作范围、父子关系、绑定和资产，输出最终文档净变化。 */
export function getDraftChanges(draft: BoardDraft): DraftChanges {
    if (draft.status !== 'active') {
        throw new Error('草稿任务已失效')
    }

    const current: Record<string, TLRecord> = draft.store.serialize('document')
    const diff = documentDiff(draft.baseline.store, current)
    const changes = {
        added: Object.values(diff.added),
        updated: Object.values(diff.updated),
        removed: Object.values(diff.removed)
    }

    for (const record of [...changes.added, ...changes.updated.flat(), ...changes.removed]) {
        if (record.typeName === 'shape') {
            if (!isSupportedDraftShape(record) || !draft.scope.has(record.id)) {
                throw new Error('图形不受支持或超出本次操作范围')
            }

            const records = current[record.id] === record ? current : draft.baseline.store

            if (shapePage(records, record.id) !== draft.pageId) {
                throw new Error('不允许操作其他页面')
            }
            // 容器移动/删除会改变子对象的可见结果，不能只检查本地坐标变化。
            const parents = new Set<string>([record.id])
            let size = -1

            while (size !== parents.size) {
                size = parents.size

                for (const child of Object.values(records)) {
                    if (child.typeName === 'shape' && parents.has(child.parentId)) {
                        if (!draft.scope.has(child.id)) {
                            throw new Error('容器后代不在本次范围内')
                        }

                        parents.add(child.id)
                    }
                }
            }
        } else if (record.typeName === 'binding') {
            if (record.type !== 'arrow' || !draft.scope.has(record.fromId)) {
                throw new Error('绑定箭头不在本次范围内')
            }
        } else if (record.typeName === 'asset') {
            if (draft.baseline.store[record.id] || !draft.assets.has(record.id)) {
                throw new Error('已有资产不可修改或删除')
            }
        } else {
            throw new Error('不允许修改页面或文档设置')
        }
    }

    for (const [before, after] of changes.updated) {
        if (before.typeName !== after.typeName
            || ('type' in before && (!('type' in after) || before.type !== after.type))) {
            throw new Error('记录类型不可修改')
        }
    }

    for (const record of Object.values(current)) {
        if (record.typeName === 'shape' && draft.scope.has(record.id)) {
            if (shapePage(current, record.id) !== draft.pageId) {
                throw new Error('不允许跨页面操作')
            }
            if ('assetId' in record.props && record.props.assetId !== null) {
                const asset = current[record.props.assetId as string]

                if (asset?.typeName !== 'asset' || asset.type !== record.type) {
                    throw new Error('资产不存在或类型不匹配')
                }
            }
        }

        if (record.typeName === 'binding' && (draft.scope.has(record.fromId) || draft.scope.has(record.toId))) {
            const arrow = current[record.fromId]
            const target = current[record.toId]

            if (arrow?.typeName !== 'shape' || arrow.type !== 'arrow' || target?.typeName !== 'shape'
                || shapePage(current, arrow.id) !== draft.pageId
                || shapePage(current, target.id) !== draft.pageId) {
                throw new Error('绑定端点不存在或不在当前页面')
            }

            const old = draft.baseline.store[record.id]

            if ((!old || old.typeName !== 'binding' || old.toId !== record.toId) && !draft.scope.has(record.toId)) {
                throw new Error('新绑定目标不在本次范围内')
            }
        }
    }

    return changes
}

function dependencies(records: Record<string, TLRecord>, seeds: Iterable<string>): Set<string> {
    const ids = new Set(seeds)
    let size = -1

    while (size !== ids.size) {
        size = ids.size

        for (const record of Object.values(records)) {
            if (record.typeName === 'shape') {
                if (ids.has(record.id)) {
                    ids.add(record.parentId)

                    if ('assetId' in record.props && record.props.assetId) {
                        ids.add(record.props.assetId as string)
                    }
                }

                if (ids.has(record.parentId) && records[record.parentId]?.typeName === 'shape') {
                    ids.add(record.id)
                }
            } else if (record.typeName === 'binding'
                && (ids.has(record.fromId) || ids.has(record.toId) || ids.has(record.id))) {
                ids.add(record.id)
                ids.add(record.fromId)
                ids.add(record.toId)
            }
        }
    }

    return ids
}

/**
 * 输入草稿与正式 Store；输出记录增改删数量。原生派生结果一次进入现有 Y.Doc 监听链路。
 * 同时比较依赖记录与关系成员，拒绝并发变化，保留无关远端更新；不提供跨客户端原子锁。
 */
export function applyBoardDraft(draft: BoardDraft, target: TLStore): {
    added: number
    updated: number
    removed: number
} {
    const changes = getDraftChanges(draft)
    const current: Record<string, TLRecord> = draft.store.serialize('document')
    const seeds = new Set<string>([draft.pageId])

    for (const record of [...changes.added, ...changes.updated.flat(), ...changes.removed]) {
        seeds.add(record.id)
    }

    for (const id of dependencies(current, seeds)) {
        if (draft.baseline.store[id as TLRecord['id']]) {
            seeds.add(id)
        }
    }

    const expected = dependencies(draft.baseline.store, seeds)
    const live = dependencies(target.serialize('document'), seeds)

    if (!isEqual([...expected].sort(), [...live].sort())) {
        throw new Error('对象依赖已发生变化，请重新生成草稿')
    }

    for (const id of expected) {
        if (!isEqual(draft.baseline.store[id as TLRecord['id']], target.get(id as TLRecord['id']))) {
            throw new Error('目标或依赖已被协作者改变，请重新生成草稿')
        }
    }

    for (const record of changes.added) {
        if (target.has(record.id)) {
            throw new Error('新增记录 ID 冲突')
        }
    }

    const summary = {
        added: changes.added.length,
        updated: changes.updated.length,
        removed: changes.removed.length
    }

    if (!summary.added && !summary.updated && !summary.removed) {
        throw new Error('草稿没有可应用的修改')
    }
    // 已在草稿完成重排；正式 Editor 不重复运行书签请求和绑定回调。
    target.applyDiff(documentDiff(draft.baseline.store, current), { runCallbacks: false })
    draft.status = 'applied'

    return summary
}

/** 输入草稿，使任务失效；无返回值，正式数据无需回滚。 */
export function discardBoardDraft(draft: BoardDraft) {
    if (draft.status === 'active') {
        draft.status = 'discarded'
    }
}
