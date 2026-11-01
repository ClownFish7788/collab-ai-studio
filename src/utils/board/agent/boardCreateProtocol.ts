import { defaultShapeSchemas } from '@tldraw/tlschema'
import { isEqual } from '@tldraw/utils'
import { DRAFT_SHAPE_TYPES, DERIVED_SHAPE_PROPS, type DraftShapeType } from '../draft/draftShapeSchema'
import type { CreateDraftShapeInput } from '../draft/draftShapeOperations'
import type { RegionSnapshot } from '../snapshot/collectRegionSnapshot'
import { MAX_CHAT_SNAPSHOT_BYTES, validateChatSnapshot, validateRegionSnapshot } from '../snapshot/chatSnapshots'
import { MAX_CHAT_REQUEST_BYTES, MAX_IMAGES_PER_MESSAGE, validateImageDataUrl } from '../../chat/images'
import { MAX_BOARD_WRITE_SHAPES, MAX_BOARD_WRITES_PER_TASK, MAX_BOARD_TOOL_ARGUMENT_CHARS } from '../boardCapabilities'

/** 工具结果的快照传输上限；启动请求另外使用图文请求上限。 */
export const MAX_BOARD_PAYLOAD_BYTES = MAX_CHAT_SNAPSHOT_BYTES + 20000
export const MAX_BOARD_SNAPSHOT_SHAPES = 30
export type CreateShapeParameters = Pick<CreateDraftShapeInput, 'type' | 'x' | 'y' | 'props' | 'children'>

export type SnapshotRange = 'viewport' | 'page'
export type BoardToolName = 'create_shapes' | 'update_shapes' | 'delete_shapes' | 'get_board_snapshot' | 'ask_user'
export type UpdateShapeParameters = { id: string; type: DraftShapeType } & Partial<Pick<CreateShapeParameters, 'x' | 'y' | 'props'>>
export type BoardToolCall = {
    id: string
    type: 'function'
    function: { name: BoardToolName; arguments: string }
}

export type CreatedToolShape = CreateShapeParameters & { id: string }

export enum ERROR_CODES {
    INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
    INVALID_MODEL_RESPONSE = 'INVALID_MODEL_RESPONSE',
    EXECUTION_FAILED = 'EXECUTION_FAILED',
    ACCESS_DENIED = 'ACCESS_DENIED',
    TASK_INACTIVE = 'TASK_INACTIVE',
    TASK_FAILED = 'TASK_FAILED',
}

export type BoardAgentError = {
    code: ERROR_CODES
    message: string
    issues?: { path: string; message: string }[]
}

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

export type BoardToolOutput = CreateToolOutput | MutationToolSuccess | SnapshotToolSuccess | { ok: true; answer: string }

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
    | { kind: 'tool'; call: BoardToolCall; content?: string }
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

/** 两端使用同一套原生属性校验；模型不能写身份字段或原生排版派生属性。 */
function validateShapes(value: unknown, update: boolean) {
    const issues: NonNullable<BoardAgentError['issues']> = []
    if (!isRecord(value) || Object.keys(value).some(key => key !== 'shapes')
        || !Array.isArray(value.shapes) || value.shapes.length < 1 || value.shapes.length > MAX_BOARD_WRITE_SHAPES) {
        issues.push({ path: 'shapes', message: `须包含 1～${MAX_BOARD_WRITE_SHAPES} 个元素，不能携带其他字段` })
    } else {
        const ids = new Set<string>()
        const groupedChildren = new Set<string>()
        value.shapes.forEach((shape, index) => {
            const path = `shapes[${index}]`
            if (!isRecord(shape)) { issues.push({ path, message: '元素参数必须是对象' }); return }
            const allowed = update ? ['id', 'type', 'x', 'y', 'props'] : ['type', 'x', 'y', 'props', 'children']
            if (Object.keys(shape).some(key => !allowed.includes(key))) issues.push({ path, message: '包含未开放的字段' })
            if (update) {
                if (!validShapeId(shape.id) || ids.has(shape.id)) issues.push({ path: `${path}.id`, message: '须为不重复的真实元素 ID' })
                else ids.add(shape.id)
                if (shape.x === undefined && shape.y === undefined && (!isRecord(shape.props) || !Object.keys(shape.props).length)) {
                    issues.push({ path, message: '至少指定一个坐标或属性修改' })
                }
            }
            for (const key of ['x', 'y'] as const) {
                if ((!update || key in shape) && !number(shape[key], -10000, 10000)) {
                    issues.push({ path: `${path}.${key}`, message: '必须是 -10000～10000 之间的有限数字' })
                }
            }
            if (!(DRAFT_SHAPE_TYPES as readonly unknown[]).includes(shape.type)) {
                issues.push({ path: `${path}.type`, message: '须为受支持的 tldraw 元素类型' }); return
            }
            const type = shape.type as DraftShapeType
            if (!update && (type === 'group' || 'children' in shape)) {
                if (type !== 'group' || !Array.isArray(shape.children) || shape.children.length < 2 || shape.children.length > 30
                    || !shape.children.every(validShapeId) || new Set(shape.children).size !== shape.children.length) {
                    issues.push({ path: `${path}.children`, message: '只有 group 可提供 children，须为 2～30 个已读取且不重复的 ID' })
                } else {
                    for (const id of shape.children as string[]) {
                        if (groupedChildren.has(id)) issues.push({ path: `${path}.children`, message: '同一批次的多个分组不能复用子元素' })
                        groupedChildren.add(id)
                    }
                }
            }
            if ('props' in shape) {
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
        })
    }
    if (issues.length) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS,
        message: update ? '更新参数校验失败' : '新增参数校验失败', issues: issues.slice(0, 40) })
}

/** 验证整批新增参数，不分配 ID、不修改白板。 */
export function validateCreateInput(value: unknown): { shapes: CreateShapeParameters[] } {
    validateShapes(value, false)
    return value as { shapes: CreateShapeParameters[] }
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
export function parseCreateInput(argumentsText: string): { shapes: CreateShapeParameters[] } {
    return validateCreateInput(parseToolArguments(argumentsText))
}

const validShapeId = (id: unknown): id is string => typeof id === 'string' && /^shape:[\w-]{1,128}$/.test(id)

/** 部分更新必须至少指定一个可写字段；整批校验完成前不访问 Editor，不改变省略字段。 */
export function validateUpdateInput(value: unknown): { shapes: UpdateShapeParameters[] } {
    validateShapes(value, true)
    return value as { shapes: UpdateShapeParameters[] }
}

/** type 用于校验目标类型，不允许把已有元素转换成另一种类型。 */
export function parseUpdateInput(argumentsText: string): { shapes: UpdateShapeParameters[] } {
    return validateUpdateInput(parseToolArguments(argumentsText))
}

/** 删除数量遵守共享写入上限；实际存在、类型和授权由当前任务执行器复核。 */
export function validateDeleteInput(value: unknown): { ids: string[] } {
    if (!isRecord(value) || Object.keys(value).some(key => key !== 'ids') || !Array.isArray(value.ids)
        || value.ids.length < 1 || value.ids.length > MAX_BOARD_WRITE_SHAPES || !value.ids.every(validShapeId)
        || new Set(value.ids).size !== value.ids.length) {
        throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '删除参数校验失败',
            issues: [{ path: 'ids', message: `须为 1～${MAX_BOARD_WRITE_SHAPES} 个不重复的真实图形 ID，不能携带其他字段` }] })
    }
    return value as { ids: string[] }
}

/** 解析删除实参；非法 JSON 和字段问题均在执行前转为受控参数错误。 */
export function parseDeleteInput(argumentsText: string): { ids: string[] } {
    return validateDeleteInput(parseToolArguments(argumentsText))
}

/** 读取范围只能是任务绑定页面的视口或全页，模型不能指定其他房间、页面。 */
export function parseSnapshotInput(argumentsText: string): { range: SnapshotRange } {
    const value = parseToolArguments(argumentsText)
    if (!isRecord(value) || Object.keys(value).some(key => key !== 'range')
        || value.range !== 'viewport' && value.range !== 'page') {
        throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '快照读取范围不合法',
            issues: [{ path: 'range', message: '必须为 viewport 或 page，且不能携带其他字段' }] })
    }
    return value as { range: SnapshotRange }
}

/** 询问工具只提交问题，不允许模型把答案伪装成用户输入。 */
export function parseAskInput(argumentsText: string): { question: string } {
    const value = parseToolArguments(argumentsText)
    if (!isRecord(value) || Object.keys(value).some(key => key !== 'question')
        || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 1000) {
        throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '询问参数不合法',
            issues: [{ path: 'question', message: '须为 1～1000 字的问题，且不能携带其他字段' }] })
    }
    return value as { question: string }
}

/** 校验完整 tool_call；流式分片或未知工具不进入本地执行器。 */
export function validateBoardToolCall(value: unknown): BoardToolCall {
    record(value)
    record(value.function)
    fields(value, ['id', 'type', 'function'])
    fields(value.function, ['name', 'arguments'])

    if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 200
        || value.type !== 'function' || !['create_shapes', 'update_shapes', 'delete_shapes', 'get_board_snapshot', 'ask_user'].includes(value.function.name as string)
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
    return value as BoardAgentError
}

export function validateCreateOutput(value: unknown): CreateToolOutput {
    record(value)

    if (value.ok === false) {
        fields(value, ['ok', 'error'])

        validateBoardAgentError(value.error)
        return value as CreateToolOutput
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
    return value as CreateToolOutput
}

/** 校验读取、回答或新增的结果；成功结构不能混合，错误统一使用受控诊断。 */
export function validateBoardToolOutput(value: unknown): BoardToolOutput {
    record(value)
    if (value.ok === true && 'operation' in value) {
        if (value.state !== 'draft') throw new Error('写入结果须属于草稿')
        if (value.operation === 'update') {
            fields(value, ['ok', 'state', 'operation', 'shapes'])
            validateUpdateInput({ shapes: value.shapes })
        } else if (value.operation === 'delete') {
            fields(value, ['ok', 'state', 'operation', 'ids'])
            validateDeleteInput({ ids: value.ids })
        } else throw new Error('未知写入结果')
        return value as MutationToolSuccess
    }
    if (value.ok === true && 'snapshot' in value) {
        fields(value, ['ok', 'state', 'range', 'snapshot', 'truncated'])
        if (value.state !== 'draft' || value.range !== 'viewport' && value.range !== 'page' || typeof value.truncated !== 'boolean') {
            throw new Error('快照结果不合法')
        }
        validateRegionSnapshot(value.snapshot)
        if (value.snapshot.shapes.length > MAX_BOARD_SNAPSHOT_SHAPES) throw new Error('快照结果超过元素上限')
        return value as SnapshotToolSuccess
    }
    if (value.ok === true && 'answer' in value) {
        fields(value, ['ok', 'answer'])
        if (typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 1000) {
            throw new Error('用户回答不合法')
        }
        return value as { ok: true; answer: string }
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
        case 'get_board_snapshot': return 'snapshot' in output && output.range === parseSnapshotInput(call.function.arguments).range
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
