import { startAgentTrace } from './agentTrace'
import { classifyTraceError } from '../utils/agent-traces/outcomes'

export type AgentTrace = Awaited<ReturnType<typeof startAgentTrace>>

/** 入口先建记录，再执行校验；否则模型启动之前的拒绝请求永远不会进入后台。 */
export async function traceAgentRequest(request: Request, kind: 'chat' | 'board', handler: (trace: AgentTrace) => Promise<Response>) {
    const trace = await startAgentTrace({ id: crypto.randomUUID(), kind, model: process.env.BASE_MODEL?.trim() || 'unconfigured',
        prompt: '', input: { method: request.method, path: new URL(request.url).pathname } })
    try {
        const response = await handler(trace)
        response.headers.set('X-Agent-Trace-Id', trace.id)
        if (response.status >= 400) {
            const body = await response.clone().json().catch(() => null)
            const operation = response.status === 401 ? 'authentication' : response.status === 403 ? 'access'
                : response.status === 429 ? 'rate_limit' : response.status === 500 ? 'configuration'
                    : response.status === 409 ? 'stream_receive' : response.status >= 502 ? 'model_fetch' : 'request_validation'
            const error = trace.failure ?? classifyTraceError({ message: typeof body?.error === 'string' ? body.error : '请求未通过',
                ...(response.status === 504 ? { name: 'TimeoutError' } : response.status === 499 ? { name: 'AbortError' } : {}) }, { operation, httpStatus: response.status })
            if (!trace.failure) await trace.record('operation_result', { operation, outcome: error.category === 'cancelled' ? 'cancelled' : 'error', error })
            await trace.end(error.category === 'cancelled' ? 'cancelled' : error.category === 'timeout' ? 'timed_out' : 'failed', undefined, error.message)
        } else await trace.record('operation_result', { operation: 'stream_open', outcome: 'success', httpStatus: response.status })
        return response
    } catch (cause) {
        const status = cause && typeof cause === 'object' && 'status' in cause && (cause.status === 401 || cause.status === 403) ? cause.status : 500
        const error = trace.failure ?? classifyTraceError(cause, { operation: status === 401 ? 'authentication' : status === 403 ? 'access' : 'request', signal: request.signal })
        if (!trace.failure) await trace.record('operation_result', { operation: 'request', outcome: error.category === 'cancelled' ? 'cancelled' : 'error', error })
        await trace.end(error.category === 'cancelled' ? 'cancelled' : error.category === 'timeout' ? 'timed_out' : 'failed', undefined, error.message)
        return Response.json({ error: status === 401 ? '请先登录后再聊天' : status === 403 ? '当前没有操作权限' : 'AI 请求处理失败，请稍后重试' }, { status: request.signal.aborted ? 499 : status, headers: { 'X-Agent-Trace-Id': trace.id } })
    }
}
