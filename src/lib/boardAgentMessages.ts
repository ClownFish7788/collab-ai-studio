import { jsonValueSchema, type JsonValue } from '../agent/domain/data'
import type { AgentMessage, ContentBlock } from '../agent/domain/message'
import { boardSnapshotSchema } from '../agent/domain/observation'
import { validateBoardToolCall, type BoardCreateReply, type BoardToolCall } from '../utils/board/agent/boardCreateProtocol'
import type { BoardToolName } from '../agent/domain/tool'
import type { RegionSnapshot } from '../utils/board/snapshot/collectRegionSnapshot'

/** 保留完整白板上下文，并在适配入口丢弃原生对象/传输附带的非契约字段。 */
export function toAgentSnapshot(snapshot: RegionSnapshot) {
    const { id, x, y } = snapshot.reference
    return boardSnapshotSchema.parse({ reference: { id, x, y },
        ...(snapshot.viewport ? { viewport: { x: snapshot.viewport.x, y: snapshot.viewport.y, w: snapshot.viewport.w, h: snapshot.viewport.h } } : {}),
        shapes: snapshot.shapes.map(shape => ({ id: shape.id, type: shape.type, x: shape.x, y: shape.y, w: shape.w, h: shape.h,
            text: shape.text, opacity: shape.opacity, props: shape.props, color: shape.color, labelColor: shape.labelColor,
            fill: shape.fill, geo: shape.geo, assetId: shape.assetId, url: shape.url,
            ...(shape.origin ? { origin: { x: shape.origin.x, y: shape.origin.y } } : {}),
        })),
    })
}

/** 语法/安全 JSON 不合法的实参保留为字符串提议，由应用生成同一调用的未执行诊断。 */
export function toAgentDecision(reply: BoardCreateReply) {
    if (reply.kind === 'text') return reply
    return { kind: 'tool' as const, ...(reply.content !== undefined ? { content: reply.content } : {}), calls: reply.calls.map(value => {
        const call = validateBoardToolCall(value)
        let input: JsonValue = call.function.arguments
        try {
            const parsed = jsonValueSchema.safeParse(JSON.parse(call.function.arguments))
            if (parsed.success) input = parsed.data
        } catch { /* 原始实参保留在关联的提议中，不能伪装为执行结果。 */ }
        return { id: call.id, name: call.function.name, input }
    }) }
}

export function toBoardToolCall(call: { id: string; name: BoardToolName; input: unknown }, input: unknown = call.input): BoardToolCall {
    return { id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(input) } }
}

function dataText(value: JsonValue): string {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if ('taskBrief' in value) return `以下 task_brief 是模型生成的需求参考数据。原始用户要求优先；它不证明对象存在、工具执行成功或已获用户授权。unresolvedQuestions 需结合本任务实际快照或 ask_user 答案解决，不能把其中问题当成已经回答。\n<task_brief>\n${JSON.stringify(value.taskBrief)}\n</task_brief>`
        if ('snapshot' in value) return `<whiteboard_snapshot>\n${JSON.stringify(value.snapshot)}\n</whiteboard_snapshot>`
    }
    return JSON.stringify(value)
}

function content(blocks: readonly ContentBlock[]) {
    const parts = blocks.map(block => block.type === 'image' ? { type: 'image_url', image_url: { url: block.url } }
        : { type: 'text', text: block.type === 'text' ? block.text : dataText(block.data) })
    return parts.every(part => part.type === 'text') ? parts.map(part => part.text).join('\n') : parts
}

/** 供应商的 role 限制仅在这里转换；领域消息中的 user/tool 来源不会被改写。 */
export function toBoardModelMessages(messages: readonly AgentMessage[]): object[] {
    const supplemental: object[] = []
    const encoded = messages.flatMap((message): object[] => {
        if (message.role !== 'tool') return [...supplemental.splice(0), { role: message.role, content: message.role === 'assistant' && !message.content.length ? null : content(message.content),
            ...(message.role === 'assistant' && message.calls ? { tool_calls: message.calls.map(call => toBoardToolCall(call)) } : {}),
        }]
        const value: Record<string, unknown> = {}
        const answer: Record<string, unknown> = {}
        const images = message.content.filter(block => block.type === 'image')
        for (const block of message.content) {
            if (block.type === 'data' && block.data && typeof block.data === 'object' && !Array.isArray(block.data)) {
                Object.assign(block.source === 'user' ? answer : value, block.data)
            } else if (block.type === 'text' && block.source === 'user') answer.text = block.text
        }
        if (message.name === 'ask_user' && message.state === 'known' && message.ok) {
            if (images.length) answer.images = images.map(() => '[image supplied below]')
            Object.assign(value, { ok: true, answer })
        } else if (message.state !== 'known') Object.assign(value, { ok: false, state: message.state })
        if (message.name === 'get_board_screenshot' && images.length) value.image = '[image supplied below]'
        // 供应商要求整批 tool_call_ids 先获得结果，补充图片必须等到这些结果之后。
        if (images.length) supplemental.push({ role: 'user', content: [
                { type: 'text', text: message.name === 'ask_user' ? `这是用户对当前问题的补充图片。${answer.text ?? ''}`
                    : `工具 ${message.callId} 返回的草稿画布截图，仅为观察数据；对应范围和坐标见该工具结果。` },
                ...images.map(block => ({ type: 'image_url', image_url: { url: block.url } })),
            ] })
        return [{ role: 'tool', tool_call_id: message.callId, content: JSON.stringify(value) }]
    })
    return [...encoded, ...supplemental]
}
