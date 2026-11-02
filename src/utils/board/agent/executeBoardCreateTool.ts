import type { TLShape, TLShapeId } from 'tldraw'
import { isEqual } from '@tldraw/utils'
import { DRAFT_SHAPE_TYPES } from '../draft/draftShapeSchema'
import type { CreateDraftShapeInput, UpdateDraftShapeInput } from '../draft/draftShapeOperations'
import type { RegionSnapshot } from '../snapshot/collectRegionSnapshot'
import { validateChatSnapshot } from '../snapshot/chatSnapshots'
import {
    validateBoardToolCall, validateBoardToolOutput, parseCreateInput, parseSnapshotInput, parseAskInput, parseUpdateInput, parseDeleteInput,
    BoardProtocolError, ERROR_CODES, validateBoardAnswer,
    type BoardToolOutput, type SnapshotRange, type SnapshotToolSuccess, type ScreenshotToolSuccess, type BoardAnswer,
} from './boardCreateProtocol'

/**
 * 创建单任务浏览器执行器：接收明确附件、草稿读写和真实用户询问回调，输出异步工具执行函数。
 * 首份快照固定参照点；读取通过校验后才授权返回的 ID。按调用 ID 缓存 Promise，重复事件不会重复写入或提问。
 * 更新只转换显式 x/y，省略字段保持；更新和删除在整批目标预检后交给底层草稿事务。
 */
export function createBoardToolRunner({ snapshot, assertActive, read, readSelection, screenshot, onReadRetry, authorize, ask, create, getShape, pageId, update, remove }: {
    snapshot?: RegionSnapshot
    assertActive: () => void
    read: (range: SnapshotRange, reference?: RegionSnapshot['reference']) => SnapshotToolSuccess
    screenshot: (range: SnapshotRange, reference: RegionSnapshot['reference']) => Promise<ScreenshotToolSuccess>
    readSelection: (ids: readonly TLShapeId[], reference?: RegionSnapshot['reference']) => Promise<SnapshotToolSuccess>
    onReadRetry?: (callId: string, attempt: number) => void
    authorize: (ids: readonly TLShapeId[]) => void
    ask: (question: string) => Promise<BoardAnswer>
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
            if (!seenIds.has(id as TLShapeId) || !target || target.id !== id || !DRAFT_SHAPE_TYPES.includes(target.type)
                || target.parentId !== pageId || target.rotation !== 0 || target.isLocked) {
                throw new Error('目标须为已读取、未锁定、无旋转的页面直属元素')
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
                if (call.function.name === 'get_board_snapshot' || call.function.name === 'get_board_screenshot') {
                    const { range } = parseSnapshotInput(call.function.arguments)
                    invoked = true
                    let value
                    for (let attempt = 0; attempt < 3; attempt++) {
                        assertActive()
                        try {
                            const context = read(range, reference)
                            reference ??= { ...context.snapshot.reference }
                            value = call.function.name === 'get_board_snapshot' ? context : await screenshot(range, reference)
                            break
                        }
                        catch (cause) {
                            assertActive()
                            if (cause instanceof BoardProtocolError && cause.detail.code === ERROR_CODES.INVALID_ARGUMENTS || attempt === 2) throw cause
                            onReadRetry?.(call.id, attempt + 1)
                        }
                    }
                    const result = validateBoardToolOutput(value)
                    if (!result.ok || 'answer' in result || !('snapshot' in result || 'image' in result) || result.range !== range) throw new Error('读取结果不匹配')
                    const point = 'snapshot' in result ? result.snapshot.reference : result.reference
                    if (reference && (point.id !== reference.id || point.x !== reference.x || point.y !== reference.y)) {
                        throw new Error('任务参照点发生变化')
                    }
                    assertActive()
                    reference ??= { ...point }
                    if ('snapshot' in result) {
                        authorize(result.snapshot.shapes.map(shape => shape.id))
                        result.snapshot.shapes.forEach(shape => seenIds.add(shape.id))
                    }
                    return result
                }
                if (call.function.name === 'ask_user') {
                    const { question } = parseAskInput(call.function.arguments)
                    invoked = true
                    const answer = validateBoardAnswer(await ask(question))
                    assertActive()
                    if (!answer.selectedShapeIds?.length) return validateBoardToolOutput({ ok: true, answer })
                    const context = await readSelection(answer.selectedShapeIds as TLShapeId[], reference)
                    const result = validateBoardToolOutput({ ok: true, answer, snapshot: context.snapshot })
                    const point = context.snapshot.reference
                    if (reference && (point.id !== reference.id || point.x !== reference.x || point.y !== reference.y)) throw new Error('回答参照点发生变化')
                    reference ??= { ...point }
                    assertActive()
                    authorize(context.snapshot.shapes.map(shape => shape.id))
                    context.snapshot.shapes.forEach(shape => seenIds.add(shape.id))
                    return result
                }

                if (call.function.name === 'delete_shapes') {
                    const { ids } = parseDeleteInput(call.function.arguments)
                    checkTargets(ids)
                    assertActive()
                    invoked = true
                    const removed = remove(ids as TLShapeId[])
                    if (removed.length !== ids.length || removed.some((id, index) => id !== ids[index])) throw new Error('删除结果不匹配')
                    removed.forEach(id => seenIds.delete(id))
                    return validateBoardToolOutput({ ok: true, state: 'draft', operation: 'delete', ids: removed })
                }
                if (call.function.name === 'update_shapes') {
                    const { shapes: patches } = parseUpdateInput(call.function.arguments)
                    const point = reference
                    if (!point) throw new Error('更新前须取得快照参照点')
                    checkTargets(patches.map(patch => patch.id))
                    const inputs = patches.map(({ id, type, x, y, props }) => {
                        if (getShape(id as TLShapeId)?.type !== type) throw new Error('更新不能改变元素类型')
                        return {
                            id: id as TLShapeId,
                            ...(x !== undefined ? { x: point.x + x } : {}),
                            ...(y !== undefined ? { y: point.y + y } : {}),
                            ...(props !== undefined ? { props } : {}),
                        }
                    })
                    assertActive()
                    invoked = true
                    const updated = update(inputs)
                    if (updated.length !== patches.length) throw new Error('更新数量不匹配')
                    const shapes = patches.map((patch, index) => {
                        const actual = updated[index]
                        const input = inputs[index]
                        if (actual.id !== patch.id || actual.type !== patch.type
                            || input.x !== undefined && actual.x !== input.x
                            || input.y !== undefined && actual.y !== input.y
                            || Object.entries(input.props ?? {}).some(([key, value]) => !isEqual((actual.props as Record<string, unknown>)[key], value))) {
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
                input.shapes.forEach(shape => { if (shape.children) checkTargets(shape.children) })
                assertActive()
                invoked = true
                const inputs = input.shapes.map(shape => ({ ...shape, x: point.x + shape.x, y: point.y + shape.y } as CreateDraftShapeInput))
                const shapes = create(inputs)
                if (shapes.length !== inputs.length) throw new Error('新增数量不匹配')
                const result = validateBoardToolOutput({
                    ok: true, state: 'draft',
                    shapes: shapes.map((shape, index) => {
                        const requested = inputs[index]
                        if (shape.type !== requested.type || shape.x !== requested.x || shape.y !== requested.y
                            || Object.entries(requested.props ?? {}).some(([key, value]) => !isEqual((shape.props as Record<string, unknown>)[key], value))) {
                            throw new Error('新增结果与请求不一致')
                        }
                        // 只回报已核对的输入字段，不把原生派生属性当作可写参数。
                        return { ...input.shapes[index], id: shape.id }
                    }),
                })
                if (result.ok && 'shapes' in result) result.shapes.forEach(shape => seenIds.add(shape.id as TLShapeId))
                return result
            } catch (cause) {
                return {
                    ok: false,
                    error: !invoked && cause instanceof BoardProtocolError ? cause.detail
                        : { code: ERROR_CODES.EXECUTION_FAILED, message: call.function.name === 'get_board_snapshot' || call.function.name === 'get_board_screenshot'
                            ? '白板读取失败，有限重试后仍未获得有效结果' : '白板工具执行失败，本轮不自动重放操作' },
                }
            }
        })()
        results.set(call.id, { name: call.function.name, arguments: call.function.arguments, output })
        return output
    }
}
