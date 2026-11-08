import { runAgent } from '../../application/runAgent'
import { AgentApplicationError, type ModelPort } from '../../application/ports'
import { agentErrorSchema, ERROR_CODES, type AgentError } from '../../domain/error'
import type { AgentMessage, ContentBlock } from '../../domain/message'
import { jsonValueSchema } from '../../domain/data'
import { toolCallProposalSchema } from '../../domain/invocation'
import { boardCreatePrompt } from '../../../prompts/boardCreatePrompt'
import { boardToolContracts } from '../board/contracts'
import { validateToolProperties } from '../board/nativeValidation'
import { formatTaskBrief, formatElementTable } from '../presentation/boardPlan'
import { validateMutationOutput, type BoardCreateEvent, type BoardCreateRequest } from '../transport/boardProtocol'
import { BoardProtocolError } from '../transport/errors'
import type { TraceRecorder } from '../../../lib/modelTrace'
import { toAgentSnapshot, toBoardToolCall } from '../board/protocol'
import { createBrowserToolExecutor, releaseCreateRun, type CreateRun } from './browserExecutor'

/** 组装真实端口并转换旧传输协议；应用主循环只存在于 runAgent。 */
export async function runBoardAgent(
    run: CreateRun,
    request: BoardCreateRequest,
    model: ModelPort,
    emit: (event: BoardCreateEvent) => void | Promise<void>,
    checkAccess: () => Promise<void>,
    waitMs = 15000,
    record: TraceRecorder = async () => {},
) {
    try {
        const blocks = (text: string, source: 'user' | 'assistant', images?: string[]): ContentBlock[] => [
            ...(text.trim() ? [{ type: 'text' as const, source, text }] : []),
            ...(images?.map(url => ({ type: 'image' as const, source, url })) ?? []),
        ]
        const initialSnapshot = request.snapshot ? toAgentSnapshot(request.snapshot) : undefined
        const messages: AgentMessage[] = [
            { role: 'system', content: [{ type: 'text', source: 'system', text: boardCreatePrompt }] },
            ...(request.history ?? []).flatMap((turn): AgentMessage[] => [
                { role: 'user', content: blocks(turn.prompt, 'user', turn.images) },
                { role: 'assistant', content: blocks(turn.reply, 'assistant') },
            ]),
            { role: 'user', content: [...blocks(request.prompt, 'user', request.images),
                ...(initialSnapshot ? [{ type: 'data' as const, source: 'user' as const, data: jsonValueSchema.parse(JSON.parse(JSON.stringify({ snapshot: initialSnapshot }))) }] : []),
            ] },
        ]
        const mapError = (cause: unknown): AgentError => {
            if (cause instanceof BoardProtocolError || cause instanceof AgentApplicationError) return cause.detail
            if (cause instanceof Error && 'status' in cause && (cause.status === 401 || cause.status === 403)) return { code: ERROR_CODES.ACCESS_DENIED, message: cause.message }
            return { code: ERROR_CODES.TASK_FAILED, message: '后端白板任务失败，已完成的内容仅保留在草稿中' }
        }
        // 领域结局只携带安全诊断，原始超时/权限异常留在适配层供路由准确分类。
        let runtimeFailure: unknown
        const outcome = await runAgent({ runId: run.id, messages, initialSnapshot }, {
            tools: boardToolContracts, validate: validateToolProperties, signal: run.signal, mapError,
            checkAccess: async () => {
                try { await checkAccess() } catch (cause) { runtimeFailure = cause; throw cause }
            },
            model,
            emit: event => {
                if (event.type === 'started') return emit({ type: 'started', runId: run.id })
                const table = event.prepared ? formatElementTable(event.prepared.elements, toBoardToolCall(event.prepared.call, event.prepared.input)) : ''
                return emit({ type: 'plan', runId: run.id, text: [formatTaskBrief(event.task), table].filter(Boolean).join('\n\n') })
            },
            record: (type, data, duration) => {
                if (type === 'tool_result' && data.result && typeof data.result === 'object' && 'state' in data.result) {
                    const result = data.result
                    return record(type, { callId: data.callId, output: result.state === 'known' && 'output' in result ? result.output
                        : { ok: false, state: result.state, error: 'error' in result ? result.error : undefined } }, duration)
                }
                const transformed = { ...data }
                for (const key of ['call', 'modelCall']) {
                    const parsed = toolCallProposalSchema.safeParse(data[key])
                    if (parsed.success) transformed[key] = toBoardToolCall(parsed.data, key === 'call' ? data.input ?? parsed.data.input : parsed.data.input)
                }
                return record(type, transformed, duration)
            },
            execute: createBrowserToolExecutor({ run, emit, mapError, waitMs, record,
                onFailure: cause => { runtimeFailure = cause },
            }),
        })
        if (outcome.status === 'completed') await emit({ type: 'completed', runId: run.id, text: outcome.text, results: outcome.changes.map(({ callId, output }) => ({ callId, output: validateMutationOutput(output) })) })
        else throw runtimeFailure ?? new BoardProtocolError(agentErrorSchema.parse(outcome.error))
        return outcome
    } finally {
        await releaseCreateRun(run)
    }
}
