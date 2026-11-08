import { toAgentToolOutput } from '../board/protocol'
import { validateBoardAnswers } from '../interaction/askUser'
import { answersMatchQuestions, boardToolNameSchema, type BoardToolName, type BoardAnswers } from '../../domain/tool'
import { MAX_BOARD_SNAPSHOT_SHAPES } from '../../domain/observation'
import { ERROR_CODES, agentErrorSchema, type AgentError as BoardAgentError } from '../../domain/error'
import { isEqual } from '@tldraw/utils'
import { shapeIdSchema, type CreateShapeParameters, type UpdateShapeParameters, type SnapshotRange } from '../board/contracts'
import type { RegionSnapshot } from '../board/tldraw'
import { validateChatSnapshot, validateRegionSnapshot } from '../../../utils/board/snapshot/chatSnapshots'
import { MAX_CHAT_REQUEST_BYTES, MAX_IMAGES_PER_MESSAGE, validateImageDataUrl } from '../../../utils/chat/images'
import { MAX_BOARD_WRITES_PER_TASK, MAX_BOARD_TOOL_ARGUMENT_CHARS } from '../../../utils/board/boardCapabilities'
import { validateCreateInput, validateUpdateInput, validateDeleteInput, parseCreateInput, parseUpdateInput, parseDeleteInput, parseSnapshotInput, parseAskInput } from '../board/nativeValidation'
import { BoardProtocolError } from './errors'

/** 工具结果的快照传输上限；启动请求另外使用图文请求上限。 */
export const MAX_BOARD_PAYLOAD_BYTES = MAX_CHAT_REQUEST_BYTES
export { MAX_BOARD_SNAPSHOT_SHAPES }
export type { CreateShapeParameters, UpdateShapeParameters, SnapshotRange } from '../board/contracts'
export { isBoardReadTool, type BoardToolName } from '../../domain/tool'
export type BoardToolCall = {
    id: string
    type: 'function'
    function: { name: BoardToolName; arguments: string }
}

export type CreatedToolShape = CreateShapeParameters & { id: string }

export { ERROR_CODES, type AgentError as BoardAgentError } from '../../domain/error'

export type CreateToolOutput =
    | { ok: true; state: 'draft'; shapes: CreatedToolShape[] }
    | { ok: false; error: BoardAgentError }

export type CreateToolSuccess = Extract<CreateToolOutput, { ok: true }>
export type UpdateToolSuccess = { ok: true; state: 'draft'; operation: 'update'; shapes: UpdateShapeParameters[] }
export type DeleteToolSuccess = { ok: true; state: 'draft'; operation: 'delete'; ids: string[] }
export type MutationToolSuccess = CreateToolSuccess | UpdateToolSuccess | DeleteToolSuccess

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
export type { BoardAnswers } from '../../domain/tool'
export type AnswerToolSuccess = { ok: true; answers: BoardAnswers; snapshot?: RegionSnapshot }

/** 具体工具保持各自的成功结构；传输分发边界才合并成 BoardToolOutput。 */
export type BoardToolSuccessMap = {
    create_shapes: CreateToolSuccess
    update_shapes: UpdateToolSuccess
    delete_shapes: DeleteToolSuccess
    get_board_snapshot: SnapshotToolSuccess
    get_board_screenshot: ScreenshotToolSuccess
    ask_user: AnswerToolSuccess
}
export type BoardToolOutput = BoardToolSuccessMap[BoardToolName] | Extract<CreateToolOutput, { ok: false }>

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

const validShapeId = (id: unknown): id is string => shapeIdSchema.safeParse(id).success

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
    toAgentToolOutput(name, output)
    return output
}

/** 校验读取、回答或新增的结果；成功结构不能混合，错误统一使用受控诊断。 */
export function validateBoardToolOutput(value: unknown): BoardToolOutput {
    record(value)
    if (value.ok === true && 'answers' in value) {
        fields(value, ['ok', 'answers', 'snapshot'])
        const answers = validateBoardAnswers(value.answers)
        const ids = [...new Set(answers.flatMap(answer => answer.selectedShapeIds ?? []))]
        if (ids.length) {
            validateRegionSnapshot(value.snapshot)
            if (value.snapshot.shapes.length !== ids.length || value.snapshot.shapes.some(shape => !ids.includes(shape.id))) throw new Error('回答选区与真实快照不匹配')
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

/** 先做原生传输校验，再按工具名验证 Zod 输出；截图结果不能冒充结构快照。 */
export function validateBoardToolSuccess<Name extends BoardToolName>(name: Name, value: unknown): BoardToolSuccessMap[Name] {
    const output = validateBoardToolOutput(value)
    if (!output.ok) throw new BoardProtocolError(output.error)
    toAgentToolOutput(name, output)
    // 上面的运行时校验已绑定工具名；动态索引无法让 TypeScript 自动建立这个关联。
    return output as BoardToolSuccessMap[Name]
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
        case 'get_board_snapshot': return !('answers' in output) && 'snapshot' in output && output.range === parseSnapshotInput(call.function.arguments).range
        case 'get_board_screenshot': return 'image' in output && output.range === parseSnapshotInput(call.function.arguments).range
        case 'ask_user': return 'answers' in output && answersMatchQuestions(parseAskInput(call.function.arguments).questions, output.answers)
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
