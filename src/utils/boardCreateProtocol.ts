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

export type CreateToolOutput =
    | { ok: true; state: 'draft'; shapes: CreatedToolShape[] }
    | { ok: false; error: string }

export type BoardCreateRequest = {
    roomId: string
    prompt: string
    reference: { x: number; y: number }
}

export type BoardCreateReply =
    | { kind: 'tool'; call: CreateToolCall }
    | { kind: 'text'; text: string }

/** 后端推送完整事件；前端只处理事件，不决定是否继续调用模型。 */
export type BoardCreateEvent =
    | { type: 'started'; runId: string }
    | { type: 'tool'; runId: string; call: CreateToolCall }
    | { type: 'completed'; runId: string; text: string; output: CreateToolOutput }
    | { type: 'error'; runId: string; error: string }

function record(value: unknown): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
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
    record(value)
    fields(value, ['shapes'])

    if (!Array.isArray(value.shapes) || value.shapes.length < 1 || value.shapes.length > 5) {
        throw new Error('每次新增须包含 1～5 个图形')
    }

    for (const shape of value.shapes) {
        record(shape)
        fields(shape, ['geo', 'x', 'y', 'w', 'h', 'color'])

        if (!(CREATE_GEOS as readonly unknown[]).includes(shape.geo)
            || !(CREATE_COLORS as readonly unknown[]).includes(shape.color)
            || !number(shape.x, -10000, 10000) || !number(shape.y, -10000, 10000)
            || !number(shape.w, 1, 2000) || !number(shape.h, 1, 2000)) {
            throw new Error('图形类型、颜色、相对坐标或宽高不合法')
        }
    }

    return value as { shapes: CreateShapeParameters[] }
}

/** 校验完整 tool_call；流式分片或未知工具不进入本地执行器。 */
export function validateCreateCall(value: unknown): CreateToolCall {
    record(value)
    record(value.function)
    fields(value, ['id', 'type', 'function'])
    fields(value.function, ['name', 'arguments'])

    if (typeof value.id !== 'string' || !value.id || value.id.length > 200
        || value.type !== 'function' || value.function.name !== 'create_shapes'
        || typeof value.function.arguments !== 'string' || value.function.arguments.length > 10000) {
        throw new Error('新增工具调用格式不合法')
    }

    return value as CreateToolCall
}

export function validateCreateOutput(value: unknown): CreateToolOutput {
    record(value)

    if (value.ok === false) {
        fields(value, ['ok', 'error'])

        if (typeof value.error !== 'string' || !value.error || value.error.length > 1000) {
            throw new Error('工具错误结果不合法')
        }

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
