import OpenAI, { APIError } from 'openai'

export type ModelConfig = {
    apiKey: string
    model: string
    baseUrl: string
    provider?: 'qwen' | 'openai'
}

export function readModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig | null {
    const apiKey = env.API_KEY?.trim(), model = env.BASE_MODEL?.trim(), baseUrl = env.BASE_URL?.trim()
    const provider = env.MODEL_PROVIDER?.trim() || 'qwen'
    if (!apiKey || !model || !baseUrl || provider !== 'qwen' && provider !== 'openai') return null
    return { apiKey, model, baseUrl, provider }
}

export function createModelClient(config: ModelConfig, signal: AbortSignal, fetcher: typeof fetch = fetch) {
    return new OpenAI({
        apiKey: config.apiKey, baseURL: config.baseUrl, maxRetries: 0,
        // SDK 的内部取消信号丢失 TimeoutError；合并原始信号以保留逐步 trace 的超时分类。
        fetch: (input, init) => fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }),
    })
}

/** 不暴露 SDK 的响应正文或 status，避免厂商鉴权失败被误判为用户无白板权限。 */
export class ModelRequestError extends Error {
    constructor(readonly httpStatus?: number, readonly reason: 'unsupported_output_format' | 'invalid_schema' | 'other' = 'other',
        readonly diagnostic?: { code?: string; param?: string; requestId?: string }) {
        super(httpStatus ? `模型服务请求失败（HTTP ${httpStatus}）` : '模型服务连接失败')
        this.name = 'ModelRequestError'
    }
}

type CompletionInput = Pick<OpenAI.ChatCompletionCreateParamsStreaming,
    'messages' | 'tools' | 'tool_choice' | 'parallel_tool_calls' | 'response_format'> & { outputLimit: number }

function outputFailure(cause: APIError, format: CompletionInput['response_format']): ModelRequestError['reason'] {
    if (!format || format.type === 'text' || ![400, 422].includes(cause.status ?? 0)) return 'other'
    const detail = cause.error as { message?: unknown } | undefined
    const message = typeof detail?.message === 'string' ? detail.message.slice(0, 2000).toLowerCase() : ''
    if (cause.code === 'invalid_json_schema' || cause.param?.startsWith('response_format.json_schema.schema')
        || /invalid (?:json )?schema/.test(message)) return 'invalid_schema'
    // 组合冲突和提示词缺失都可能是 400，不能外推为模型整体不支持该格式。
    if (/thinking|stream|tools?|strict|messages?|prompts?/.test(message)) return 'other'
    if (cause.param && cause.param !== 'response_format' && cause.param !== 'response_format.type') return 'other'
    const identifiesFormat = message.includes('response_format') && (message.includes(format.type)
        || cause.code === 'unsupported_parameter' && cause.param === 'response_format')
    // 只认可明确的格式/模型拒绝；未知 400、通用 InvalidParameter 和模糊 unavailable 均保留失败。
    return identifiesFormat && /(?:not supported (?:with|by|for) (?:this |the )?model|model does not support|unsupported parameter)/.test(message)
        ? 'unsupported_output_format' : 'other'
}

function diagnosticIdentifier(value: unknown, apiKey: string) {
    return typeof value === 'string' && /^[\w.:-]{1,100}$/.test(value) && !value.includes(apiKey) ? value : undefined
}

/** 保留原始响应及现有有界解析；重试与总超时仍由调用方控制。 */
export async function requestCompletion(client: OpenAI, config: ModelConfig, input: CompletionInput, signal: AbortSignal): Promise<Response> {
    signal.throwIfAborted()
    const { outputLimit, ...body } = input
    const parameters = config.provider === 'openai'
        ? { max_completion_tokens: outputLimit }
        : { enable_thinking: false, max_tokens: outputLimit }
    try {
        return await client.chat.completions.create({ ...body, ...parameters, model: config.model, stream: true }, { signal }).asResponse()
    } catch (cause) {
        signal.throwIfAborted()
        if (!(cause instanceof OpenAI.APIError)) throw new ModelRequestError()
        // 原始正文不附在异常上；仅保留有界标识符供内部 trace 使用。
        throw new ModelRequestError(cause.status, outputFailure(cause, input.response_format), {
            code: diagnosticIdentifier(cause.code, config.apiKey), param: diagnosticIdentifier(cause.param, config.apiKey),
            requestId: diagnosticIdentifier(cause.requestID, config.apiKey),
        })
    }
}
