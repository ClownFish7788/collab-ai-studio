import { z } from 'zod'
import { agentConversationSchema } from './message'
import { taskBriefSchema } from './task'
import { boardSnapshotSchema, boardReferenceSchema, observedShapeIdSchema, resolveBoardReference, shapeTypeSchema, type BoardSnapshot } from './observation'
import type { createToolInvocationSchemas, ToolResult } from './invocation'

const observedStateSchema = z.strictObject({
    reference: boardReferenceSchema.optional(), observedTypes: z.map(observedShapeIdSchema, shapeTypeSchema),
})

/** 只从本任务明确附件及实际成功结果累计事实；消息正文和截图均不能授权元素 ID。 */
export function getObservedContextState(context: { initialSnapshot?: BoardSnapshot; toolResults: readonly ToolResult[] }) {
    let reference = context.initialSnapshot?.reference
    const observedTypes = new Map(context.initialSnapshot?.shapes.map(shape => [shape.id, shape.type]))
    for (const result of context.toolResults) {
        if (result.state !== 'known' || !result.output.ok) continue
        if (result.name === 'get_board_snapshot' || result.name === 'ask_user') {
            const snapshot = result.output.snapshot
            if (snapshot) {
                reference = resolveBoardReference(reference, snapshot.reference)
                snapshot.shapes.forEach(shape => observedTypes.set(shape.id, shape.type))
            }
        } else if (result.name === 'get_board_screenshot') {
            reference = resolveBoardReference(reference, result.output.reference)
        } else if (result.name === 'create_shapes') {
            result.output.shapes.forEach(shape => observedTypes.set(shape.id, shape.type))
        } else if (result.name === 'delete_shapes') {
            result.output.ids.forEach(id => observedTypes.delete(id))
        }
    }
    return observedStateSchema.parse({ reference, observedTypes })
}

/** 普通任务数据与结果关联；不含 AbortSignal、权限函数、预算计时器或全局等待表。 */
export function createAgentContextSchema(invocations: ReturnType<typeof createToolInvocationSchemas>) {
    return z.strictObject({
        runId: z.string().regex(/^[\w-]{1,100}$/),
        messages: agentConversationSchema,
        task: taskBriefSchema.optional(),
        initialSnapshot: boardSnapshotSchema.optional(),
        toolResults: z.array(invocations.toolResultSchema),
    }).superRefine((context, ctx) => {
        const calls = new Map(context.messages.flatMap(message => message.role === 'assistant' ? message.calls ?? [] : []).map(call => [call.id, call]))
        const received = new Set<string>()
        context.toolResults.forEach((result, index) => {
            if (received.has(result.callId)) ctx.addIssue({ code: 'custom', path: ['toolResults', index, 'callId'], message: '同一调用不能存放多个执行结果' })
            received.add(result.callId)
            try { invocations.validateToolResult(calls.get(result.callId), result) }
            catch { ctx.addIssue({ code: 'custom', path: ['toolResults', index], message: '上下文结果与已记录调用不匹配' }) }
        })
        try { getObservedContextState(context) }
        catch { ctx.addIssue({ code: 'custom', path: ['toolResults'], message: '任务参照点发生变化' }) }
        context.messages.forEach((message, index) => {
            if (message.role !== 'tool') return
            const result = context.toolResults.find(result => result.callId === message.callId)
            if (!result || result.name !== message.name || result.state !== message.state || result.state === 'known' && result.output.ok !== message.ok) {
                ctx.addIssue({ code: 'custom', path: ['messages', index], message: '工具消息必须有对应的真实执行结果' })
            }
        })
    })
}
export type AgentContext = z.infer<ReturnType<typeof createAgentContextSchema>>
