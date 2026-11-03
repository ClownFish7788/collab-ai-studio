import { z } from 'zod'
import { getObservedContextState, type AgentContext } from '../domain/context'
import { jsonObjectSchema, type JsonValue } from '../domain/data'
import { assertElementTargets, prepareElementRows } from '../domain/elements'
import { ERROR_CODES } from '../domain/error'
import { createToolInvocationSchemas, type ToolCall, type ToolCallProposal } from '../domain/invocation'
import type { BoardToolContracts } from '../domain/tool'
import { AgentApplicationError, MAX_BOARD_ELEMENT_TABLE_CHARS, validationFailure, type PreparedTool, type ToolExecutorPort } from './ports'

/** 六工具共享真实执行通道；注册项仍各自绑定领域契约和参数准备，避免按工具名维护另一套 schema。 */
export function createToolRegistry(tools: BoardToolContracts, execute: ToolExecutorPort) {
    const invocations = createToolInvocationSchemas(tools)
    const identity = (call: ToolCall): JsonValue => jsonObjectSchema.parse(call.input)
    const mutation = (call: ToolCall, context: AgentContext): PreparedTool => {
        if (!context.task) throw new AgentApplicationError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '写入前必须整理任务' })
        const { observedTypes } = getObservedContextState(context)
        let input: JsonValue
        let elements
        let isFinal: boolean
        switch (call.name) {
            case 'create_shapes': {
                const intent = call.input
                elements = prepareElementRows(intent.shapes, intent.references ?? [], 'create', context.task, observedTypes)
                if (intent.shapes.some(shape => shape.children?.some(id => !observedTypes.has(id)))) {
                    throw new AgentApplicationError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '分组子对象须来自本任务实际读取或新增结果' })
                }
                const shapes = intent.shapes.map(shape => ({ type: shape.type, x: shape.x, y: shape.y,
                    ...(shape.props !== undefined ? { props: shape.props } : {}), ...(shape.children !== undefined ? { children: shape.children } : {}),
                }))
                assertElementTargets(elements, 'create', shapes)
                input = jsonObjectSchema.parse({ shapes }); isFinal = intent.isFinal
                break
            }
            case 'update_shapes': {
                const intent = call.input
                elements = prepareElementRows(intent.changes, intent.references ?? [], 'update', context.task, observedTypes)
                const shapes = intent.changes.map(change => ({ id: change.shapeId, type: observedTypes.get(change.shapeId),
                    ...(change.x !== undefined ? { x: change.x } : {}), ...(change.y !== undefined ? { y: change.y } : {}),
                    ...(change.props !== undefined ? { props: change.props } : {}),
                }))
                assertElementTargets(elements, 'update', shapes)
                input = jsonObjectSchema.parse({ shapes }); isFinal = intent.isFinal
                break
            }
            case 'delete_shapes': {
                const intent = call.input
                elements = prepareElementRows(intent.targets, intent.references ?? [], 'delete', context.task, observedTypes)
                const ids = intent.targets.map(target => target.shapeId)
                assertElementTargets(elements, 'delete', ids.map(id => ({ id })))
                input = { ids }; isFinal = intent.isFinal
                break
            }
            default: throw new AgentApplicationError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '当前调用不是写入操作' })
        }
        if (JSON.stringify(elements).length > MAX_BOARD_ELEMENT_TABLE_CHARS) {
            throw new AgentApplicationError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '元素表超过任务大小限制' })
        }
        return { call, input, elements, isFinal }
    }
    const observation = (call: ToolCall): PreparedTool => ({ call, input: identity(call), elements: [] })
    const registry = {
        create_shapes: { contract: tools.create_shapes, prepare: mutation, execute },
        update_shapes: { contract: tools.update_shapes, prepare: mutation, execute },
        delete_shapes: { contract: tools.delete_shapes, prepare: mutation, execute },
        get_board_snapshot: { contract: tools.get_board_snapshot, prepare: observation, execute },
        get_board_screenshot: { contract: tools.get_board_screenshot, prepare: observation, execute },
        ask_user: { contract: tools.ask_user, prepare: observation, execute },
    }
    return { registry, invocations,
        prepare(proposal: ToolCallProposal, context: AgentContext) {
            try {
                const call = invocations.toolCallSchema.parse(proposal)
                return registry[call.name].prepare(call, context)
            } catch (cause) {
                if (cause instanceof z.ZodError) throw validationFailure(cause, ERROR_CODES.INVALID_ARGUMENTS, '工具参数或元素对应关系校验失败')
                throw cause
            }
        },
    }
}
