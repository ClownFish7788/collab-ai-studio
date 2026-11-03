import { z } from 'zod'
import { boardToolNameSchema, type BoardToolName } from '../../../agent/domain/tool'
import { MAX_BOARD_SNAPSHOT_SHAPES } from '../../../agent/domain/observation'
import { ERROR_CODES, agentErrorSchema, type AgentError as BoardAgentError } from '../../../agent/domain/error'
import { boardAnswerSchema, type BoardAnswer } from '../../../agent/domain/tool'
import { defaultShapeSchemas } from '@tldraw/tlschema'
import { isEqual } from '@tldraw/utils'
import { DERIVED_SHAPE_PROPS, type DraftShapeType } from '../draft/draftShapeSchema'
import {
    boardToolContracts, createShapesInputSchema, updateShapesInputSchema, deleteShapesInputSchema, snapshotInputSchema, askInputSchema, shapeIdSchema,
    type CreateShapeParameters, type CreateShapesInput, type UpdateShapeParameters, type UpdateShapesInput,
    type DeleteShapesInput, type SnapshotRange, type SnapshotInput, type AskInput,
} from './boardToolInputSchema'
import type { RegionSnapshot } from '../snapshot/collectRegionSnapshot'
import { validateChatSnapshot, validateRegionSnapshot } from '../snapshot/chatSnapshots'
import { MAX_CHAT_REQUEST_BYTES, MAX_IMAGES_PER_MESSAGE, validateImageDataUrl } from '../../chat/images'
import { MAX_BOARD_WRITES_PER_TASK, MAX_BOARD_TOOL_ARGUMENT_CHARS } from '../boardCapabilities'

/** 工具结果的快照传输上限；启动请求另外使用图文请求上限。 */
export const MAX_BOARD_PAYLOAD_BYTES = MAX_CHAT_REQUEST_BYTES
export { MAX_BOARD_SNAPSHOT_SHAPES }
export type { CreateShapeParameters, UpdateShapeParameters, SnapshotRange } from './boardToolInputSchema'
export { isBoardReadTool, type BoardToolName } from '../../../agent/domain/tool'
export type BoardToolCall = {
    id: string
    type: 'function'
    function: { name: BoardToolName; arguments: string }
}

export type CreatedToolShape = CreateShapeParameters & { id: string }

export { ERROR_CODES, type AgentError as BoardAgentError } from '../../../agent/domain/error'

/** 仅携带程序生成的诊断；不将未知异常正文反馈给模型。 */
export class BoardProtocolError extends Error {
    constructor(readonly detail: BoardAgentError) {
        super(detail.message)
    }
}

export type CreateToolOutput =
    | { ok: true; state: 'draft'; shapes: CreatedToolShape[] }
    | { ok: false; error: BoardAgentError }

export type CreateToolSuccess = Extract<CreateToolOutput, { ok: true }>
export type MutationToolSuccess = CreateToolSuccess
    | { ok: true; state: 'draft'; operation: 'update'; shapes: UpdateShapeParameters[] }
    | { ok: true; state: 'draft'; operation: 'delete'; ids: string[] }

export type BoardMutationResult = { callId: string; output: MutationToolSuccess }

export type SnapshotToolSuccess = {
    ok: true
    state: 'draft'
    range: SnapshotRange
    snapshot: RegionSnapshot
    truncated: boolean
}

export type ScreenshotToolSuccess = {
    ok: true; state: 'draft'; range: SnapshotRange; image: string
    reference: RegionSnapshot['reference']
    bounds: { x: number; y: number; w: number; h: number }
}
export type { BoardAnswer } from '../../../agent/domain/tool'
export type AnswerToolSuccess = { ok: true; answer: BoardAnswer; snapshot?: RegionSnapshot }
export type BoardToolOutput = CreateToolOutput | MutationToolSuccess | SnapshotToolSuccess | ScreenshotToolSuccess | AnswerToolSuccess

export function validateBoardAnswer(value: unknown): BoardAnswer {
    record(value)
    fields(value, ['text', 'images', 'selectedShapeIds'])
    if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 1000)) throw new Error('回答文字不合法')
    if (value.images !== undefined) validateBoardImages(value.images)
    if (value.selectedShapeIds !== undefined && (!Array.isArray(value.selectedShapeIds) || value.selectedShapeIds.length > MAX_BOARD_SNAPSHOT_SHAPES
        || value.selectedShapeIds.some(id => !validShapeId(id)) || new Set(value.selectedShapeIds).size !== value.selectedShapeIds.length)) throw new Error('回答选区不合法')
    const text = typeof value.text === 'string' ? value.text.trim() : ''
    const images = value.images as string[] | undefined
    const selectedShapeIds = value.selectedShapeIds as string[] | undefined
    if (!text && !images?.length && !selectedShapeIds?.length) throw new Error('请提供文字、图片或选择元素')
    return boardAnswerSchema.parse({ ...(text ? { text } : {}), ...(images?.length ? { images } : {}), ...(selectedShapeIds?.length ? { selectedShapeIds } : {}) })
}

export type BoardConversationTurn = { prompt: string; reply: string; images?: string[] }
const MAX_CONVERSATION_TURNS = 6
const MAX_CONVERSATION_BYTES = 16 * 1024

/** 历史保留完整图文轮次，文字另设上限；旧快照不进入历史，也不恢复对象授权。 */
export function getBoardConversationHistory(history: readonly BoardConversationTurn[]): BoardConversationTurn[] {
    const next = history.slice(-MAX_CONVERSATION_TURNS)
    while (new TextEncoder().encode(JSON.stringify(next.map(({ prompt, reply }) => ({ prompt, reply })))).byteLength > MAX_CONVERSATION_BYTES
        || new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_CHAT_REQUEST_BYTES) next.shift()
    return next
}

export type BoardCreateRequest = {
    roomId: string
    prompt: string
    images?: string[]
    snapshot?: RegionSnapshot
    history?: BoardConversationTurn[]
}

export type BoardCreateReply =
    | { kind: 'tool'; calls: BoardToolCall[]; content?: string }
    | { kind: 'text'; text: string }

/** 后端推送完整事件；前端只处理事件，不决定是否继续调用模型。 */
export type BoardCreateEvent =
    | { type: 'started'; runId: string }
    | { type: 'plan'; runId: string; text: string }
    | { type: 'preview'; runId: string; source: 'preparation' | 'tool'; delta: string; start: boolean }
    | { type: 'text'; runId: string; text: string }
    | { type: 'tool'; runId: string; call: BoardToolCall }
    | { type: 'completed'; runId: string; text: string; results: BoardMutationResult[] }
    | { type: 'error'; runId: string; error: BoardAgentError }

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): asserts value is Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error('参数必须是对象')
    }
}

function fields(value: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(value).some(key => !allowed.includes(key))) {
        throw new Error('参数包含未开放的字段')
    }
}

function number(value: unknown, min: number, max: number) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function json(value: unknown, depth = 0): boolean {
    if (depth > 30) return false
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.every(item => json(item, depth + 1))
    return isRecord(value) && Object.values(value).every(item => json(item, depth + 1))
}

/** 新增与更新复用原生属性校验，结构 schema 不代替按类型检查和 JSON 深度限制。 */
function validateShapeProps(shape: { props?: unknown }, type: DraftShapeType, path: string, issues: NonNullable<BoardAgentError['issues']>) {
    if (!('props' in shape)) return
    if (!isRecord(shape.props) || !json(shape.props)) {
        issues.push({ path: `${path}.props`, message: '属性须为有限数值组成的合法 JSON 对象，嵌套最多 30 层' }); return
    }
    const validators = defaultShapeSchemas[type].props as Record<string, { validate(value: unknown): unknown }>
    for (const [key, prop] of Object.entries(shape.props)) {
        try {
            if (!Object.hasOwn(validators, key) || DERIVED_SHAPE_PROPS[type]?.includes(key)) throw new Error()
            validators[key].validate(prop)
            if (['w', 'h'].includes(key) && !number(prop, 1, 2000)) throw new Error()
            if (key === 'url' && prop !== '' && (typeof prop !== 'string' || !/^https?:\/\//i.test(prop))) throw new Error()
        } catch {
            issues.push({ path: `${path}.props`, message: '包含该类型不支持、只读或取值不合法的属性' })
        }
    }
}

export function validateToolInput<T extends z.ZodType>(schema: T, value: unknown, message: string): z.output<T> {
    const parsed = schema.safeParse(value, { error: z.locales.zhCN().localeError })
    if (!parsed.success) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message,
        issues: parsed.error.issues.slice(0, 40).map(issue => ({
            path: issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('') || 'arguments',
            message: issue.message.slice(0, 200),
        })),
    })
    return parsed.data
}

/** 验证整批新增参数，不分配 ID、不修改白板。 */
export function validateCreateInput(value: unknown): CreateShapesInput {
    const input = validateToolInput(createShapesInputSchema, value, '新增参数校验失败')
    const issues: NonNullable<BoardAgentError['issues']> = []
    const groupedChildren = new Set<string>()
    input.shapes.forEach((shape, index) => {
        const path = `shapes[${index}]`
        if (shape.type === 'group') {
            for (const id of shape.children) {
                if (groupedChildren.has(id)) issues.push({ path: `${path}.children`, message: '同一批次的多个分组不能复用子元素' })
                groupedChildren.add(id)
            }
        }
        validateShapeProps(shape, shape.type, path, issues)
    })
    if (issues.length) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '新增参数校验失败', issues: issues.slice(0, 40) })
    return input
}

/** JSON 语法错误仍可归属到已识别的调用；只反馈固定诊断，不转发解析器中的输入片段。 */
function parseToolArguments(argumentsText: string): unknown {
    let value: unknown
    try {
        value = JSON.parse(argumentsText)
    } catch {
        throw new BoardProtocolError({
            code: ERROR_CODES.INVALID_ARGUMENTS, message: '工具参数必须是合法 JSON',
            issues: [{ path: 'arguments', message: '请返回符合工具定义的 JSON 对象' }],
        })
    }
    return value
}

/** 解析新增实参，语法和字段错误均在产生任何图形前返回。 */
export function parseCreateInput(argumentsText: string): CreateShapesInput {
    return validateCreateInput(parseToolArguments(argumentsText))
}

const validShapeId = (id: unknown): id is string => shapeIdSchema.safeParse(id).success

/** 部分更新必须至少指定一个可写字段；整批校验完成前不访问 Editor，不改变省略字段。 */
export function validateUpdateInput(value: unknown): UpdateShapesInput {
    const input = validateToolInput(updateShapesInputSchema, value, '更新参数校验失败')
    const issues: NonNullable<BoardAgentError['issues']> = []
    const ids = new Set<string>()
    input.shapes.forEach((shape, index) => {
        const path = `shapes[${index}]`
        if (ids.has(shape.id)) issues.push({ path: `${path}.id`, message: '须为不重复的真实元素 ID' })
        ids.add(shape.id)
        validateShapeProps(shape, shape.type, path, issues)
    })
    if (issues.length) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '更新参数校验失败', issues: issues.slice(0, 40) })
    return input
}

/** type 用于校验目标类型，不允许把已有元素转换成另一种类型。 */
export function parseUpdateInput(argumentsText: string): UpdateShapesInput {
    return validateUpdateInput(parseToolArguments(argumentsText))
}

/** 删除数量遵守共享写入上限；实际存在、类型和授权由当前任务执行器复核。 */
export function validateDeleteInput(value: unknown): DeleteShapesInput {
    return validateToolInput(deleteShapesInputSchema, value, '删除参数校验失败')
}

/** 解析删除实参；非法 JSON 和字段问题均在执行前转为受控参数错误。 */
export function parseDeleteInput(argumentsText: string): DeleteShapesInput {
    return validateDeleteInput(parseToolArguments(argumentsText))
}

/** 读取范围只能是任务绑定页面的视口或全页，模型不能指定其他房间、页面。 */
export function parseSnapshotInput(argumentsText: string): SnapshotInput {
    return validateToolInput(snapshotInputSchema, parseToolArguments(argumentsText), '快照读取范围不合法')
}

/** 询问工具只提交问题，不允许模型把答案伪装成用户输入。 */
export function parseAskInput(argumentsText: string): AskInput {
    return validateToolInput(askInputSchema, parseToolArguments(argumentsText), '询问参数不合法')
}

/** 校验完整 tool_call；流式分片或未知工具不进入本地执行器。 */
export function validateBoardToolCall(value: unknown): BoardToolCall {
    record(value)
    record(value.function)
    fields(value, ['id', 'type', 'function'])
    fields(value.function, ['name', 'arguments'])

    if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 200
        || value.type !== 'function' || !boardToolNameSchema.safeParse(value.function.name).success
        || typeof value.function.arguments !== 'string' || value.function.arguments.length > MAX_BOARD_TOOL_ARGUMENT_CHARS) {
        throw new Error('白板工具调用格式不合法')
    }

    return value as BoardToolCall
}

export function validateBoardAgentError(value: unknown): BoardAgentError {
    record(value)
    fields(value, ['code', 'message', 'issues'])
    if (!Object.values(ERROR_CODES).some(code => code === value.code)
        || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 1000) {
        throw new Error('错误结果不合法')
    }
    if (value.issues !== undefined) {
        if (!Array.isArray(value.issues) || !value.issues.length || value.issues.length > 40) {
            throw new Error('字段问题不合法')
        }
        for (const issue of value.issues) {
            record(issue)
            fields(issue, ['path', 'message'])
            if (typeof issue.path !== 'string' || !/^[\w.[\]]{1,100}$/.test(issue.path)
                || typeof issue.message !== 'string' || !issue.message.trim() || issue.message.length > 200) {
                throw new Error('字段问题不合法')
            }
        }
    }
    return agentErrorSchema.parse(value)
}

export function validateCreateOutput(value: unknown): CreateToolOutput {
    record(value)

    if (value.ok === false) {
        fields(value, ['ok', 'error'])

        validateBoardAgentError(value.error)
        return validateDomainToolOutput('create_shapes', value as CreateToolOutput)
    }

    fields(value, ['ok', 'state', 'shapes'])

    if (value.ok !== true || value.state !== 'draft' || !Array.isArray(value.shapes)) {
        throw new Error('工具成功结果不合法')
    }

    const ids = new Set<string>()
    const shapes = value.shapes.map(shape => {
        record(shape)
        const { id, ...parameters } = shape

        if (!validShapeId(id) || ids.has(id)) {
            throw new Error('工具结果须包含不重复的真实图形 ID')
        }

        ids.add(id)
        return parameters
    })

    validateCreateInput({ shapes })
    return validateDomainToolOutput('create_shapes', value as CreateToolOutput)
}

/** 领域校验完整的可移植快照；原生附加字段仍随原始 wire 对象返回，不写入领域契约。 */
function validateDomainToolOutput<T extends BoardToolOutput>(name: BoardToolName, output: T): T {
    const snapshot = output.ok && 'snapshot' in output ? output.snapshot : undefined
    let value: unknown = snapshot ? { ...output, snapshot: {
        reference: { id: snapshot.reference.id, x: snapshot.reference.x, y: snapshot.reference.y },
        ...(snapshot.viewport ? { viewport: { x: snapshot.viewport.x, y: snapshot.viewport.y, w: snapshot.viewport.w, h: snapshot.viewport.h } } : {}),
        shapes: snapshot.shapes.map(shape => ({
            id: shape.id, type: shape.type, x: shape.x, y: shape.y, w: shape.w, h: shape.h, text: shape.text, opacity: shape.opacity,
            ...(shape.origin ? { origin: { x: shape.origin.x, y: shape.origin.y } } : {}),
            ...Object.fromEntries(['props', 'color', 'labelColor', 'fill', 'geo', 'assetId', 'url']
                .filter(key => shape[key as keyof typeof shape] !== undefined).map(key => [key, shape[key as keyof typeof shape]])),
        })),
    } } : output
    if (output.ok && 'image' in output) {
        const { id, x, y } = output.reference
        const { x: bx, y: by, w, h } = output.bounds
        value = { ...output, reference: { id, x, y }, bounds: { x: bx, y: by, w, h } }
    }
    boardToolContracts[name].outputSchema.parse(value)
    return output
}

/** 校验读取、回答或新增的结果；成功结构不能混合，错误统一使用受控诊断。 */
export function validateBoardToolOutput(value: unknown): BoardToolOutput {
    record(value)
    if (value.ok === true && 'answer' in value) {
        fields(value, ['ok', 'answer', 'snapshot'])
        const answer = validateBoardAnswer(value.answer)
        if (answer.selectedShapeIds?.length) {
            validateRegionSnapshot(value.snapshot)
            if (value.snapshot.shapes.length !== answer.selectedShapeIds.length || value.snapshot.shapes.some(shape => !answer.selectedShapeIds!.includes(shape.id))) throw new Error('回答选区与真实快照不匹配')
        } else if (value.snapshot !== undefined) throw new Error('回答快照须来自明确选区')
        return validateDomainToolOutput('ask_user', value as AnswerToolSuccess)
    }
    if (value.ok === true && 'image' in value) {
        fields(value, ['ok', 'state', 'range', 'image', 'reference', 'bounds'])
        if (value.state !== 'draft' || !['viewport', 'page'].includes(value.range as string)) throw new Error('截图范围不合法')
        validateImageDataUrl(value.image)
        validateRegionSnapshot({ reference: value.reference, shapes: [], viewport: value.bounds })
        record(value.bounds)
        if ((value.bounds.w as number) <= 0 || (value.bounds.h as number) <= 0) throw new Error('截图范围须为正数')
        return validateDomainToolOutput('get_board_screenshot', value as ScreenshotToolSuccess)
    }
    if (value.ok === true && 'operation' in value) {
        if (value.state !== 'draft') throw new Error('写入结果须属于草稿')
        if (value.operation === 'update') {
            fields(value, ['ok', 'state', 'operation', 'shapes'])
            validateUpdateInput({ shapes: value.shapes })
        } else if (value.operation === 'delete') {
            fields(value, ['ok', 'state', 'operation', 'ids'])
            validateDeleteInput({ ids: value.ids })
        } else throw new Error('未知写入结果')
        return validateDomainToolOutput(value.operation === 'update' ? 'update_shapes' : 'delete_shapes', value as MutationToolSuccess)
    }
    if (value.ok === true && 'snapshot' in value) {
        fields(value, ['ok', 'state', 'range', 'snapshot', 'truncated'])
        if (value.state !== 'draft' || value.range !== 'viewport' && value.range !== 'page' || typeof value.truncated !== 'boolean') {
            throw new Error('快照结果不合法')
        }
        validateRegionSnapshot(value.snapshot)
        if (value.snapshot.shapes.length > MAX_BOARD_SNAPSHOT_SHAPES) throw new Error('快照结果超过元素上限')
        return validateDomainToolOutput('get_board_snapshot', value as SnapshotToolSuccess)
    }
    return validateCreateOutput(value)
}

/** 完成事件只能携带真实写入成功；读取和回答不构成白板修改。 */
export function validateMutationOutput(value: unknown): MutationToolSuccess {
    const output = validateBoardToolOutput(value)
    if (!output.ok || !('shapes' in output || 'ids' in output)) throw new Error('写入结果不合法')
    return output
}

/** 各信任边界核对结果类型和更新/删除目标，避免结果冒充其他调用。 */
export function toolOutputMatchesCall(call: BoardToolCall, output: BoardToolOutput): boolean {
    if (!output.ok) return true
    switch (call.function.name) {
        case 'get_board_snapshot': return !('answer' in output) && 'snapshot' in output && output.range === parseSnapshotInput(call.function.arguments).range
        case 'get_board_screenshot': return 'image' in output && output.range === parseSnapshotInput(call.function.arguments).range
        case 'ask_user': return 'answer' in output
        case 'create_shapes': {
            if (!('shapes' in output) || 'operation' in output) return false
            const expected = parseCreateInput(call.function.arguments).shapes
            return expected.length === output.shapes.length && expected.every((shape, index) =>
                isEqual({ ...shape, id: output.shapes[index].id }, output.shapes[index]))
        }
        case 'update_shapes': {
            if (!('operation' in output) || output.operation !== 'update') return false
            const expected = parseUpdateInput(call.function.arguments).shapes
            return isEqual(expected, output.shapes)
        }
        case 'delete_shapes': {
            if (!('operation' in output) || output.operation !== 'delete') return false
            const expected = parseDeleteInput(call.function.arguments).ids
            return expected.length === output.ids.length && expected.every((id, index) => id === output.ids[index])
        }
    }
}

/** 任务事件是浏览器的信任边界；结果列表仅记录真实写入成功，未写入时为空。 */
export function validateBoardCreateEvent(value: unknown): BoardCreateEvent {
    record(value)
    if (typeof value.runId !== 'string' || !/^[\w-]{1,100}$/.test(value.runId)) {
        throw new Error('任务事件 ID 不合法')
    }
    switch (value.type) {
        case 'preview':
            fields(value, ['type', 'runId', 'source', 'delta', 'start'])
            if (!['preparation', 'tool'].includes(value.source as string) || typeof value.start !== 'boolean'
                || typeof value.delta !== 'string' || !value.delta || value.delta.length > MAX_BOARD_TOOL_ARGUMENT_CHARS) throw new Error('生成预览分片不合法')
            break
        case 'started':
            fields(value, ['type', 'runId'])
            break
        case 'tool':
            fields(value, ['type', 'runId', 'call'])
            validateBoardToolCall(value.call)
            break
        case 'text':
            fields(value, ['type', 'runId', 'text'])
            if (typeof value.text !== 'string' || !value.text || value.text.length > 8000) throw new Error('文字分片不合法')
            break
        case 'plan':
            fields(value, ['type', 'runId', 'text'])
            if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 16000) throw new Error('需求拆分摘要不合法')
            break
        case 'error':
            fields(value, ['type', 'runId', 'error'])
            validateBoardAgentError(value.error)
            break
        case 'completed': {
            fields(value, ['type', 'runId', 'text', 'results'])
            if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000) {
                throw new Error('任务完成说明不合法')
            }
            if (!Array.isArray(value.results) || value.results.length > MAX_BOARD_WRITES_PER_TASK) throw new Error('写入结果列表不合法')
            const resultIds = new Set<string>()
            for (const result of value.results) {
                record(result)
                fields(result, ['callId', 'output'])
                if (typeof result.callId !== 'string' || !result.callId.trim() || result.callId.length > 200 || resultIds.has(result.callId)) throw new Error('写入结果调用 ID 不合法或重复')
                resultIds.add(result.callId)
                validateMutationOutput(result.output)
            }
            break
        }
        default:
            throw new Error('未知任务事件')
    }
    return value as BoardCreateEvent
}

/** 只允许有界图文历史；角色由后端固定，不接受客户端工具调用或执行凭据。 */
function validateConversationHistory(value: unknown): asserts value is BoardConversationTurn[] {
    if (!Array.isArray(value) || value.length > MAX_CONVERSATION_TURNS
        || new TextEncoder().encode(JSON.stringify(value.map(turn => ({ prompt: turn?.prompt, reply: turn?.reply })))).byteLength > MAX_CONVERSATION_BYTES
        || new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_CHAT_REQUEST_BYTES) {
        throw new Error('白板对话历史超过上限或格式不合法')
    }
    for (const turn of value) {
        record(turn)
        fields(turn, ['prompt', 'reply', 'images'])
        if (turn.images !== undefined) validateBoardImages(turn.images)
        if (typeof turn.prompt !== 'string' || !turn.prompt.trim() && !(turn.images as string[] | undefined)?.length || turn.prompt.length > 4000
            || typeof turn.reply !== 'string' || !turn.reply.trim() || turn.reply.length > 8000) {
            throw new Error('白板对话历史须为有效需求和回复')
        }
    }
}

function validateBoardImages(value: unknown): asserts value is string[] {
    if (!Array.isArray(value) || value.length > MAX_IMAGES_PER_MESSAGE) throw new Error('每条消息最多 3 张图片')
    value.forEach(validateImageDataUrl)
}

/** 只接收当前需求、图文历史及明确选区；无附件时不隐式采集元素。 */
export function validateBoardCreateRequest(value: unknown): BoardCreateRequest {
    record(value)
    fields(value, ['roomId', 'prompt', 'images', 'snapshot', 'history'])
    if (value.snapshot !== undefined) validateChatSnapshot(value.snapshot)
    if (value.history !== undefined) validateConversationHistory(value.history)
    if (value.images !== undefined) validateBoardImages(value.images)

    if (typeof value.roomId !== 'string' || !value.roomId.trim() || value.roomId.length > 128
        || typeof value.prompt !== 'string' || value.prompt.length > 4000
        || !value.prompt.trim() && !(value.images as string[] | undefined)?.length && !value.snapshot) {
        throw new Error('房间或需求不合法')
    }

    return value as BoardCreateRequest
}

export function validateCreateResultRequest(value: unknown): { callId: string; output: BoardToolOutput } {
    record(value)
    fields(value, ['callId', 'output'])

    if (typeof value.callId !== 'string' || !value.callId || value.callId.length > 200) {
        throw new Error('工具调用 ID 不合法')
    }

    return { callId: value.callId, output: validateBoardToolOutput(value.output) }
}

/** 只使用数据库查询结果作授权依据；客户端的角色字段没有授予权限的作用。 */
export function canUseBoardCreateAgent(document: { ownerId: string; collaborators: { userId: string }[] } | null, userId: string) {
    return !!document && (document.ownerId === userId || document.collaborators.some(item => item.userId === userId))
}
