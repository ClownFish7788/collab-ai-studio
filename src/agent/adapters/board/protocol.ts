import { boardSnapshotSchema } from '../../domain/observation'
import { ERROR_CODES } from '../../domain/error'
import { createToolInvocationSchemas, type ToolCall } from '../../domain/invocation'
import type { BoardToolName } from '../../domain/tool'
import type { BoardToolCall, BoardToolOutput } from '../transport/boardProtocol'
import type { RegionSnapshot } from './tldraw'
import { boardToolContracts } from "./contracts"

const invocations = createToolInvocationSchemas(boardToolContracts)

/** 保留完整白板上下文，并在适配入口丢弃原生对象/传输附带的非契约字段。 */
export function toAgentSnapshot(snapshot: RegionSnapshot) {
    const { id, x, y } = snapshot.reference
    // reference 是页面绝对坐标；shape/viewport 已是相对坐标，这里只投影字段，不能再减一次参照点。
    return boardSnapshotSchema.parse({ reference: { id, x, y },
        ...(snapshot.viewport ? { viewport: { x: snapshot.viewport.x, y: snapshot.viewport.y, w: snapshot.viewport.w, h: snapshot.viewport.h } } : {}),
        shapes: snapshot.shapes.map(shape => ({ id: shape.id, type: shape.type, x: shape.x, y: shape.y, w: shape.w, h: shape.h,
            text: shape.text, opacity: shape.opacity, props: shape.props, color: shape.color, labelColor: shape.labelColor,
            fill: shape.fill, geo: shape.geo, assetId: shape.assetId, url: shape.url,
            // x/y 是页面外接框左上角；origin 是原生元素原点，箭头和路径不能用前者替代后者。
            ...(shape.origin ? { origin: { x: shape.origin.x, y: shape.origin.y } } : {}),
        })),
    })
}

export function toBoardToolCall(call: { id: string; name: BoardToolName; input: unknown }, input: unknown = call.input): BoardToolCall {
    // 执行时传 PreparedTool.input，已移除 objectKey/role 等需求元数据；call.id 始终用于关联真实结果。
    return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(input) } }
}

/** 原生快照/Box 只提取可移植字段；仍按具体工具的 Zod 契约验证，不能用映射掩盖错误结果。 */
export function toAgentToolOutput(name: BoardToolName, output: BoardToolOutput) {
    let value: unknown = output
    if (output.ok && 'snapshot' in output && output.snapshot) {
        value = { ...output, snapshot: toAgentSnapshot(output.snapshot) }
    } else if (output.ok && 'image' in output) {
        const { id, x, y } = output.reference
        const { x: bx, y: by, w, h } = output.bounds
        // 截图 bounds 相对同一 reference；只做字段投影，不重新平移，也不从图片推导授权 ID。
        value = { ...output, reference: { id, x, y }, bounds: { x: bx, y: by, w, h } }
    }
    return boardToolContracts[name].outputSchema.parse(value)
}

/** known 表示拿到可信结果，output.ok 才表示成功；执行失败的写入不能推断已回滚。 */
export function toAgentToolResult(call: ToolCall, output: BoardToolOutput) {
    const writeFailed = boardToolContracts[call.name].kind === 'write' && !output.ok && output.error.code === ERROR_CODES.EXECUTION_FAILED
    return invocations.toolResultSchema.parse(writeFailed
        ? { callId: call.id, name: call.name, state: 'unknown', error: output.error }
        : { callId: call.id, name: call.name, state: 'known', output: toAgentToolOutput(call.name, output) })
}

