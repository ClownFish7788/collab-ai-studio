import { eventOutcome, type ErrorCategory, type TraceOutcome } from './outcomes'

export type TraceSummary = {
    id: string; kind: string; userId: string | null; roomId: string | null; model: string; prompt: string;
    status: string; durationMs: number | null; createdAt: string
    errorCount?: number
}
export type TraceEvent = { id: string; type: string; data: string; durationMs: number | null; createdAt: string; sequence: number;
    source?: string; outcome?: TraceOutcome | 'unknown'; errorCategory?: ErrorCategory | null; errorCode?: string | null }
export type TraceDetail = TraceSummary & { input: string; reply: string | null; error: string | null; events: TraceEvent[] }
export type FlowNode = {
    id: string; kind: 'input' | 'model' | 'tool' | 'validation' | 'operation' | 'result'; label: string;
    status: string; eventIds: string[]; durationMs?: number | null
}
export const statusLabels: Record<string, string> = {
    running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消', timed_out: '已超时', interrupted: '状态未回写', unknown: '未分类',
}
export const eventLabels: Record<string, string> = {
    model_request: '模型请求', model_response: '模型响应', model_error: '模型请求失败',
    tool_call: '工具调用', tool_result: '工具结果', tool_error: '工具未完成', tool_validation_error: '参数校验', run_error: '任务错误',
    operation_result: '操作结果', run_result: '任务结果',
}
export const operationLabels: Record<string, string> = {
    authentication: '身份认证', request_validation: '请求校验', access: '权限复核', rate_limit: '限流检查', configuration: '服务配置',
    run_start: '启动任务', stream_open: '响应流建立', model_call: '模型校验', tool_validation: '工具参数校验',
    task_preparation: '需求拆分', preparation_format: '准备阶段输出格式', element_preparation: '元素预处理',
    result_submit: '结果回传', stream_receive: '接收任务结果', draft_apply: '应用草稿', draft_discard: '放弃草稿', request: '请求处理',
}
export const outcomeLabels: Record<string, string> = { pending: '待完成', success: '成功', error: '失败', cancelled: '已中止', unknown: '未分类' }

export function traceEventOutcome(event: TraceEvent) {
    const inferred = eventOutcome(event.type, readTraceData(event.data))
    return { ...inferred, outcome: event.outcome && event.outcome !== 'unknown' ? event.outcome : inferred.outcome,
        errorCategory: event.errorCategory ?? inferred.errorCategory, errorCode: event.errorCode ?? inferred.errorCode }
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
    let hasResult = false
    for (const event of trace.events) {
        const data = readTraceData(event.data)
        const outcome = traceEventOutcome(event)
        const status = outcome.errorCategory === 'timeout' ? 'timed_out' : outcome.outcome === 'success' ? 'completed'
            : outcome.outcome === 'error' ? 'failed' : outcome.outcome === 'cancelled' ? 'cancelled' : 'running'
        if (event.type === 'run_result') {
            hasResult = true
            nodes.push({ id: event.id, kind: 'result', label: '运行结果', status: typeof data.status === 'string' ? data.status : status, eventIds: [event.id], durationMs: event.durationMs })
            continue
        }
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
            if (node) { node.eventIds.push(event.id); node.status = status; node.durationMs = event.durationMs }
            else nodes.push({ id: event.id, kind: model ? 'model' : 'tool', label: eventLabels[event.type], status, eventIds: [event.id], durationMs: event.durationMs })
        } else nodes.push({ id: event.id, kind: event.type === 'tool_validation_error' || event.type === 'run_error' ? 'validation' : 'operation',
            label: event.type === 'operation_result' ? operationLabels[String(data.operation)] ?? '操作结果' : event.type === 'tool_validation_error' && data.willRetry ? '参数纠错' : eventLabels[event.type] ?? event.type,
            status, eventIds: [event.id], durationMs: event.durationMs })
    }
    const status = traceStatus(trace)
    for (const node of nodes) if (node.status === 'running' && status !== 'running') node.status = 'interrupted'
    if (!hasResult) nodes.push({ id: 'result', kind: 'result', label: status === 'running' ? '等待任务结束' : '运行结果', status, eventIds: [], durationMs: trace.durationMs })
    return nodes
}
