import type { RegionSnapshot } from './collectRegionSnapshot'
import { MAX_CHAT_SNAPSHOT_BYTES, validateChatSnapshot, validateRegionSnapshot } from './chatSnapshots'

/** 工具共享协议；启动请求和工具结果为快照预留相同的传输空间。 */
export const MAX_BOARD_PAYLOAD_BYTES = MAX_CHAT_SNAPSHOT_BYTES + 20000
export const MAX_BOARD_SNAPSHOT_SHAPES = 30
export const CREATE_GEOS = ['ellipse', 'rectangle', 'diamond'] as const
export const CREATE_COLORS = ['black', 'blue', 'red', 'green'] as const

export type CreateShapeParameters = {
    geo: typeof CREATE_GEOS[number]
    /** 相对任务固定参照点的页面坐标，表示未旋转图形左上角。 */
    x: number
    y: number
    w: number
    h: number
    color: typeof CREATE_COLORS[number]
}

export type SnapshotRange = 'viewport' | 'page'
export type BoardToolName = 'create_shapes' | 'get_board_snapshot' | 'ask_user'
export type BoardToolCall = {
    id: string
    type: 'function'
    function: { name: BoardToolName; arguments: string }
}

export type CreatedToolShape = CreateShapeParameters & { id: string; type: 'geo' }

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

export type SnapshotToolSuccess = {
    ok: true
    state: 'draft'
    range: SnapshotRange
    snapshot: RegionSnapshot
    truncated: boolean
}

export type BoardToolOutput = CreateToolOutput | SnapshotToolSuccess | { ok: true; answer: string }

export type BoardConversationTurn = { prompt: string; reply: string }
const MAX_CONVERSATION_TURNS = 6
const MAX_CONVERSATION_BYTES = 16 * 1024

/** 回传上下文仅保留有界完整轮次；界面可继续展示未回传的超长回复。 */
export function getBoardConversationHistory(history: readonly BoardConversationTurn[]): BoardConversationTurn[] {
    const next = history.slice(-MAX_CONVERSATION_TURNS)
    while (new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_CONVERSATION_BYTES) next.shift()
    return next
}

export type BoardCreateRequest = {
    roomId: string
    prompt: string
    snapshot?: RegionSnapshot
    history?: BoardConversationTurn[]
}

export type BoardCreateReply =
    | { kind: 'tool'; call: BoardToolCall; content?: string }
    | { kind: 'text'; text: string }

/** 后端推送完整事件；前端只处理事件，不决定是否继续调用模型。 */
export type BoardCreateEvent =
    | { type: 'started'; runId: string }
    | { type: 'tool'; runId: string; call: BoardToolCall }
    | { type: 'completed'; runId: string; text: string; output?: CreateToolSuccess }
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

/** 输入未知 JSON；验证全部新增参数后返回有类型的数据，不分配 ID、不修改白板。 */
export function validateCreateInput(value: unknown): { shapes: CreateShapeParameters[] } {
    const issues: NonNullable<BoardAgentError['issues']> = []

    if (!isRecord(value)) {
        issues.push({ path: 'arguments', message: '参数必须是对象' })
    } else {
        if (Object.keys(value).some(key => key !== 'shapes')) {
            issues.push({ path: 'arguments', message: '参数包含未开放的字段' })
        }
        if (!Array.isArray(value.shapes) || value.shapes.length < 1 || value.shapes.length > 5) {
            issues.push({ path: 'shapes', message: '每次新增须包含 1～5 个图形' })
        } else {
            value.shapes.forEach((shape, index) => {
                const path = `shapes[${index}]`
                if (!isRecord(shape)) {
                    issues.push({ path, message: '图形参数必须是对象' })
                    return
                }
                if (Object.keys(shape).some(key => !['geo', 'x', 'y', 'w', 'h', 'color'].includes(key))) {
                    issues.push({ path, message: '图形包含未开放的字段' })
                }
                if (!(CREATE_GEOS as readonly unknown[]).includes(shape.geo)) {
                    issues.push({ path: `${path}.geo`, message: '必须为 ellipse、rectangle 或 diamond' })
                }
                if (!(CREATE_COLORS as readonly unknown[]).includes(shape.color)) {
                    issues.push({ path: `${path}.color`, message: '必须为 black、blue、red 或 green' })
                }
                for (const key of ['x', 'y', 'w', 'h'] as const) {
                    const [min, max] = key === 'x' || key === 'y' ? [-10000, 10000] : [1, 2000]
                    if (!number(shape[key], min, max)) {
                        issues.push({ path: `${path}.${key}`, message: `必须是 ${min}～${max} 之间的有限数字` })
                    }
                }
            })
        }
    }

    if (issues.length) {
        throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '新增参数校验失败', issues })
    }

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
        || value.type !== 'function' || !['create_shapes', 'get_board_snapshot', 'ask_user'].includes(value.function.name as string)
        || typeof value.function.arguments !== 'string' || value.function.arguments.length > 10000) {
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
        const { id, type, ...parameters } = shape

        if (typeof id !== 'string' || !/^shape:[\w-]{1,128}$/.test(id) || type !== 'geo' || ids.has(id)) {
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

/** 任务事件是浏览器的信任边界；完成不等于新增，只有实际成功时才携带 output。 */
export function validateBoardCreateEvent(value: unknown): BoardCreateEvent {
    record(value)
    if (typeof value.runId !== 'string' || !/^[\w-]{1,100}$/.test(value.runId)) {
        throw new Error('任务事件 ID 不合法')
    }
    switch (value.type) {
        case 'started':
            fields(value, ['type', 'runId'])
            break
        case 'tool':
            fields(value, ['type', 'runId', 'call'])
            validateBoardToolCall(value.call)
            break
        case 'error':
            fields(value, ['type', 'runId', 'error'])
            validateBoardAgentError(value.error)
            break
        case 'completed':
            fields(value, ['type', 'runId', 'text', 'output'])
            if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000) {
                throw new Error('任务完成说明不合法')
            }
            if (value.output !== undefined && !validateCreateOutput(value.output).ok) {
                throw new Error('任务完成事件不能携带失败结果')
            }
            break
        default:
            throw new Error('未知任务事件')
    }
    return value as BoardCreateEvent
}

/** 仅允许有界文字历史；角色由后端固定，不接受客户端工具调用或执行凭据。 */
function validateConversationHistory(value: unknown): asserts value is BoardConversationTurn[] {
    if (!Array.isArray(value) || value.length > MAX_CONVERSATION_TURNS
        || new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_CONVERSATION_BYTES) {
        throw new Error('白板对话历史超过上限或格式不合法')
    }
    for (const turn of value) {
        record(turn)
        fields(turn, ['prompt', 'reply'])
        if (typeof turn.prompt !== 'string' || !turn.prompt.trim() || turn.prompt.length > 1000
            || typeof turn.reply !== 'string' || !turn.reply.trim() || turn.reply.length > 8000) {
            throw new Error('白板对话历史须为有效需求和回复')
        }
    }
}

/** 只接收当前需求、有界文字历史及明确附加选区；无附件时不隐式采集元素。 */
export function validateBoardCreateRequest(value: unknown): BoardCreateRequest {
    record(value)
    fields(value, ['roomId', 'prompt', 'snapshot', 'history'])
    if (value.snapshot !== undefined) validateChatSnapshot(value.snapshot)
    if (value.history !== undefined) validateConversationHistory(value.history)

    if (typeof value.roomId !== 'string' || !value.roomId.trim() || value.roomId.length > 128
        || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 1000) {
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
