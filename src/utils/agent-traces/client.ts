export const clientOperations = ['stream_receive', 'tool_execute', 'result_submit', 'draft_apply', 'draft_discard'] as const
export type ClientOperation = typeof clientOperations[number]
export type ClientTraceEvent = {
    operation: ClientOperation; outcome: 'success' | 'error' | 'cancelled'; durationMs?: number
    error?: { name?: string; message: string; code?: string; stack?: string }
}

/** 浏览器只报告有限的操作结果，不能提交服务端状态、用户身份或错误分类。 */
export function parseClientTraceEvent(value: unknown): ClientTraceEvent {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('事件格式错误')
    const data = value as Record<string, unknown>
    if (Object.keys(data).some(key => !['operation', 'outcome', 'durationMs', 'error'].includes(key))
        || !clientOperations.includes(data.operation as ClientOperation) || !['success', 'error', 'cancelled'].includes(String(data.outcome))) throw new Error('操作或结果不合法')
    if (data.durationMs !== undefined && (!Number.isInteger(data.durationMs) || Number(data.durationMs) < 0 || Number(data.durationMs) > 600000)) throw new Error('耗时不合法')
    if (data.error !== undefined) {
        if (!data.error || typeof data.error !== 'object' || Array.isArray(data.error) || data.outcome === 'success') throw new Error('错误信息不合法')
        const error = data.error as Record<string, unknown>
        if (Object.keys(error).some(key => !['name', 'message', 'code', 'stack'].includes(key)) || typeof error.message !== 'string' || error.message.length > 1000) throw new Error('错误信息不合法')
        for (const key of ['name', 'code', 'stack']) if (error[key] !== undefined && (typeof error[key] !== 'string' || error[key].length > (key === 'stack' ? 2000 : 100))) throw new Error('诊断信息不合法')
    }
    return data as ClientTraceEvent
}

/** 独立的短请求，不沿用已经取消的任务信号；上报失败不能影响白板或递归上报。 */
export async function reportAgentOperation(id: string | undefined, operation: ClientOperation, outcome: ClientTraceEvent['outcome'], cause?: unknown, durationMs?: number, fetcher: typeof fetch = fetch) {
    if (!id) return
    const detail = cause && typeof cause === 'object' && 'detail' in cause ? cause.detail as { code?: string; message?: string } : undefined
    const code = detail?.code ?? (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined)
    const error = cause instanceof Error ? { name: cause.name.slice(0, 100), message: (detail?.message ?? cause.message).slice(0, 1000),
        ...(code ? { code: code.slice(0, 100) } : {}), stack: cause.stack?.slice(0, 2000) } : { message: '浏览器操作未完成' }
    try {
        await fetcher(`/api/agent-traces/${encodeURIComponent(id)}/events`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, signal: AbortSignal.timeout(3000),
            body: JSON.stringify({ operation, outcome, ...(durationMs === undefined ? {} : { durationMs: Math.min(600000, durationMs) }), ...(outcome === 'success' ? {} : { error }) }),
        })
    } catch { /* 离线或页面退出时保持 best effort；不能让诊断通道阻塞用户操作。 */ }
}
