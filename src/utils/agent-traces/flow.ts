export type TraceSummary = {
    id: string; kind: string; userId: string | null; roomId: string | null; model: string; prompt: string;
    status: string; durationMs: number | null; createdAt: string
}
export type TraceEvent = { id: string; type: string; data: string; durationMs: number | null; createdAt: string; sequence: number }
export type TraceDetail = TraceSummary & { input: string; reply: string | null; error: string | null; events: TraceEvent[] }
export type FlowNode = {
    id: string; kind: 'input' | 'model' | 'tool' | 'validation' | 'result'; label: string;
    status: string; eventIds: string[]; durationMs?: number | null
}
export const statusLabels: Record<string, string> = {
    running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', timed_out: '已超时', interrupted: '状态未回写',
}
export const eventLabels: Record<string, string> = {
    model_request: '模型请求', model_response: '模型响应', model_error: '模型请求失败',
    tool_call: '工具调用', tool_result: '工具结果', tool_error: '工具未完成', tool_validation_error: '参数校验', run_error: '任务错误',
}
const toolLabels: Record<string, string> = {
    get_board_snapshot: '读取白板快照', ask_user: '询问用户', create_shapes: '新增草稿', update_shapes: '更新草稿', delete_shapes: '删除草稿',
}

export function readTraceData(raw: string): Record<string, unknown> {
    try {
        const value = JSON.parse(raw)
        return value && typeof value === 'object' && !Array.isArray(value) ? value : { value }
    } catch { return { raw } }
}

export function traceStatus(trace: Pick<TraceSummary, 'status' | 'createdAt'>, now = Date.now()) {
    // 进程崩溃无法回写结束事件，旧任务不能一直显示为正在执行。
    return trace.status === 'running' && now - Date.parse(trace.createdAt) > 120000 ? 'interrupted' : trace.status
}

/** 按真实调用 ID 配对，不按工具名称推测缺失步骤。 */
export function buildTraceFlow(trace: TraceDetail): FlowNode[] {
    const nodes: FlowNode[] = [{ id: 'input', kind: 'input', label: '用户输入', status: 'completed', eventIds: [] }]
    const pending = new Map<string, FlowNode>()
    for (const event of trace.events) {
        const data = readTraceData(event.data)
        if (event.type === 'model_request' || event.type === 'tool_call') {
            const call = data.call as { id?: string; function?: { name?: string } } | undefined
            const model = event.type === 'model_request'
            const node: FlowNode = { id: event.id, kind: model ? 'model' : 'tool', label: model ? '模型调用' : toolLabels[call?.function?.name ?? ''] ?? '工具调用',
                status: 'running', eventIds: [event.id] }
            pending.set(`${model ? 'model' : 'tool'}:${model ? data.requestId : call?.id}`, node)
            nodes.push(node)
        } else if (['model_response', 'model_error', 'tool_result', 'tool_error'].includes(event.type)) {
            const model = event.type.startsWith('model_')
            const node = pending.get(`${model ? 'model' : 'tool'}:${model ? data.requestId : data.callId}`)
            const failed = event.type.endsWith('error') || (data.output as { ok?: boolean } | undefined)?.ok === false
            const status = failed ? 'failed' : typeof data.status === 'string' ? data.status : 'completed'
            if (node) { node.eventIds.push(event.id); node.status = status; node.durationMs = event.durationMs }
            else nodes.push({ id: event.id, kind: model ? 'model' : 'tool', label: eventLabels[event.type], status, eventIds: [event.id], durationMs: event.durationMs })
        } else nodes.push({ id: event.id, kind: 'validation', label: event.type === 'tool_validation_error' && data.willRetry ? '参数纠错' : eventLabels[event.type] ?? event.type,
            status: 'failed', eventIds: [event.id], durationMs: event.durationMs })
    }
    const status = traceStatus(trace)
    for (const node of nodes) if (node.status === 'running' && status !== 'running') node.status = 'interrupted'
    nodes.push({ id: 'result', kind: 'result', label: status === 'running' ? '等待任务结束' : '运行结果', status, eventIds: [], durationMs: trace.durationMs })
    return nodes
}
