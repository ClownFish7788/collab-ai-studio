import { createAgentContextSchema, getObservedContextState, type AgentContext } from '../domain/context'
import { assertElementTargets, getUncoveredTaskObjects } from '../domain/elements'
import { ERROR_CODES, type AgentError } from '../domain/error'
import type { MutationResult, ToolCallProposal, ToolResult } from '../domain/invocation'
import { createToolResultMessage, modelDecisionSchema } from '../domain/message'
import { createAgentOutcomeSchema, type AgentOutcome } from '../domain/outcome'
import { applicationError, AgentApplicationError, MAX_BOARD_MODEL_CALLS, MAX_BOARD_TOOL_CALLS, MAX_BOARD_WRITES_PER_TASK, validationFailure, type AgentDependencies, type RunAgentInput } from './ports'
import { prepareTask } from './prepareTask'
import { createToolRegistry } from './toolRegistry'
import { resolveToolCorrection, toolCorrectionHints } from './toolCorrection'

/** 用例仅编排领域数据；模型协议、浏览器等待、权限来源和 trace 持久化均由端口提供。 */
export async function runAgent(input: RunAgentInput, dependencies: AgentDependencies): Promise<AgentOutcome> {
    const tools = createToolRegistry(dependencies.tools, dependencies.execute, dependencies.validate)
    const contextSchema = createAgentContextSchema(tools.invocations)
    const outcomeSchema = createAgentOutcomeSchema(tools.invocations.mutationResultSchema)
    const changes: MutationResult[] = [], uncertainCalls: { id: string; name: ToolCallProposal['name'] }[] = []
    const covered = new Set<string>()
    const counts = { get_board_snapshot: 0, get_board_screenshot: 0, ask_user: 0 }
    let context: AgentContext
    const unresolvedErrors = new Map<string, { name: ToolCallProposal['name']; error: AgentError }>()
    const pendingCorrections = new Set<string>()
    let finalRequested = false, argumentCorrectionUsed = false
    const fail = (message: string): never => { throw new AgentApplicationError({ code: ERROR_CODES.INVALID_ARGUMENTS, message }) }
    const assertActive = async () => { dependencies.signal.throwIfAborted(); await dependencies.checkAccess(); dependencies.signal.throwIfAborted() }
    const finish = (text: string): AgentOutcome => outcomeSchema.parse({ status: 'completed', text, changes, uncertainCalls })

    try {
        context = contextSchema.parse({ runId: input.runId, messages: input.messages, initialSnapshot: input.initialSnapshot, toolResults: [] })
        await dependencies.emit?.({ type: 'started' })
        const preparation = await prepareTask(context.messages, dependencies)
        if (preparation.kind === 'reply') return finish(preparation.text)
        context = contextSchema.parse({ ...context, task: preparation.brief, messages: [...context.messages,
            { role: 'assistant', content: [{ type: 'data', source: 'assistant', data: { taskBrief: preparation.brief } }] },
        ] })
        await dependencies.emit?.({ type: 'plan', task: preparation.brief })

        const finishTask = (text: string): AgentOutcome => {
            const error = [...unresolvedErrors.values()].at(-1)?.error
            if (error) throw new AgentApplicationError(error)
            if (uncertainCalls.length) throw new AgentApplicationError({ code: ERROR_CODES.TASK_FAILED, message: '仍有写入结果未知，不能确认任务完成' })
            const missing = changes.length ? getUncoveredTaskObjects(preparation.brief, covered, []) : []
            if (missing.length) throw new AgentApplicationError({ code: ERROR_CODES.TASK_FAILED,
                message: `任务尚未完成，以下对象没有成功执行记录：${missing.map(object => object.key).join('、')}`.slice(0, 1000),
                issues: missing.map(object => ({ path: `brief.objects[${preparation.brief.objects.findIndex(item => item.key === object.key)}].key`,
                    message: `需求对象 "${object.key}" 尚无成功执行记录` })),
            })
            return finish(text)
        }

        for (let step = 0; step < MAX_BOARD_MODEL_CALLS; step++) {
            await assertActive()
            const { reference, observedTypes } = getObservedContextState(context)
            const allowed: ToolCallProposal['name'][] = []
            if (counts.get_board_snapshot < 2) allowed.push('get_board_snapshot')
            if (counts.get_board_screenshot < 2) allowed.push('get_board_screenshot')
            if (counts.ask_user < 1) allowed.push('ask_user')
            if (reference && !uncertainCalls.length && changes.length < MAX_BOARD_WRITES_PER_TASK) {
                allowed.push('create_shapes')
                if (observedTypes.size) allowed.push('update_shapes', 'delete_shapes')
            }
            const parsed = modelDecisionSchema.safeParse(await dependencies.model.next(context, allowed, dependencies.signal))
            dependencies.signal.throwIfAborted()
            if (!parsed.success) throw validationFailure(parsed.error, ERROR_CODES.INVALID_MODEL_RESPONSE, '模型决策格式不合法')
            const decision = parsed.data
            if (decision.kind === 'text') {
                return finishTask((changes.length ? decision.text : `本轮未执行白板修改。\n\n${decision.text}`).slice(0, 8000))
            }
            if (decision.calls.length > MAX_BOARD_TOOL_CALLS) fail('工具列表超过本轮上限')
            if (decision.calls.some(call => !allowed.includes(call.name))) fail('本轮工具未开放')
            const correctionErrors = new Map<string, AgentError>()
            const retries = new Map<string, string>()
            const calls = decision.calls.map(proposal => {
                try {
                    const resolved = resolveToolCorrection(proposal, context, pendingCorrections, dependencies.tools)
                    if (resolved.retryOf) retries.set(proposal.id, resolved.retryOf)
                    return resolved.proposal
                } catch (cause) {
                    if (!(cause instanceof AgentApplicationError)) throw cause
                    correctionErrors.set(proposal.id, cause.detail)
                    return proposal
                }
            })
            // 登记补全后的完整提议，执行结果必须与新 callId 下的完整参数核对。
            context = contextSchema.parse({ ...context, messages: [...context.messages, { role: 'assistant', content: decision.content?.trim()
                ? [{ type: 'text', source: 'assistant', text: decision.content }] : [], calls }] })
            let fatal: unknown
            let batchFailed = false
            let argumentError: AgentError | undefined
            const durations = new Map<string, number>()
            const execute = async (proposal: ToolCallProposal): Promise<ToolResult> => {
                const began = Date.now(), entry = tools.registry[proposal.name]
                if (entry.contract.kind === 'ask') finalRequested = false
                let dispatched = false
                let toolStarted: number | undefined
                try {
                    const correctionError = correctionErrors.get(proposal.id)
                    if (correctionError) throw new AgentApplicationError(correctionError)
                    const validation = tools.prepare(proposal, context)
                    if (!validation.ok) throw new AgentApplicationError(validation.error)
                    const prepared = validation.prepared
                    if (entry.contract.kind === 'write' && (uncertainCalls.length || changes.length >= MAX_BOARD_WRITES_PER_TASK)) fail('写入结果不明或写入预算已用尽，不能继续写入')
                    if (proposal.name === 'get_board_snapshot' || proposal.name === 'get_board_screenshot' || proposal.name === 'ask_user') {
                        if (++counts[proposal.name] > (proposal.name === 'ask_user' ? 1 : 2)) fail('读取或询问预算已用尽')
                    }
                    if (prepared.isFinal && getUncoveredTaskObjects(preparation.brief, covered, prepared.elements).length) fail('最终写入不能遗漏需求对象')
                    await dependencies.record?.('operation_result', { operation: 'element_preparation', outcome: 'success', modelCall: proposal,
                        ...(retries.has(proposal.id) ? { retryOf: retries.get(proposal.id) } : {}), ...prepared }, Date.now() - began)
                    await assertActive()
                    if (prepared.elements.length) await dependencies.emit?.({ type: 'plan', task: preparation.brief, prepared })
                    await dependencies.record?.('tool_call', { call: prepared.call, input: prepared.input })
                    toolStarted = Date.now()
                    dispatched = true
                    const output = await entry.execute(prepared, dependencies.signal)
                    const result = tools.invocations.validateToolResult(proposal, output)
                    if (result.state === 'known' && result.output.ok && entry.contract.kind === 'write') {
                        const mutation = tools.invocations.mutationResultSchema.parse({ callId: result.callId, name: result.name, output: result.output })
                        assertElementTargets(prepared.elements, mutation.name === 'create_shapes' ? 'create' : mutation.name === 'update_shapes' ? 'update' : 'delete',
                            'ids' in mutation.output ? mutation.output.ids.map(id => ({ id }))
                                : mutation.name === 'create_shapes' ? mutation.output.shapes.map(shape => ({ type: shape.type })) : mutation.output.shapes)
                        changes.push(mutation)
                        prepared.elements.forEach(row => covered.add(row.sourceKey ?? row.key))
                        finalRequested = prepared.isFinal === true
                    } else if (entry.contract.kind === 'write') finalRequested = false
                    return result
                } catch (cause) {
                    if (dependencies.signal.aborted || dispatched || !(cause instanceof AgentApplicationError) || cause.detail.code !== ERROR_CODES.INVALID_ARGUMENTS) fatal ??= cause
                    const error = dependencies.signal.aborted ? { code: ERROR_CODES.TASK_INACTIVE, message: '任务已取消或超时' } : applicationError(cause, dependencies)
                    await dependencies.record?.('operation_result', { operation: 'element_preparation', outcome: 'error', modelCall: proposal, error }, Date.now() - began)
                    return tools.invocations.toolResultSchema.parse({ callId: proposal.id, name: proposal.name, state: dispatched ? 'unknown' : 'not_executed', error })
                } finally {
                    if (toolStarted !== undefined) durations.set(proposal.id, Date.now() - toolStarted)
                }
            }
            // 连续读取并发，写入和询问是屏障；先收齐兄弟结果，再传播取消或传输错误。
            for (let index = 0; index < calls.length;) {
                const group = [calls[index++]]
                if (tools.registry[group[0].name].contract.kind === 'read') {
                    while (index < calls.length && tools.registry[calls[index].name].contract.kind === 'read') group.push(calls[index++])
                }
                const settled = await Promise.allSettled(group.map(execute))
                const results: ToolResult[] = []
                for (const item of settled) {
                    if (item.status === 'rejected') { fatal ??= item.reason; continue }
                    const result = item.value
                    results.push(result)
                    // 在下一道执行屏障前提交事实和未知写入，后续工具不能使用过期的观察或授权状态。
                    if (result.state === 'unknown' && tools.registry[result.name].contract.kind === 'write') uncertainCalls.push({ id: result.callId, name: result.name })
                    await dependencies.record?.('tool_result', { callId: result.callId, result }, durations.get(result.callId))
                    const successful = result.state === 'known' && result.output.ok
                    if (successful) {
                        const retryOf = retries.get(result.callId)
                        if (retryOf) unresolvedErrors.delete(retryOf)
                        if (tools.registry[result.name].contract.kind !== 'write') {
                            for (const [id, failure] of unresolvedErrors) if (failure.name === result.name) unresolvedErrors.delete(id)
                        }
                    }
                    if (result.state !== 'known' || !result.output.ok) {
                        batchFailed = true
                        const error = result.state === 'known' && !result.output.ok ? result.output.error : result.state !== 'known' ? result.error : undefined
                        if (error) unresolvedErrors.set(result.callId, { name: result.name, error })
                    }
                    if (result.state === 'not_executed' && result.error.code === ERROR_CODES.INVALID_ARGUMENTS) {
                        argumentError = result.error
                        if (tools.registry[result.name].contract.kind === 'write') pendingCorrections.add(result.callId)
                    }
                }
                context = contextSchema.parse({ ...context, toolResults: [...context.toolResults, ...results], messages: [...context.messages, ...results.map(createToolResultMessage)] })
                if (fatal) break
            }
            if (fatal) throw fatal
            dependencies.signal.throwIfAborted()
            if (argumentError) {
                if (argumentCorrectionUsed) throw new AgentApplicationError(argumentError)
                argumentCorrectionUsed = true
                context = contextSchema.parse({ ...context, messages: [...context.messages, { role: 'system', content: [{
                    type: 'text', source: 'system',
                    text: '工具参数未通过校验。请根据具体字段错误修正；数组直接使用 [...]，对象使用 {...}，不能二次编码成字符串。写入纠错使用同名工具、全新 callId 与 retryOf：增量格式为 {retryOf,patches:[{itemKey:"item_0",props:{font:"sans"}}]}，只修改错误字段，其余元素和字段保留；props 按字段合并，richText/points 等嵌套值整项替换。可选 isFinal/references 覆盖旧值。增加/删除元素或更换 type/objectKey/shapeId 时，使用带 retryOf 的完整替代参数。保持原始需求，本任务只有一次参数纠正机会；禁止重放已成功或结果未知的调用。'
                        + toolCorrectionHints(context, pendingCorrections, dependencies.tools),
                }] }] })
            }
            if (finalRequested && !batchFailed && !uncertainCalls.length) return finishTask('已经执行草稿修改，请检查白板预览。')
        }
        throw new AgentApplicationError([...unresolvedErrors.values()].at(-1)?.error ?? { code: ERROR_CODES.TASK_FAILED, message: '后端模型请求次数已达上限' })
    } catch (cause) {
        const cancelled = dependencies.signal.aborted
        const error = cancelled ? { code: ERROR_CODES.TASK_INACTIVE, message: '任务已取消或超时，已完成的内容仅保留在草稿中' } : applicationError(cause, dependencies)
        return outcomeSchema.parse({ status: cancelled ? 'cancelled' : changes.length || uncertainCalls.length ? 'partial' : 'failed',
            text: error.message, changes, uncertainCalls, error })
    }
}
