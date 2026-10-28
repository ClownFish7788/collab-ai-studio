import type { TLShape, TLShapeId } from 'tldraw'
import type { CreateDraftShapeInput } from './draftShapeOperations'
import type { RegionSnapshot } from './collectRegionSnapshot'
import { validateChatSnapshot } from './chatSnapshots'
import {
    validateBoardToolCall, validateBoardToolOutput, parseCreateInput, parseSnapshotInput, parseAskInput,
    BoardProtocolError, ERROR_CODES,
    type BoardToolOutput, type SnapshotRange, type SnapshotToolSuccess, type CreatedToolShape,
} from './boardCreateProtocol'

/**
 * 创建单任务浏览器执行器：接收明确附件、草稿读取/新增和真实用户询问回调，输出异步工具执行函数。
 * 首份快照固定参照点；读取通过校验后才授权返回的 ID。按调用 ID 缓存 Promise，重复事件不会重复写入或提问。
 */
export function createBoardToolRunner({ snapshot, assertActive, read, authorize, ask, create }: {
    snapshot?: RegionSnapshot
    assertActive: () => void
    read: (range: SnapshotRange, reference?: RegionSnapshot['reference']) => SnapshotToolSuccess
    authorize: (ids: readonly TLShapeId[]) => void
    ask: (question: string) => Promise<string>
    create: (inputs: readonly CreateDraftShapeInput[]) => readonly TLShape[]
}) {
    if (snapshot) validateChatSnapshot(snapshot)
    let reference = snapshot ? { ...snapshot.reference } : undefined
    const results = new Map<string, { name: string; arguments: string; output: Promise<BoardToolOutput> }>()

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
                    return result
                }
                if (call.function.name === 'ask_user') {
                    const { question } = parseAskInput(call.function.arguments)
                    invoked = true
                    const answer = await ask(question)
                    assertActive()
                    return validateBoardToolOutput({ ok: true, answer })
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
