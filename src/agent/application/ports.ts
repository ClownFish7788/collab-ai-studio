import { z } from 'zod'
import { agentErrorSchema, ERROR_CODES, type AgentError, type ValidationIssue } from '../domain/error'
import type { AgentContext } from '../domain/context'
import type { JsonValue } from '../domain/data'
import type { BoardElementRow } from '../domain/elements'
import type { ToolCall } from '../domain/invocation'
import type { AgentMessage } from '../domain/message'
import type { TaskBrief } from '../domain/task'
import type { SyntaxProblem } from '../domain/syntaxRepair'
import type { BoardToolContracts, BoardToolName } from '../domain/tool'

export const MAX_BOARD_WRITES_PER_TASK = 3
export const MAX_BOARD_ASK_CALLS = 3
export const MAX_BOARD_SYNTAX_REPAIRS = 2
export const MAX_BOARD_TOOL_CALLS = 6
export const MAX_BOARD_MODEL_CALLS = 20
export const MAX_BOARD_ELEMENT_TABLE_CHARS = 6000
export const BOARD_RUN_TIMEOUT_MS = 180000
export const BOARD_ANSWER_TIMEOUT_MS = 120000

/** 准备返回完整文本，由用例解析需求；执行返回完整决策，供应商分片不进入应用层。 */
export type ModelPort = {
    prepare(messages: readonly AgentMessage[], signal: AbortSignal): Promise<string>
    next(context: AgentContext, allowedTools: readonly BoardToolName[], signal: AbortSignal): Promise<unknown>
    repairSyntax(problem: SyntaxProblem, signal: AbortSignal): Promise<string>
}

/** call 保留模型意图供结果核对；input 是移除元数据、补全类型后的实际执行参数。 */
export type PreparedTool = { call: ToolCall; input: JsonValue; elements: BoardElementRow[]; isFinal?: boolean }
export type ValidationResult = { ok: true; prepared: PreparedTool } | { ok: false; error: AgentError }
/** 只读能力校验；未知目标类型不得猜测，不能派发工具或修改草稿。 */
export type ToolValidationPort = (call: ToolCall, observedTypes: ReadonlyMap<string, string>) => readonly ValidationIssue[]
/** 派发前拒绝须返回 not_executed；派发后无法确认结果须返回 unknown，不能推断没有副作用。 */
export type ToolExecutorPort = (prepared: PreparedTool, signal: AbortSignal) => Promise<unknown>
export type AgentEvent = { type: 'started' } | { type: 'plan'; task: TaskBrief; prepared?: PreparedTool }
export type AgentRecord = (type: string, data: Record<string, unknown>, durationMs?: number) => Promise<void>
export type AgentDependencies = {
    tools: BoardToolContracts
    model: ModelPort
    validate: ToolValidationPort
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
    // 类型不符时，同字段的长度检查没有意义，避免把数组项数误报成字符串长度。
    const invalidTypes = new Set(error.issues.filter(issue => issue.code === 'invalid_type').map(issue => JSON.stringify(issue.path)))
    const issues = error.issues.filter(issue => issue.code === 'invalid_type' || !invalidTypes.has(JSON.stringify(issue.path)))
    return new AgentApplicationError({ code, message, issues: issues.slice(0, 40).map(issue => ({
        path: (issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('') || 'input')
            .replace(/[^\w.[\]]/g, '_').slice(0, 100),
        message: issue.code === 'invalid_type' && issue.expected === 'array'
            ? '必须直接提交 JSON 数组 [...]，不能把数组编码成字符串；数组项须符合该字段 schema。' : issue.message.slice(0, 200),
    })) })
}

export function applicationError(cause: unknown, dependencies: Pick<AgentDependencies, 'mapError'>): AgentError {
    if (cause instanceof AgentApplicationError) return cause.detail
    return dependencies.mapError ? agentErrorSchema.parse(dependencies.mapError(cause))
        : { code: ERROR_CODES.TASK_FAILED, message: '白板任务失败，已确认的修改保留在草稿中' }
}
