import { z } from 'zod'
import { jsonValueSchema, jsonValuesEqual } from './data'
import { agentErrorSchema } from './error'
import { answersMatchQuestions, boardToolNameSchema, type BoardToolContracts, type BoardToolName } from './tool'

export const toolCallIdSchema = z.string().min(1).max(200).regex(/\S/)
export const toolCallReferenceSchema = z.strictObject({ id: toolCallIdSchema, name: boardToolNameSchema })
/** 提议先经具体工具 inputSchema 成为结构有效的调用；任务范围、原生约束和权限仍须执行前复核。 */
export const toolCallProposalSchema = toolCallReferenceSchema.extend({ input: jsonValueSchema })
export type ToolCallProposal = z.infer<typeof toolCallProposalSchema>

function invocation<Name extends BoardToolName, Input extends z.ZodType, Output extends z.ZodType>(
    name: Name, contract: { inputSchema: Input; outputSchema: Output },
) {
    const identity = { callId: toolCallIdSchema, name: z.literal(name) }
    return {
        call: z.strictObject({ id: toolCallIdSchema, name: z.literal(name), input: contract.inputSchema }),
        result: z.discriminatedUnion('state', [
            z.strictObject({ ...identity, state: z.literal('known'), output: contract.outputSchema }),
            z.strictObject({ ...identity, state: z.literal('not_executed'), error: agentErrorSchema }),
            z.strictObject({ ...identity, state: z.literal('unknown'), error: agentErrorSchema }),
        ]),
    }
}

/** 工具名作为判别字段，将每个工具的输入、输出类型绑定；执行不确定时禁止附带成功结果。 */
export function createToolInvocationSchemas<T extends string>(tools: BoardToolContracts<T>) {
    const definitions = {
        create_shapes: invocation('create_shapes', tools.create_shapes),
        update_shapes: invocation('update_shapes', tools.update_shapes),
        delete_shapes: invocation('delete_shapes', tools.delete_shapes),
        get_board_snapshot: invocation('get_board_snapshot', tools.get_board_snapshot),
        get_board_screenshot: invocation('get_board_screenshot', tools.get_board_screenshot),
        ask_user: invocation('ask_user', tools.ask_user),
    }
    const toolCallSchema = z.discriminatedUnion('name', [definitions.create_shapes.call, definitions.update_shapes.call,
        definitions.delete_shapes.call, definitions.get_board_snapshot.call, definitions.get_board_screenshot.call, definitions.ask_user.call])
    const toolResultSchema = z.discriminatedUnion('name', [definitions.create_shapes.result, definitions.update_shapes.result,
        definitions.delete_shapes.result, definitions.get_board_snapshot.result, definitions.get_board_screenshot.result, definitions.ask_user.result])
    const mutationResultSchema = z.discriminatedUnion('name', [
        z.strictObject({ callId: toolCallIdSchema, name: z.literal('create_shapes'), output: tools.create_shapes.outputSchema.options[0] }),
        z.strictObject({ callId: toolCallIdSchema, name: z.literal('update_shapes'), output: tools.update_shapes.outputSchema.options[0] }),
        z.strictObject({ callId: toolCallIdSchema, name: z.literal('delete_shapes'), output: tools.delete_shapes.outputSchema.options[0] }),
    ])

    /** 不依赖 JSON 字符串格式，核对实际结果与本次请求；无效提议仍可收到关联的拒绝结果。 */
    function validateToolResult(callValue: unknown, resultValue: unknown) {
        const proposal = toolCallProposalSchema.parse(callValue)
        const result = toolResultSchema.parse(resultValue)
        const invalid = (): never => { throw new z.ZodError([{ code: 'custom', path: ['output'], message: '工具结果与当前调用不匹配' }]) }
        if (result.callId !== proposal.id || result.name !== proposal.name) return invalid()
        if (result.state !== 'known' || !result.output.ok) return result
        const call = toolCallSchema.parse(proposal)
        const input = call.input
        let matches: boolean
        switch (result.name) {
            case 'get_board_snapshot':
            case 'get_board_screenshot':
                matches = 'range' in input && result.output.range === input.range
                break
            case 'ask_user':
                matches = 'questions' in input && answersMatchQuestions(input.questions, result.output.answers)
                break
            case 'create_shapes':
                matches = 'shapes' in input && result.output.shapes.length === input.shapes.length
                    && result.output.shapes.every((actual, index) => jsonValuesEqual(
                        Object.fromEntries(Object.entries(actual).filter(([key]) => key !== 'id')),
                        Object.fromEntries(Object.entries(input.shapes[index]).filter(([key]) => key !== 'objectKey' && key !== 'role')),
                    ))
                break
            case 'update_shapes':
                matches = 'changes' in input && result.output.shapes.length === input.changes.length
                    && result.output.shapes.every((actual, index) => {
                        const change = input.changes[index]
                        const requested = Object.fromEntries(Object.entries(change).filter(([key]) => !['objectKey', 'role', 'shapeId'].includes(key)))
                        return jsonValuesEqual(Object.fromEntries(Object.entries(actual).filter(([key]) => key !== 'type')), { id: change.shapeId, ...requested })
                    })
                break
            case 'delete_shapes':
                matches = 'targets' in input && jsonValuesEqual(result.output.ids, input.targets.map(target => target.shapeId))
        }
        if (!matches) return invalid()
        return result
    }

    return { toolCallSchema, toolResultSchema, mutationResultSchema, validateToolResult }
}

export type ToolCall = z.infer<ReturnType<typeof createToolInvocationSchemas>['toolCallSchema']>
export type ToolResult = z.infer<ReturnType<typeof createToolInvocationSchemas>['toolResultSchema']>
export type MutationResult = z.infer<ReturnType<typeof createToolInvocationSchemas>['mutationResultSchema']>
