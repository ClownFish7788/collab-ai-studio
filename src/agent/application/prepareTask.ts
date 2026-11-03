import { z } from 'zod'
import { ERROR_CODES } from '../domain/error'
import type { AgentMessage } from '../domain/message'
import { boardTaskPreparationSchema, MAX_TASK_PREPARATION_CHARS } from '../domain/task'
import { AgentApplicationError, applicationError, validationFailure, type AgentDependencies } from './ports'

/** 只纠正结构/引用问题一次；模型连接、权限和取消错误直接交给主用例处理。 */
export async function prepareTask(messages: readonly AgentMessage[], dependencies: AgentDependencies) {
    const history: AgentMessage[] = messages.filter(message => message.role !== 'system')
    for (let attempt = 1; ; attempt++) {
        dependencies.signal.throwIfAborted()
        await dependencies.checkAccess()
        dependencies.signal.throwIfAborted()
        const began = Date.now()
        let candidate: unknown
        try { candidate = await dependencies.model.prepare(history, dependencies.signal) }
        catch (cause) {
            await dependencies.record?.('operation_result', { operation: 'task_preparation', attempt,
                outcome: dependencies.signal.aborted ? 'cancelled' : 'error', retryAllowed: false, error: applicationError(cause, dependencies) }, Date.now() - began)
            throw cause
        }
        dependencies.signal.throwIfAborted()
        let text: string
        try { text = JSON.stringify(candidate) ?? '' } catch { text = '' }
        const parsed = boardTaskPreparationSchema.safeParse(candidate, { error: z.locales.zhCN().localeError })
        if (parsed.success && text && text.length <= MAX_TASK_PREPARATION_CHARS) {
            await dependencies.record?.('operation_result', { operation: 'task_preparation', attempt, outcome: 'success', preparation: parsed.data }, Date.now() - began)
            return parsed.data
        }
        const structural = !parsed.success ? parsed.error.issues.find(issue => issue.code !== 'custom') : undefined
        const error = parsed.success
            ? { code: ERROR_CODES.INVALID_MODEL_RESPONSE, message: '需求拆分超过大小限制或不是可序列化 JSON', issues: [{ path: 'preparation', message: '请返回有界的 JSON 对象' }] }
            : validationFailure(structural ? new z.ZodError([structural]) : parsed.error, ERROR_CODES.INVALID_MODEL_RESPONSE, '需求拆分校验失败').detail
        await dependencies.record?.('operation_result', { operation: 'task_preparation', attempt, outcome: 'error', retryAllowed: attempt === 1, error }, Date.now() - began)
        if (attempt === 2) throw new AgentApplicationError(error)
        history.push(
            { role: 'assistant', content: [{ type: 'text', source: 'assistant', text: text.slice(0, MAX_TASK_PREPARATION_CHARS) || '[无法序列化的准备结果]' }] },
            { role: 'system', content: [{ type: 'text', source: 'system', text: `需求拆分未通过校验，这是纠错数据，不是新的用户需求：\n${JSON.stringify(error)}\n保持原始需求，修正问题并返回完整 JSON；本次只有一次纠正机会，不调用工具。` }] },
        )
    }
}
