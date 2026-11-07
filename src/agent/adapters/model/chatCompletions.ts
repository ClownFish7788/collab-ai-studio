import { z } from 'zod'
import { jsonrepair } from 'jsonrepair'
import type OpenAI from 'openai'
import { createModelClient, ModelRequestError, requestCompletion, type ModelConfig } from './client'
import { AgentApplicationError, MAX_BOARD_TOOL_CALLS, type ModelPort } from '../../application/ports'
import { ERROR_CODES } from '../../domain/error'
import { jsonValueSchema, type JsonValue } from '../../domain/data'
import { toolCallIdSchema } from '../../domain/invocation'
import { modelDecisionSchema, type AgentMessage, type ContentBlock, type ModelDecision } from '../../domain/message'
import { boardToolNameSchema, type BoardToolName, type createBoardToolContracts } from '../../domain/tool'
import { getToolCorrectionContract } from '../../domain/toolCorrection'
import { boardTaskBriefPrompt } from '../../../prompts/boardTaskBriefPrompt'
import { boardAgentCapabilitiesPrompt, MAX_BOARD_TOOL_ARGUMENT_CHARS } from '../../../utils/board/boardCapabilities'

type ModelOptions = {
    config: ModelConfig
    contracts: ReturnType<typeof createBoardToolContracts>
    fetcher?: typeof fetch
    onPreview?: (source: 'preparation' | 'tool', delta: string, start: boolean) => void
}

const modelError = (message: string) => new AgentApplicationError({ code: ERROR_CODES.INVALID_MODEL_RESPONSE, message })

// 供应商可附带 index/usage 等元数据，只解析完成判断和领域映射所需的字段。
const responseSchema = z.object({ error: z.unknown().optional(), choices: z.array(z.object({
    finish_reason: z.enum(['stop', 'tool_calls']),
    message: z.object({
        role: z.literal('assistant'), content: z.string().max(8000).nullable().optional(), refusal: z.unknown().optional(),
        tool_calls: z.array(z.object({ id: toolCallIdSchema, type: z.literal('function'), function: z.object({
            name: boardToolNameSchema, arguments: z.string().max(MAX_BOARD_TOOL_ARGUMENT_CHARS),
        }) })).max(MAX_BOARD_TOOL_CALLS).nullable().optional(),
    }),
})).length(1) })

/** 仅解码契约声明的顶层数组；完整数组的语法错误尝试修复一次，随后仍走全部校验。 */
function parseToolArguments(text: string, parameters: z.core.JSONSchema.JSONSchema = {}): JsonValue {
    let input: unknown
    try { input = JSON.parse(text) } catch { return text }
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        const fields = input as Record<string, unknown>
        const branches = [parameters, ...(parameters.anyOf ?? []), ...(parameters.oneOf ?? [])]
        const properties = branches.flatMap(branch => typeof branch === 'object' ? Object.entries(branch.properties ?? {}) : [])
        for (const [key, property] of properties) {
            if (property && typeof property === 'object' && property.type === 'array' && typeof fields[key] === 'string') {
                const raw = fields[key] as string
                let value: unknown
                try { value = JSON.parse(raw) }
                catch {
                    // 不补截断数组的结尾，避免把未生成完的操作计划当成完整请求。
                    if (!raw.trim().startsWith('[') || !raw.trim().endsWith(']')) continue
                    try { value = JSON.parse(jsonrepair(raw)) }
                    catch { continue }
                }
                if (Array.isArray(value)) fields[key] = value
            }
        }
    }
    const parsed = jsonValueSchema.safeParse(input)
    return parsed.success ? parsed.data : text
}

/** 非法实参仍保留关联提议，不能因一个调用解析失败而丢失整批其他调用。 */
function decodeDecision(value: unknown, tools: readonly { function: { name: BoardToolName; parameters: z.core.JSONSchema.JSONSchema } }[]): ModelDecision {
    const allowedTools = tools.map(tool => tool.function.name)
    const parsed = responseSchema.safeParse(value)
    if (!parsed.success || parsed.data.error != null) throw modelError('模型响应不完整、被拒绝或格式不合法，本轮没有执行工具')
    const choice = parsed.data.choices[0], message = choice.message
    if (message.refusal != null) throw modelError('模型拒绝了当前请求，本轮没有执行工具')
    let decision: unknown
    if (choice.finish_reason === 'tool_calls') {
        if (!allowedTools.length || !message.tool_calls?.length || message.tool_calls.some(call => !allowedTools.includes(call.function.name))) {
            throw modelError('模型返回未开放或不完整的工具调用')
        }
        decision = { kind: 'tool', ...(message.content != null ? { content: message.content } : {}), calls: message.tool_calls.map(call => {
            const input = parseToolArguments(call.function.arguments, tools.find(tool => tool.function.name === call.function.name)?.function.parameters)
            return { id: call.id, name: call.function.name, input }
        }) }
    } else {
        if (message.tool_calls?.length) throw modelError('模型结束原因与工具调用不匹配')
        decision = { kind: 'text', text: message.content }
    }
    const result = modelDecisionSchema.safeParse(decision)
    if (!result.success) throw modelError('模型没有返回有效内容或工具调用 ID 重复')
    return result.data
}

function executionInstructions(allowedTools: readonly BoardToolName[]) {
    return `本轮仅允许这些工具：${allowedTools.join('、')}。其他工具即使出现在历史也不能调用。本任务已经执行哪些操作，以本任务真实工具结果为准；读取快照和回答不表示写入成功，历史任务的成功也不算本任务的执行。仅当用户要求新增、修改或删除且信息齐全时，实际调用对应写入工具。查看、截图、统计、分类是只读任务，实际读取后用content返回结果，不写入；用户要求截图时实际调用get_board_screenshot，不能声称工具不存在。不能用content声称未实际执行的写入。每次写入须提供isFinal，仍需后续操作为false，最后一次写入为true。${allowedTools.includes('get_board_snapshot') && !allowedTools.includes('create_shapes')
            ? '当前尚未取得首份白板快照，用户回答不等于快照。继续白板操作前必须先调用 get_board_snapshot；禁止直接写入。' : ''}${allowedTools.includes('ask_user')
            ? '已明确的白板任务若缺少必要信息或有多个候选，必须真正调用 ask_user 等待答案；不能仅在 content 中写问题并结束。用户按描述指定更新或删除目标，而该范围快照 truncated=true 时，即使只返回一个匹配项也不能确认唯一，必须先询问用户是否操作这个已读取对象；用户已明确指定真实 ID 或已明确选定目标时例外。这是继续当前任务的协议要求。' : ''}`
}

/** 聚合有界 SSE；文字只用于展示，工具分片直到 DONE/结束原因均有效后才交给调用校验。 */
async function readModelStream(response: Response, signal: AbortSignal, onText?: (text: string) => void, onArguments?: (text: string) => void) {
    if (!response.body) throw modelError('模型响应流为空')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = '', text = '', role: string | undefined, finish: string | undefined, done = false
    const calls = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>()
    const invalid = () => modelError('模型流不完整、过大或包含非法分片，本轮没有执行工具')
    const consume = (block: string) => {
        if (block.length > 30000) throw invalid()
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) return
        if (data.trim() === '[DONE]') { done = true; return }
        const value = JSON.parse(data)
        if (value.error || !Array.isArray(value.choices)) throw invalid()
        if (!value.choices.length) return // 部分兼容服务在结尾单独发送 usage。
        if (done || finish || value.choices.length !== 1) throw invalid()
        const choice = value.choices[0], delta = choice.delta
        if (choice.index !== 0 || !delta || typeof delta !== 'object' || delta.refusal != null) throw invalid()
        if (delta.role !== undefined) {
            if (delta.role !== 'assistant') throw invalid()
            role = delta.role
        }
        if (delta.content != null) {
            if (typeof delta.content !== 'string') throw invalid()
            text += delta.content
            if (text.length > 8000) throw invalid()
            if (delta.content) onText?.(delta.content)
        }
        if (delta.tool_calls != null) {
            if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > MAX_BOARD_TOOL_CALLS) throw invalid()
            for (const fragment of delta.tool_calls) {
                if (!Number.isInteger(fragment.index) || fragment.index < 0 || fragment.index >= MAX_BOARD_TOOL_CALLS) throw invalid()
                let call = calls.get(fragment.index)
                if (fragment.type !== undefined && fragment.type !== 'function'
                    || fragment.id !== undefined && (typeof fragment.id !== 'string' || fragment.id && call?.id && call.id !== fragment.id)) throw invalid()
                call ??= { id: '', type: 'function', function: { name: '', arguments: '' } }
                calls.set(fragment.index, call)
                // 兼容服务在后续分片使用空 ID 占位；真实非空 ID 仍必须保持一致。
                if (fragment.id) call.id = fragment.id
                for (const key of ['name', 'arguments'] as const) {
                    const part = fragment.function?.[key]
                    if (part === undefined) continue
                    if (typeof part !== 'string') throw invalid()
                    call.function[key] += part
                }
                if (call.id.length > 200 || call.function.name.length > 100 || call.function.arguments.length > MAX_BOARD_TOOL_ARGUMENT_CHARS) throw invalid()
                // 预览只展示首个调用，避免不同工具的 JSON 分片混在一起。
                if (fragment.index === 0 && fragment.function?.arguments) onArguments?.(fragment.function.arguments)
            }
        }
        if (choice.finish_reason != null) {
            if (!['stop', 'tool_calls'].includes(choice.finish_reason)) throw invalid()
            finish = choice.finish_reason
        }
    }
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
        signal.throwIfAborted()
        while (!done) {
            const chunk = await reader.read()
            signal.throwIfAborted()
            pending = (pending + decoder.decode(chunk.value, { stream: !chunk.done })).replace(/\r\n/g, '\n')
            let end: number
            while ((end = pending.indexOf('\n\n')) !== -1) {
                consume(pending.slice(0, end))
                pending = pending.slice(end + 2)
            }
            if (pending.length > 30000) throw invalid()
            if (chunk.done) { if (pending.trim()) consume(pending); break }
        }
        if (!done || !finish || role !== 'assistant') throw invalid()
        const ordered = [...calls].sort(([a], [b]) => a - b)
        if (ordered.some(([index], position) => index !== position)) throw invalid()
        return { choices: [{ finish_reason: finish, message: { role, content: text, ...(calls.size ? { tool_calls: ordered.map(([, call]) => call) } : {}) } }] }
    } finally {
        signal.removeEventListener('abort', cancel)
        await reader.cancel().catch(() => {})
    }
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
function encodeMessages(messages: readonly AgentMessage[]): object[] {
    const supplemental: object[] = []
    const encoded = messages.flatMap((message): object[] => {
        if (message.role !== 'tool') return [...supplemental.splice(0), { role: message.role, content: message.role === 'assistant' && !message.content.length ? null : content(message.content),
            ...(message.role === 'assistant' && message.calls ? { tool_calls: message.calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.input) } })) } : {}),
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

/** Chat Completions 兼容适配器：对外仅实现模型端口，调用预算和任务重试仍由应用层决定。 */
export function createChatCompletionsModel({ config, contracts, fetcher = fetch, onPreview }: ModelOptions): ModelPort {
    const client = createModelClient(config, fetcher)
    async function requestModel(
        messages: readonly AgentMessage[], allowedTools: readonly BoardToolName[], signal: AbortSignal,
        phase: 'preparation' | 'tool', elementKeys: readonly string[] = [],
    ): Promise<ModelDecision> {
        signal.throwIfAborted()
        const mutationSchemas = contracts.getMutationIntentSchemas(elementKeys)
        const tools = boardToolNameSchema.options.filter(name => allowedTools.includes(name)).map(name => {
            const schema = name === 'create_shapes' ? mutationSchemas.create : name === 'update_shapes' ? mutationSchemas.update
                : name === 'delete_shapes' ? mutationSchemas.delete : contracts.tools[name].inputSchema
            return { type: 'function' as const, function: { name, description: contracts.tools[name].description,
                parameters: z.toJSONSchema(contracts.tools[name].kind === 'write' ? getToolCorrectionContract(schema).modelSchema : schema, { target: 'draft-7' }),
            } }
        })
        const encoded = encodeMessages(messages)
        let response: Response
        try {
            response = await requestCompletion(client, config, {
                messages: [
                    { role: 'system', content: boardAgentCapabilitiesPrompt },
                    ...(phase === 'preparation' ? [{ role: 'system', content: boardTaskBriefPrompt }] : []),
                    ...encoded,
                    ...(phase === 'tool' ? [{ role: 'system', content: executionInstructions(allowedTools) }] : []),
                ] as OpenAI.ChatCompletionMessageParam[],
                ...(allowedTools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {}),
                outputLimit: phase === 'preparation' ? 2000 : 4000,
            }, signal)
        } catch (cause) {
            signal.throwIfAborted()
            throw modelError(cause instanceof ModelRequestError ? cause.message : '模型服务连接失败')
        }
        let data: unknown
        let start = true
        const preview = (delta: string) => { onPreview?.(phase, delta, start); start = false }
        try {
            data = response.headers.get('content-type')?.includes('text/event-stream')
                ? await readModelStream(response, signal, phase === 'preparation' ? preview : undefined, phase === 'tool' ? preview : undefined)
                : await response.json()
            signal.throwIfAborted()
        } catch {
            signal.throwIfAborted()
            throw modelError('模型服务未返回完整合法响应，本轮没有执行工具')
        }
        return decodeDecision(data, tools)
    }
    return {
        async prepare(messages, signal) {
            const reply = await requestModel(messages, [], signal, 'preparation')
            if (reply.kind !== 'text') throw modelError('需求拆分不能调用工具')
            return reply.text
        },
        async next(context, allowedTools, signal) {
            if (!allowedTools.length) throw modelError('没有可调用的工具，本轮不请求执行模型')
            return requestModel(context.messages, allowedTools, signal, 'tool', context.task?.objects.map(object => object.key) ?? [])
        },
    }
}
