import { z } from 'zod'
import { jsonValueSchema, type JsonValue } from './data'
import { boardToolNameSchema } from './tool'
import { toolCallIdSchema, toolCallProposalSchema, type ToolResult } from './invocation'

const sourceSchema = z.enum(['system', 'user', 'assistant', 'tool'])
/** 内容来源独立于供应商的 role；工具图片被编码成其他 role 时也不能变成用户指令。 */
export const contentBlockSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('text'), source: sourceSchema, text: z.string().min(1).regex(/\S/) }),
    z.strictObject({ type: z.literal('image'), source: sourceSchema, url: z.string().min(1) }),
    z.strictObject({ type: z.literal('data'), source: sourceSchema, data: jsonValueSchema }),
])
export type ContentBlock = z.infer<typeof contentBlockSchema>

const callsSchema = z.array(toolCallProposalSchema).min(1).refine(calls => new Set(calls.map(call => call.id)).size === calls.length, '工具调用 ID 不能重复')
export const toolResultMessageSchema = z.strictObject({
    role: z.literal('tool'), callId: toolCallIdSchema, name: boardToolNameSchema,
    state: z.enum(['known', 'not_executed', 'unknown']), ok: z.boolean().optional(), content: z.array(contentBlockSchema).min(1),
}).superRefine((message, ctx) => {
    if (message.state === 'known' ? message.ok === undefined : message.ok !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['ok'], message: '已确认结果须说明成功或失败，未执行或不确定结果不能声明成败' })
    }
    message.content.forEach((block, index) => {
        if (block.source !== 'tool' && !(message.name === 'ask_user' && message.state === 'known' && message.ok === true && block.source === 'user')) {
            ctx.addIssue({ code: 'custom', path: ['content', index, 'source'], message: '工具结果内容来源不合法' })
        }
    })
})
export type ToolResultMessage = z.infer<typeof toolResultMessageSchema>

export const agentMessageSchema = z.discriminatedUnion('role', [
    z.strictObject({ role: z.literal('system'), content: z.array(contentBlockSchema).min(1) }),
    z.strictObject({ role: z.literal('user'), content: z.array(contentBlockSchema).min(1) }),
    z.strictObject({ role: z.literal('assistant'), content: z.array(contentBlockSchema), calls: callsSchema.optional() })
        .refine(message => message.content.length > 0 || !!message.calls?.length, '助手消息必须有内容或工具调用'),
    toolResultMessageSchema,
]).superRefine((message, ctx) => {
    if (message.role === 'tool') return
    message.content.forEach((block, index) => {
        if (block.source !== message.role) ctx.addIssue({ code: 'custom', path: ['content', index, 'source'], message: '消息角色与内容来源不一致' })
    })
})
export type AgentMessage = z.infer<typeof agentMessageSchema>

/** 保留等待中的调用；新一轮助手消息必须在前一批全部结果到齐后才能出现。 */
export const agentConversationSchema = z.array(agentMessageSchema).superRefine((messages, ctx) => {
    const pending = new Map<string, string>(), used = new Set<string>()
    messages.forEach((message, index) => {
        if (message.role === 'assistant') {
            if (pending.size) ctx.addIssue({ code: 'custom', path: [index], message: '尚有工具调用未返回，不能继续助手轮次' })
            message.calls?.forEach((call, callIndex) => {
                if (used.has(call.id)) ctx.addIssue({ code: 'custom', path: [index, 'calls', callIndex, 'id'], message: '工具调用 ID 不能复用' })
                used.add(call.id)
                pending.set(call.id, call.name)
            })
        } else if (message.role === 'tool') {
            if (pending.get(message.callId) !== message.name) ctx.addIssue({ code: 'custom', path: [index, 'callId'], message: '工具消息必须对应尚未返回的同名调用' })
            pending.delete(message.callId)
        }
    })
})

/** 完整模型决策，不包含流式分片、choices 或供应商 finish_reason。 */
export const modelDecisionSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(8000).regex(/\S/) }),
    z.strictObject({ kind: z.literal('tool'), calls: callsSchema, content: z.string().max(8000).optional() }),
])
export type ModelDecision = z.infer<typeof modelDecisionSchema>

/** 规范化 schema 允许省略的 undefined 字段；数组及非法值仍交给 JSON schema 拒绝。 */
function messageData(value: unknown): JsonValue {
    const omitUndefined = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(omitUndefined)
        if (item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
            return Object.fromEntries(Object.entries(item).filter(([, field]) => field !== undefined).map(([key, field]) => [key, omitUndefined(field)]))
        }
        return item
    }
    return jsonValueSchema.parse(omitUndefined(value))
}

/** 将已核对的执行事实构造成规范消息；不裁剪上下文，也不编码供应商协议。 */
export function createToolResultMessage(result: ToolResult): ToolResultMessage {
    const content: ContentBlock[] = []
    if (result.state !== 'known') {
        content.push({ type: 'data', source: 'tool', data: messageData({ error: result.error }) })
    } else if (result.output.ok && result.name === 'get_board_screenshot') {
        const { image, ...metadata } = result.output
        content.push({ type: 'data', source: 'tool', data: messageData(metadata) }, { type: 'image', source: 'tool', url: image })
    } else if (result.output.ok && result.name === 'ask_user') {
        const { answer, snapshot } = result.output
        if (answer.text?.trim()) content.push({ type: 'text', source: 'user', text: answer.text })
        answer.images?.forEach(url => content.push({ type: 'image', source: 'user', url }))
        if (answer.selectedShapeIds?.length) content.push({ type: 'data', source: 'user', data: { selectedShapeIds: answer.selectedShapeIds } })
        if (snapshot) content.push({ type: 'data', source: 'tool', data: messageData({ snapshot }) })
    } else {
        content.push({ type: 'data', source: 'tool', data: messageData(result.output) })
    }
    return toolResultMessageSchema.parse({ role: 'tool', callId: result.callId, name: result.name, state: result.state,
        ...(result.state === 'known' ? { ok: result.output.ok } : {}), content })
}
