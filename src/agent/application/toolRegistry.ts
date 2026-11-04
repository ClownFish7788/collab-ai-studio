import { z } from 'zod'
import { getObservedContextState, type AgentContext } from '../domain/context'
import { jsonObjectSchema, type JsonValue } from '../domain/data'
import { assertElementTargets, prepareElementRows } from '../domain/elements'
import { agentErrorSchema, ERROR_CODES, type ValidationIssue } from '../domain/error'
import { createToolInvocationSchemas, type ToolCall, type ToolCallProposal } from '../domain/invocation'
import type { BoardToolContracts } from '../domain/tool'
import { AgentApplicationError, MAX_BOARD_ELEMENT_TABLE_CHARS, validationFailure, type PreparedTool, type ToolExecutorPort, type ToolValidationPort, type ValidationResult } from './ports'

/** 六工具共享真实执行通道；注册项仍各自绑定领域契约和参数准备，避免按工具名维护另一套 schema。 */
export function createToolRegistry(tools: BoardToolContracts, execute: ToolExecutorPort, validate: ToolValidationPort) {
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
        prepare(proposal: ToolCallProposal, context: AgentContext): ValidationResult {
            const parsed = invocations.toolCallSchema.safeParse(proposal)
            if (!parsed.success) return { ok: false, error: validationFailure(parsed.error, ERROR_CODES.INVALID_ARGUMENTS, '工具参数结构校验失败').detail }
            const call = parsed.data
            const { observedTypes } = getObservedContextState(context)
            let preparation: ValidationResult
            try {
                preparation = { ok: true, prepared: registry[call.name].prepare(call, context) }
            } catch (cause) {
                if (cause instanceof z.ZodError) preparation = { ok: false, error: validationFailure(cause, ERROR_CODES.INVALID_ARGUMENTS, '工具参数或元素对应关系校验失败').detail }
                else if (cause instanceof AgentApplicationError && cause.detail.code === ERROR_CODES.INVALID_ARGUMENTS) preparation = { ok: false, error: cause.detail }
                else throw cause
            }
            const issues: ValidationIssue[] = preparation.ok ? [] : [...(preparation.error.issues ?? [{ path: 'input', message: preparation.error.message }])]
            if (call.name === 'create_shapes') call.input.shapes.forEach((shape, index) => shape.children?.forEach((id, childIndex) => {
                if (!observedTypes.has(id)) issues.push({ path: `input.shapes[${index}].children[${childIndex}]`, message: '分组子对象须来自本任务实际读取或新增结果' })
            }))
            issues.push(...validate(call, observedTypes))
            if (!issues.length) return preparation
            const unique = new Map<string, ValidationIssue>()
            for (const issue of issues) {
                const diagnostic = { path: (issue.path === 'input' || issue.path.startsWith('input.') ? issue.path : `input.${issue.path}`).slice(0, 100),
                    message: issue.message.slice(0, 200) }
                unique.set(JSON.stringify(diagnostic), diagnostic)
            }
            return { ok: false, error: agentErrorSchema.parse({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '工具参数校验失败', issues: [...unique.values()].slice(0, 40) }) }
        },
    }
}
