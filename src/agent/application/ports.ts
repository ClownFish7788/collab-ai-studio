import { z } from 'zod'
import { agentErrorSchema, ERROR_CODES, type AgentError } from '../domain/error'
import type { AgentContext } from '../domain/context'
import type { JsonValue } from '../domain/data'
import type { BoardElementRow } from '../domain/elements'
import type { ToolCall } from '../domain/invocation'
import type { AgentMessage } from '../domain/message'
import type { TaskBrief } from '../domain/task'
import type { BoardToolContracts, BoardToolName } from '../domain/tool'

export const MAX_BOARD_WRITES_PER_TASK = 3
export const MAX_BOARD_TOOL_CALLS = 6
export const MAX_BOARD_MODEL_CALLS = 20
export const MAX_BOARD_ELEMENT_TABLE_CHARS = 6000
export const BOARD_RUN_TIMEOUT_MS = 180000
export const BOARD_ANSWER_TIMEOUT_MS = 120000

/** 模型适配器只返回完整决策；unknown 由用例入口校验，供应商分片不进入应用层。 */
export type ModelPort = {
    prepare(messages: readonly AgentMessage[], signal: AbortSignal): Promise<unknown>
    next(context: AgentContext, allowedTools: readonly BoardToolName[], signal: AbortSignal): Promise<unknown>
}

/** call 保留模型意图供结果核对；input 是移除元数据、补全类型后的实际执行参数。 */
export type PreparedTool = { call: ToolCall; input: JsonValue; elements: BoardElementRow[]; isFinal?: boolean }
/** 派发前拒绝须返回 not_executed；派发后无法确认结果须返回 unknown，不能推断没有副作用。 */
export type ToolExecutorPort = (prepared: PreparedTool, signal: AbortSignal) => Promise<unknown>
export type AgentEvent = { type: 'started' } | { type: 'plan'; task: TaskBrief; prepared?: PreparedTool }
export type AgentRecord = (type: string, data: Record<string, unknown>, durationMs?: number) => Promise<void>
export type AgentDependencies = {
    tools: BoardToolContracts
    model: ModelPort
    execute: ToolExecutorPort
    signal: AbortSignal
    checkAccess(): Promise<void>
    emit?(event: AgentEvent): void | Promise<void>
    record?: AgentRecord
    mapError?(cause: unknown): AgentError
}
export type RunAgentInput = Pick<AgentContext, 'runId' | 'messages' | 'initialSnapshot'>

/** 应用内部的可恢复错误携带稳定领域诊断，外部异常正文不直接反馈给模型。 */
export class AgentApplicationError extends Error {
    readonly detail: AgentError
    constructor(detail: AgentError) { super(detail.message); this.detail = agentErrorSchema.parse(detail) }
}

export function validationFailure(error: z.ZodError, code: ERROR_CODES, message: string): AgentApplicationError {
    return new AgentApplicationError({ code, message, issues: error.issues.slice(0, 40).map(issue => ({
        path: (issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('') || 'input')
            .replace(/[^\w.[\]]/g, '_').slice(0, 100),
        message: issue.message.slice(0, 200),
    })) })
}

export function applicationError(cause: unknown, dependencies: Pick<AgentDependencies, 'mapError'>): AgentError {
    if (cause instanceof AgentApplicationError) return cause.detail
    return dependencies.mapError ? agentErrorSchema.parse(dependencies.mapError(cause))
        : { code: ERROR_CODES.TASK_FAILED, message: '白板任务失败，已确认的修改保留在草稿中' }
}
