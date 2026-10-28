/** 新增闭环的共享 JSON 协议；服务端声明工具，浏览器和服务端分别验证收到的数据。 */
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

export type CreateToolCall = {
    id: string
    type: 'function'
    function: { name: 'create_shapes'; arguments: string }
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

export type BoardCreateRequest = {
    roomId: string
    prompt: string
    reference: { x: number; y: number }
}

export type BoardCreateReply =
    | { kind: 'tool'; call: CreateToolCall; content?: string }
    | { kind: 'text'; text: string }

/** 后端推送完整事件；前端只处理事件，不决定是否继续调用模型。 */
export type BoardCreateEvent =
    | { type: 'started'; runId: string }
    | { type: 'tool'; runId: string; call: CreateToolCall }
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
export function parseCreateInput(argumentsText: string): { shapes: CreateShapeParameters[] } {
    let value: unknown
    try {
        value = JSON.parse(argumentsText)
    } catch {
        throw new BoardProtocolError({
            code: ERROR_CODES.INVALID_ARGUMENTS, message: '工具参数必须是合法 JSON',
            issues: [{ path: 'arguments', message: '请返回符合工具定义的 JSON 对象' }],
        })
    }
    return validateCreateInput(value)
}

/** 校验完整 tool_call；流式分片或未知工具不进入本地执行器。 */
export function validateCreateCall(value: unknown): CreateToolCall {
    record(value)
    record(value.function)
    fields(value, ['id', 'type', 'function'])
    fields(value.function, ['name', 'arguments'])

    if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 200
        || value.type !== 'function' || value.function.name !== 'create_shapes'
        || typeof value.function.arguments !== 'string' || value.function.arguments.length > 10000) {
        throw new Error('新增工具调用格式不合法')
    }

    return value as CreateToolCall
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
            validateCreateCall(value.call)
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

/** 启动任务只接收需求和参照点；消息历史、工具清单和后续轮次全部由后端持有。 */
export function validateBoardCreateRequest(value: unknown): BoardCreateRequest {
    record(value)
    fields(value, ['roomId', 'prompt', 'reference'])
    record(value.reference)
    fields(value.reference, ['x', 'y'])

    if (typeof value.roomId !== 'string' || !value.roomId.trim() || value.roomId.length > 128
        || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 1000
        || !number(value.reference.x, -1e8, 1e8) || !number(value.reference.y, -1e8, 1e8)) {
        throw new Error('房间、需求或参照点不合法')
    }

    return value as BoardCreateRequest
}

export function validateCreateResultRequest(value: unknown): { callId: string; output: CreateToolOutput } {
    record(value)
    fields(value, ['callId', 'output'])

    if (typeof value.callId !== 'string' || !value.callId || value.callId.length > 200) {
        throw new Error('工具调用 ID 不合法')
    }

    return { callId: value.callId, output: validateCreateOutput(value.output) }
}

/** 只使用数据库查询结果作授权依据；客户端的角色字段没有授予权限的作用。 */
export function canUseBoardCreateAgent(document: { ownerId: string; collaborators: { userId: string }[] } | null, userId: string) {
    return !!document && (document.ownerId === userId || document.collaborators.some(item => item.userId === userId))
}
