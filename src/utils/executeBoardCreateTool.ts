import type { TLShape } from 'tldraw'
import type { CreateDraftShapeInput } from './draftShapeOperations'
import {
    validateCreateCall,
    parseCreateInput,
    BoardProtocolError,
    ERROR_CODES,
    type CreateToolOutput,
    type CreatedToolShape,
} from './boardCreateProtocol'

/**
 * 创建绑定到单个任务的前端执行器。
 * 输入：固定参照点、任务有效性检查、已有草稿新增函数；输出：接收完整 tool_call 的同步函数。
 * ID 和草稿由程序持有；坐标只还原一次；重复调用返回缓存，失败也不会被自动重放。
 */
export function createBoardToolRunner({ reference, assertActive, create }: {
    reference: { x: number; y: number }
    assertActive: () => void
    create: (inputs: readonly CreateDraftShapeInput[]) => readonly TLShape[]
}) {
    const results = new Map<string, { arguments: string; output: CreateToolOutput }>()

    return (value: unknown): CreateToolOutput => {
        assertActive()
        const call = validateCreateCall(value)
        const previous = results.get(call.id)

        if (previous) {
            if (previous.arguments !== call.function.arguments) {
                throw new Error('同一工具调用 ID 的参数发生变化')
            }

            return previous.output
        }

        let output: CreateToolOutput

        try {
            const input = parseCreateInput(call.function.arguments)
            const shapes = create(input.shapes.map(shape => ({
                type: 'geo',
                x: reference.x + shape.x,
                y: reference.y + shape.y,
                props: { geo: shape.geo, w: shape.w, h: shape.h, color: shape.color },
            })))

            output = {
                ok: true,
                state: 'draft',
                shapes: shapes.map((shape, index) => {
                    if (shape.type !== 'geo') {
                        throw new Error('新增结果类型与工具不一致')
                    }

                    return {
                        id: shape.id,
                        type: 'geo',
                        geo: shape.props.geo,
                        // 底层已经核对绝对位置；沿用输入相对值，避免加减抵消产生越界浮点误差。
                        x: input.shapes[index].x,
                        y: input.shapes[index].y,
                        w: shape.props.w,
                        h: shape.props.h,
                        color: shape.props.color,
                    } as CreatedToolShape
                }),
            }
        } catch (cause) {
            output = {
                ok: false,
                error: cause instanceof BoardProtocolError ? cause.detail
                    : { code: ERROR_CODES.EXECUTION_FAILED, message: '草稿新增执行失败，本轮不自动重放操作' },
            }
        }

        results.set(call.id, { arguments: call.function.arguments, output })
        return output
    }
}
