import { z } from 'zod'
import { BoardProtocolError, ERROR_CODES } from './boardCreateProtocol'
import {
    boardTaskPreparationSchema, MAX_TASK_PREPARATION_CHARS,
    type TaskBrief, type BoardTaskPreparation,
} from './boardTaskBriefSchema'

export type { TaskBrief, BoardTaskPreparation } from './boardTaskBriefSchema'

/** 只校验显式结构和引用，不保证模型完整理解了自然语言需求。 */
export function validateBoardTaskPreparation(value: unknown): BoardTaskPreparation {
    const invalid = (path: string, message: string): never => { throw new BoardProtocolError({
        code: ERROR_CODES.INVALID_MODEL_RESPONSE, message: `需求拆分失败：${path} ${message}；本轮没有执行工具`,
        issues: [{ path, message }],
    }) }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('preparation', '必须是 JSON 对象')
    let size: number
    try {
        size = JSON.stringify(value).length
    } catch { return invalid('preparation', '必须可序列化为 JSON') }
    if (size > MAX_TASK_PREPARATION_CHARS) return invalid('preparation', `超过 ${MAX_TASK_PREPARATION_CHARS} 字符`)
    const parsed = boardTaskPreparationSchema.safeParse(value, { error: z.locales.zhCN().localeError })
    if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path = issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('')
        return invalid(path || 'preparation', issue.message)
    }
    const preparation = parsed.data
    if (preparation.kind === 'reply') return preparation
    const brief = preparation.brief

    const parents = new Map<string, string | undefined>()
    for (const [index, object] of brief.objects.entries()) {
        const path = `brief.objects[${index}]`
        if (parents.has(object.key)) return invalid(path, '对象 key 必须唯一')
        parents.set(object.key, object.parentKey)
    }
    for (const [index, object] of brief.objects.entries()) {
        const start = object.key
        const seen = new Set<string>()
        let current: string | undefined = start
        while (current !== undefined) {
            if (!parents.has(current)) return invalid(`brief.objects[${index}].parentKey`, '引用的父对象不存在')
            if (seen.has(current)) return invalid(`brief.objects[${index}].parentKey`, '包含关系形成环')
            seen.add(current)
            current = parents.get(current)
        }
    }
    for (const [index, relation] of brief.relations.entries()) {
        if (!parents.has(relation.from) || !parents.has(relation.to)) return invalid(`brief.relations[${index}]`, '关系两端必须引用已列出的对象 key')
    }
    return preparation
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
