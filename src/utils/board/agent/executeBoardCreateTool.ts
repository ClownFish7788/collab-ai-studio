import type { TLShape, TLShapeId } from 'tldraw'
import type { CreateDraftShapeInput, UpdateDraftShapeInput } from '../draft/draftShapeOperations'
import type { RegionSnapshot } from '../snapshot/collectRegionSnapshot'
import { validateChatSnapshot } from '../snapshot/chatSnapshots'
import {
    validateBoardToolCall, validateBoardToolOutput, parseCreateInput, parseSnapshotInput, parseAskInput, parseUpdateInput, parseDeleteInput,
    BoardProtocolError, ERROR_CODES, CREATE_GEOS,
    type BoardToolOutput, type SnapshotRange, type SnapshotToolSuccess, type CreatedToolShape,
} from './boardCreateProtocol'

/**
 * 创建单任务浏览器执行器：接收明确附件、草稿读写和真实用户询问回调，输出异步工具执行函数。
 * 首份快照固定参照点；读取通过校验后才授权返回的 ID。按调用 ID 缓存 Promise，重复事件不会重复写入或提问。
 * 更新只转换显式 x/y，省略字段保持；更新和删除在整批目标预检后交给底层草稿事务。
 */
export function createBoardToolRunner({ snapshot, assertActive, read, authorize, ask, create, getShape, pageId, update, remove }: {
    snapshot?: RegionSnapshot
    assertActive: () => void
    read: (range: SnapshotRange, reference?: RegionSnapshot['reference']) => SnapshotToolSuccess
    authorize: (ids: readonly TLShapeId[]) => void
    ask: (question: string) => Promise<string>
    create: (inputs: readonly CreateDraftShapeInput[]) => readonly TLShape[]
    getShape: (id: TLShapeId) => TLShape | undefined
    pageId: string
    update: (inputs: readonly UpdateDraftShapeInput[]) => readonly TLShape[]
    remove: (ids: readonly TLShapeId[]) => readonly TLShapeId[]
}) {
    if (snapshot) validateChatSnapshot(snapshot)
    let reference = snapshot ? { ...snapshot.reference } : undefined
    const seenIds = new Set(snapshot?.shapes.map(shape => shape.id))
    const results = new Map<string, { name: string; arguments: string; output: Promise<BoardToolOutput> }>()

    // 先预检整个批次，避免后项越界时前项已写入；底层还会检查绑定副作用并回滚。
    const checkTargets = (ids: readonly string[]) => {
        for (const id of ids) {
            const target = getShape(id as TLShapeId)
            if (!seenIds.has(id as TLShapeId) || !target || target.id !== id || target.type !== 'geo'
                || !(CREATE_GEOS as readonly string[]).includes(target.props.geo)
                || target.parentId !== pageId || target.rotation !== 0 || target.isLocked) {
                throw new Error('目标须为已读取、未锁定、无旋转的页面直属基础几何')
            }
        }
    }

    return async (value: unknown): Promise<BoardToolOutput> => {
        assertActive()
        const call = validateBoardToolCall(value)
        const previous = results.get(call.id)
        if (previous) {
            if (previous.name !== call.function.name || previous.arguments !== call.function.arguments) {
                throw new Error('同一工具调用 ID 的名称或参数发生变化')
            }
            return previous.output
        }

        const output = (async (): Promise<BoardToolOutput> => {
            let invoked = false
            try {
                if (call.function.name === 'get_board_snapshot') {
                    const { range } = parseSnapshotInput(call.function.arguments)
                    invoked = true
                    const result = validateBoardToolOutput(read(range, reference))
                    if (!result.ok || !('snapshot' in result) || result.range !== range) throw new Error('读取结果不匹配')
                    const point = result.snapshot.reference
                    if (reference && (point.id !== reference.id || point.x !== reference.x || point.y !== reference.y)) {
                        throw new Error('任务参照点发生变化')
                    }
                    assertActive()
                    reference ??= { ...point }
                    authorize(result.snapshot.shapes.map(shape => shape.id))
                    result.snapshot.shapes.forEach(shape => seenIds.add(shape.id))
                    return result
                }
                if (call.function.name === 'ask_user') {
                    const { question } = parseAskInput(call.function.arguments)
                    invoked = true
                    const answer = await ask(question)
                    assertActive()
                    return validateBoardToolOutput({ ok: true, answer })
                }

                if (call.function.name === 'delete_shapes') {
                    const { ids } = parseDeleteInput(call.function.arguments)
                    checkTargets(ids)
                    assertActive()
                    invoked = true
                    const removed = remove(ids as TLShapeId[])
                    if (removed.length !== ids.length || removed.some((id, index) => id !== ids[index])) throw new Error('删除结果不匹配')
                    return validateBoardToolOutput({ ok: true, state: 'draft', operation: 'delete', ids: removed })
                }
                if (call.function.name === 'update_shapes') {
                    const { shapes: patches } = parseUpdateInput(call.function.arguments)
                    const point = reference
                    if (!point) throw new Error('更新前须取得快照参照点')
                    checkTargets(patches.map(patch => patch.id))
                    const inputs = patches.map(({ id, x, y, ...props }) => ({
                        id: id as TLShapeId,
                        ...(x !== undefined ? { x: point.x + x } : {}),
                        ...(y !== undefined ? { y: point.y + y } : {}),
                        ...(Object.keys(props).length ? { props } : {}),
                    }))
                    assertActive()
                    invoked = true
                    const updated = update(inputs)
                    if (updated.length !== patches.length) throw new Error('更新数量不匹配')
                    const shapes = patches.map((patch, index) => {
                        const actual = updated[index]
                        const input = inputs[index]
                        if (actual.id !== patch.id || actual.type !== 'geo'
                            || input.x !== undefined && actual.x !== input.x
                            || input.y !== undefined && actual.y !== input.y
                            || Object.entries(input.props ?? {}).some(([key, value]) => actual.props[key as keyof typeof actual.props] !== value)) {
                            throw new Error('更新结果与请求不一致')
                        }
                        // 仅回报实际核对过的字段；省略字段不受本次工具参数限制。
                        return { ...patch }
                    })
                    return validateBoardToolOutput({ ok: true, state: 'draft', operation: 'update', shapes })
                }

                const input = parseCreateInput(call.function.arguments)
                const point = reference
                if (!point) throw new Error('首次新增前须取得快照参照点')
                invoked = true
                const shapes = create(input.shapes.map(shape => ({
                    type: 'geo', x: point.x + shape.x, y: point.y + shape.y,
                    props: { geo: shape.geo, w: shape.w, h: shape.h, color: shape.color },
                })))
                return validateBoardToolOutput({
                    ok: true, state: 'draft',
                    shapes: shapes.map((shape, index) => {
                        if (shape.type !== 'geo') throw new Error('新增结果类型与工具不一致')
                        return {
                            id: shape.id, type: 'geo', geo: shape.props.geo,
                            // 底层核对绝对位置，保留原输入相对值避免浮点加减抵消误差。
                            x: input.shapes[index].x, y: input.shapes[index].y,
                            w: shape.props.w, h: shape.props.h, color: shape.props.color,
                        } as CreatedToolShape
                    }),
                })
            } catch (cause) {
                return {
                    ok: false,
                    error: !invoked && cause instanceof BoardProtocolError ? cause.detail
                        : { code: ERROR_CODES.EXECUTION_FAILED, message: '白板工具执行失败，本轮不自动重放操作' },
                }
            }
        })()
        results.set(call.id, { name: call.function.name, arguments: call.function.arguments, output })
        return output
    }
}
