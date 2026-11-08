import { jsonObjectSchema } from '../domain/data'
import { ERROR_CODES } from '../domain/error'
import type { ToolCallProposal } from '../domain/invocation'
import { isSyntaxRepairable, parseSyntaxRepair, syntaxProblemSchema, type SyntaxProblem } from '../domain/syntaxRepair'
import { AgentApplicationError, type AgentDependencies } from './ports'

/** 修复在派发前完成；原始片段始终作为基线，上一轮候选只能作为错误反馈。 */
export async function repairToolSyntax(proposal: ToolCallProposal, problems: readonly SyntaxProblem[], dependencies: AgentDependencies,
    takeAttempt: () => number | undefined): Promise<ToolCallProposal> {
    let input = proposal.input
    for (const value of problems) {
        const problem = syntaxProblemSchema.parse(value)
        let issues = problem.issues
        const failure = () => new AgentApplicationError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '工具参数语法修复失败，未执行该调用', issues })
        if (!isSyntaxRepairable(problem.text)) {
            issues = [{ path: problem.field ? `input.${problem.field}` : 'input', message: '原文被截断或值的边界不明确，不能只修正语法' }]
            throw failure()
        }
        // 片段只能替换原始调用中的同一个字段，不接受游离的修复元数据。
        if ((problem.field ? jsonObjectSchema.parse(input)[problem.field] : input) !== problem.text) throw failure()
        for (;;) {
            dependencies.signal.throwIfAborted()
            const attempt = takeAttempt()
            if (attempt === undefined) throw failure()
            await dependencies.checkAccess()
            dependencies.signal.throwIfAborted()
            const began = Date.now()
            let candidate: string
            try { candidate = await dependencies.model.repairSyntax({ ...problem, issues }, dependencies.signal) }
            catch (cause) {
                await dependencies.record?.('operation_result', { operation: 'syntax_repair', callId: proposal.id, field: problem.field,
                    attempt, outcome: dependencies.signal.aborted ? 'cancelled' : 'error', retryAllowed: false }, Date.now() - began)
                throw cause // 网络、鉴权、截断响应不走语法重试。
            }
            dependencies.signal.throwIfAborted()
            try {
                const repaired = parseSyntaxRepair(problem.text, candidate)
                input = problem.field ? { ...jsonObjectSchema.parse(input), [problem.field]: repaired } : repaired
            } catch (cause) {
                issues = [{ path: problem.field ? `input.${problem.field}` : 'input',
                    message: `上一轮修复未通过内容保真或 JSON 校验：${cause instanceof Error ? cause.message : '修复无效'}`.slice(0, 200) }]
                await dependencies.record?.('operation_result', { operation: 'syntax_repair', callId: proposal.id, field: problem.field,
                    attempt, outcome: 'error', error: failure().detail }, Date.now() - began)
                continue
            }
            await dependencies.record?.('operation_result', { operation: 'syntax_repair', callId: proposal.id, field: problem.field,
                attempt, outcome: 'success' }, Date.now() - began)
            break
        }
    }
    return { ...proposal, input }
}
