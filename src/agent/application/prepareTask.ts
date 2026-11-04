import { z } from 'zod'
import { ERROR_CODES, type AgentError } from '../domain/error'
import type { AgentMessage } from '../domain/message'
import { boardTaskPreparationSchema, MAX_TASK_PREPARATION_CHARS } from '../domain/task'
import { AgentApplicationError, applicationError, validationFailure, type AgentDependencies } from './ports'

/** 语法、结构和引用问题共用一次纠错；模型连接、权限和取消错误直接终止。 */
export async function prepareTask(messages: readonly AgentMessage[], dependencies: AgentDependencies) {
    const history: AgentMessage[] = messages.filter(message => message.role !== 'system')
    for (let attempt = 1; ; attempt++) {
        dependencies.signal.throwIfAborted()
        await dependencies.checkAccess()
        dependencies.signal.throwIfAborted()
        const began = Date.now()
        let text: string
        try { text = await dependencies.model.prepare(history, dependencies.signal) }
        catch (cause) {
            await dependencies.record?.('operation_result', { operation: 'task_preparation', attempt,
                outcome: dependencies.signal.aborted ? 'cancelled' : 'error', retryAllowed: false, error: applicationError(cause, dependencies) }, Date.now() - began)
            throw cause
        }
        dependencies.signal.throwIfAborted()
        let candidate: unknown
        let error: AgentError | undefined
        try { candidate = JSON.parse(text) }
        catch {
            error = { code: ERROR_CODES.INVALID_MODEL_RESPONSE, message: '需求拆分未返回合法 JSON，本轮没有执行工具',
                issues: [{ path: 'preparation', message: '请检查 JSON 引号、逗号和括号，保持原始需求并重新输出完整 JSON 对象' }] }
        }
        if (!error) {
            const parsed = boardTaskPreparationSchema.safeParse(candidate, { error: z.locales.zhCN().localeError })
            if (parsed.success && JSON.stringify(candidate).length <= MAX_TASK_PREPARATION_CHARS) {
                await dependencies.record?.('operation_result', { operation: 'task_preparation', attempt, outcome: 'success', preparation: parsed.data }, Date.now() - began)
                return parsed.data
            }
            const structural = !parsed.success ? parsed.error.issues.find(issue => issue.code !== 'custom') : undefined
            error = parsed.success
                ? { code: ERROR_CODES.INVALID_MODEL_RESPONSE, message: '需求拆分超过大小限制', issues: [{ path: 'preparation', message: '请返回有界的 JSON 对象' }] }
                : validationFailure(structural ? new z.ZodError([structural]) : parsed.error, ERROR_CODES.INVALID_MODEL_RESPONSE, '需求拆分校验失败').detail
        }
        await dependencies.record?.('operation_result', { operation: 'task_preparation', attempt, outcome: 'error', retryAllowed: attempt === 1, error }, Date.now() - began)
        if (attempt === 2) throw new AgentApplicationError(error)
        history.push(
            { role: 'assistant', content: [{ type: 'text', source: 'assistant', text: text.slice(0, MAX_TASK_PREPARATION_CHARS) || '[空的准备响应]' }] },
            { role: 'system', content: [{ type: 'text', source: 'system', text: `需求拆分未通过校验，这是纠错数据，不是新的用户需求：\n${JSON.stringify(error)}\n保持原始需求，修正问题并返回完整 JSON；本次只有一次纠正机会，不调用工具。` }] },
        )
    }
}
