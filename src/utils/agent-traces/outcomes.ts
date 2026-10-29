export const errorCategories = {
    validation: '参数校验', authentication: '身份认证', permission: '访问权限', rate_limit: '请求限流',
    configuration: '服务配置', network: '网络连接', timeout: '超时', cancelled: '用户取消',
    model: '模型响应', tool: '工具执行', protocol: '通信协议', draft: '草稿操作', storage: '日志与数据存储', internal: '内部异常',
} as const
export type ErrorCategory = keyof typeof errorCategories
export type TraceOutcome = 'pending' | 'success' | 'error' | 'cancelled'
export type TraceFailure = { category: ErrorCategory; code: string; message: string; diagnostic?: { name?: string; code?: string; stack?: string }; issues?: unknown }

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const operationCategories: Record<string, ErrorCategory> = {
    request_validation: 'validation', tool_validation: 'validation', authentication: 'authentication', access: 'permission',
    rate_limit: 'rate_limit', configuration: 'configuration', model_fetch: 'network', model_call: 'model', model_response: 'model',
    tool_execute: 'tool', result_submit: 'protocol', stream_receive: 'protocol', draft_apply: 'draft', draft_discard: 'draft', storage: 'storage',
}
const protocolCategories: Record<string, ErrorCategory> = {
    INVALID_ARGUMENTS: 'validation', INVALID_MODEL_RESPONSE: 'model', EXECUTION_FAILED: 'tool', ACCESS_DENIED: 'permission', TASK_INACTIVE: 'cancelled',
}

/** 分类依赖稳定的阶段和错误码，不根据可能变化的提示文案猜测原因。 */
export function classifyTraceError(cause: unknown, context: { operation: string; signal?: AbortSignal; httpStatus?: number }): TraceFailure {
    const original = object(cause)
    const root = object(original.cause)
    const detail = Object.keys(object(original.detail)).length ? object(original.detail) : original
    const reason = object(context.signal?.reason)
    const code = typeof detail.code === 'string' ? detail.code : typeof root.code === 'string' ? root.code : undefined
    let category: ErrorCategory = operationCategories[context.operation] ?? 'internal'
    if (code && protocolCategories[code]) category = protocolCategories[code]
    if (typeof detail.category === 'string' && Object.hasOwn(errorCategories, detail.category)) category = detail.category as ErrorCategory
    if (typeof original.name === 'string' && original.name.startsWith('Prisma') || code && /^P\d{4}$/.test(code)) category = 'storage'
    if (context.httpStatus === 429) category = 'rate_limit'
    else if (context.httpStatus === 401 || context.httpStatus === 403) category = context.operation === 'model_fetch' ? 'configuration' : context.httpStatus === 401 ? 'authentication' : 'permission'
    if (original.name === 'TimeoutError' || reason.name === 'TimeoutError') category = 'timeout'
    else if (original.name === 'AbortError' || context.signal?.aborted) category = 'cancelled'
    return {
        category,
        code: code ?? (context.httpStatus ? `${context.operation.toUpperCase()}_HTTP_${context.httpStatus}` : `${context.operation.toUpperCase()}_${category === 'cancelled' ? 'CANCELLED' : 'FAILED'}`),
        message: typeof detail.message === 'string' ? detail.message.slice(0, 2000) : context.httpStatus ? `操作返回 HTTP ${context.httpStatus}` : '操作失败',
        ...(cause instanceof Error ? { diagnostic: { name: cause.name, ...(code ? { code } : {}), stack: cause.stack?.slice(0, 4000) } } : {}),
        ...(detail.issues ? { issues: detail.issues } : {}),
    }
}

/** 旧事件也统一补齐结果；开始事件保持 pending，不把“已发起”算作执行成功。 */
export function eventOutcome(type: string, value: unknown): { outcome: TraceOutcome; errorCategory?: ErrorCategory; errorCode?: string; failure?: TraceFailure } {
    const data = object(value)
    const failedOutput = object(data.output).ok === false || data.ok === false
    const operation = typeof data.operation === 'string' ? data.operation : type.startsWith('model') ? type === 'model_error' ? 'model_fetch' : 'model_response'
        : type === 'tool_validation_error' ? 'tool_validation' : type.startsWith('tool') ? 'tool_execute' : 'unknown'
    let outcome: TraceOutcome = type === 'model_request' || type === 'tool_call' ? 'pending' : 'success'
    if (data.outcome === 'success' || data.outcome === 'error' || data.outcome === 'cancelled') outcome = data.outcome
    else if (data.status === 'cancelled') outcome = 'cancelled'
    else if (data.status === 'failed' || type.endsWith('_error') || failedOutput) outcome = 'error'
    if (outcome !== 'error' && outcome !== 'cancelled') return { outcome }
    const cause = data.failure ?? data.error ?? object(data.output).error ?? { message: data.message, ...(outcome === 'cancelled' ? { category: 'cancelled' } : {}) }
    const failure = classifyTraceError(cause, { operation, httpStatus: typeof data.httpStatus === 'number' ? data.httpStatus : undefined })
    return { outcome: failure.category === 'cancelled' ? 'cancelled' : 'error', errorCategory: failure.category, errorCode: failure.code, failure }
}
