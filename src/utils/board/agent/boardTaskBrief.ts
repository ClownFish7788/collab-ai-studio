import { z } from 'zod'
import { BoardProtocolError, ERROR_CODES } from './boardCreateProtocol'
import {
    boardTaskPreparationSchema, MAX_TASK_PREPARATION_CHARS,
    type TaskBrief, type BoardTaskPreparation,
} from './boardTaskBriefSchema'

export type { TaskBrief, BoardTaskPreparation } from './boardTaskBriefSchema'

/** 只校验显式结构和引用，不保证模型完整理解了自然语言需求。 */
export function validateBoardTaskPreparation(value: unknown): BoardTaskPreparation {
    const invalid = (path: string, message: string, issues = [{ path, message }]): never => { throw new BoardProtocolError({
        code: ERROR_CODES.INVALID_MODEL_RESPONSE, message: `需求拆分失败：${path} ${message}；本轮没有执行工具`,
        issues,
    }) }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('preparation', '必须是 JSON 对象')
    let size: number
    try {
        size = JSON.stringify(value).length
    } catch { return invalid('preparation', '必须可序列化为 JSON') }
    if (size > MAX_TASK_PREPARATION_CHARS) return invalid('preparation', `超过 ${MAX_TASK_PREPARATION_CHARS} 字符`)
    const parsed = boardTaskPreparationSchema.safeParse(value, { error: z.locales.zhCN().localeError })
    if (!parsed.success) {
        // 引用检查在嵌套 schema 中执行，但准备阶段仍优先报告外层结构问题。
        const first = parsed.error.issues.find(issue => issue.code !== 'custom') ?? parsed.error.issues[0]
        const issues = (first.code === 'custom' ? parsed.error.issues.slice(0, 40) : [first]).map(issue => ({
            path: issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('') || 'preparation',
            message: issue.message,
        }))
        return invalid(issues[0].path, issues[0].message, issues)
    }
    return parsed.data
}

/** 展示已校验的需求摘要；与最终答复分开，引用使用逻辑 key 以保留对应关系。 */
export function formatTaskBrief(brief: TaskBrief): string {
    return [
        `目标：${brief.goal}`,
        `任务点：\n${brief.tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')}`,
        ...(brief.objects.length ? [`对象与包含关系：\n${brief.objects.map(object => `- ${object.key}：${object.role}；${object.description}${object.parentKey ? `；属于 ${object.parentKey}` : ''}`).join('\n')}`] : []),
        ...(brief.relations.length ? [`关联：\n${brief.relations.map(relation => `- ${relation.from} → ${relation.to}：${relation.description}`).join('\n')}`] : []),
        ...(brief.constraints.length ? [`约束：\n${brief.constraints.map(item => `- ${item}`).join('\n')}`] : []),
        ...(brief.unresolvedQuestions.length ? [`待确定（继续读取或询问）：\n${brief.unresolvedQuestions.map(item => `- ${item}`).join('\n')}`] : []),
    ].join('\n\n')
}
