import { z } from 'zod'
import { agentErrorSchema } from './error'
import { toolCallReferenceSchema, type createToolInvocationSchemas } from './invocation'

/** Agent 结束不等于正式白板已应用；changes 只保存已确认的草稿写入。 */
export function createAgentOutcomeSchema(mutationResultSchema: ReturnType<typeof createToolInvocationSchemas>['mutationResultSchema']) {
    return z.strictObject({
        status: z.enum(['completed', 'partial', 'failed', 'cancelled']),
        text: z.string().min(1).max(8000).regex(/\S/),
        changes: z.array(mutationResultSchema),
        uncertainCalls: z.array(toolCallReferenceSchema),
        error: agentErrorSchema.optional(),
    }).superRefine((outcome, ctx) => {
        if (outcome.status === 'completed' && (outcome.uncertainCalls.length || outcome.error)) {
            ctx.addIssue({ code: 'custom', path: ['status'], message: '存在未确认结果或错误时不能声明完成' })
        }
        if (outcome.status === 'partial' && !outcome.changes.length && !outcome.uncertainCalls.length) {
            ctx.addIssue({ code: 'custom', path: ['status'], message: '部分完成必须有已确认修改或待核实调用' })
        }
        if ((outcome.status === 'failed' || outcome.status === 'cancelled') && !outcome.error) {
            ctx.addIssue({ code: 'custom', path: ['error'], message: '失败或取消必须说明受控原因' })
        }
        const ids = new Set<string>()
        for (const [index, change] of outcome.changes.entries()) {
            if (ids.has(change.callId)) ctx.addIssue({ code: 'custom', path: ['changes', index, 'callId'], message: '成功修改的调用 ID 不能重复' })
            ids.add(change.callId)
        }
        for (const [index, call] of outcome.uncertainCalls.entries()) {
            if (ids.has(call.id)) ctx.addIssue({ code: 'custom', path: ['uncertainCalls', index, 'id'], message: '调用不能重复或同时属于已确认和未确认结果' })
            ids.add(call.id)
        }
    })
}
export type AgentOutcome = z.infer<ReturnType<typeof createAgentOutcomeSchema>>
