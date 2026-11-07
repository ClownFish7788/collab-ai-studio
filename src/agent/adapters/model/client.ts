import OpenAI from 'openai'

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

export function createModelClient(config: ModelConfig, fetcher: typeof fetch = fetch) {
    return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, fetch: fetcher, maxRetries: 0 })
}

/** 不暴露 SDK 的响应正文或 status，避免厂商鉴权失败被误判为用户无白板权限。 */
export class ModelRequestError extends Error {
    constructor(readonly httpStatus?: number) {
        super(httpStatus ? `模型服务请求失败（HTTP ${httpStatus}）` : '模型服务连接失败')
        this.name = 'ModelRequestError'
    }
}

type CompletionInput = Pick<OpenAI.ChatCompletionCreateParamsStreaming,
    'messages' | 'tools' | 'tool_choice' | 'parallel_tool_calls'> & { outputLimit: number }

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
        throw new ModelRequestError(cause instanceof OpenAI.APIError ? cause.status : undefined)
    }
}
