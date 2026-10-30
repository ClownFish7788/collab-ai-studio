import { BoardProtocolError, ERROR_CODES } from './boardCreateProtocol'

/** 需求层的逻辑对象；key 不是原生元素 ID，role 不是 tldraw 类型。 */
export type TaskBrief = {
    goal: string
    tasks: string[]
    objects: { key: string; role: string; description: string; parentKey?: string }[]
    relations: { from: string; to: string; description: string }[]
    constraints: string[]
    unresolvedQuestions: string[]
}

export type BoardTaskPreparation = { kind: 'task'; brief: TaskBrief } | { kind: 'reply'; text: string }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max
const key = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z][\w-]{0,63}$/.test(value)
const fields = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(k => allowed.includes(k))
const texts = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every(v => text(v, 300))

/** 只校验显式结构和引用，不保证模型完整理解了自然语言需求。 */
export function validateBoardTaskPreparation(value: unknown): BoardTaskPreparation {
    const invalid = (path: string, message: string): never => { throw new BoardProtocolError({
        code: ERROR_CODES.INVALID_MODEL_RESPONSE, message: `需求拆分失败：${path} ${message}；本轮没有执行工具`,
        issues: [{ path, message }],
    }) }
    if (!isRecord(value)) return invalid('preparation', '必须是 JSON 对象')
    let size: number
    try {
        size = JSON.stringify(value).length
    } catch { return invalid('preparation', '必须可序列化为 JSON') }
    if (size > 8000) return invalid('preparation', '超过 8000 字符')
    if (value.kind !== 'task' && value.kind !== 'reply') return invalid('kind', '必须是 task 或 reply；任务结果需要 {kind:"task",brief:{...}} 外层结构')
    if (value.kind === 'reply') {
        if (!fields(value, ['kind', 'text'])) return invalid('preparation', 'reply 分支只允许 kind 和 text')
        if (!text(value.text, 8000)) return invalid('text', '必须是 1～8000 字符的非空文字')
        return { kind: 'reply', text: value.text }
    }
    if (!fields(value, ['kind', 'brief'])) return invalid('preparation', 'task 分支只允许 kind 和 brief')
    if (!isRecord(value.brief)) return invalid('brief', '必须是包含需求字段的对象')
    const brief = value.brief
    if (!fields(brief, ['goal', 'tasks', 'objects', 'relations', 'constraints', 'unresolvedQuestions'])) return invalid('brief', '包含未定义字段')
    if (!text(brief.goal, 1000)) return invalid('brief.goal', '必须是 1～1000 字符的非空目标')
    if (!texts(brief.tasks, 30) || !brief.tasks.length) return invalid('brief.tasks', '必须有 1～30 个任务点，每项不超过 300 字符')
    for (const name of ['constraints', 'unresolvedQuestions'] as const) {
        if (!texts(brief[name], 20)) return invalid(`brief.${name}`, '必须是文字数组，最多 20 项，每项 1～300 字符')
    }
    if (!Array.isArray(brief.objects) || brief.objects.length > 30) return invalid('brief.objects', '必须是对象数组，最多 30 项')
    if (!Array.isArray(brief.relations) || brief.relations.length > 60) return invalid('brief.relations', '必须是关系数组，最多 60 项')

    const parents = new Map<string, string | undefined>()
    for (const [index, object] of brief.objects.entries()) {
        const path = `brief.objects[${index}]`
        if (!isRecord(object) || !fields(object, ['key', 'role', 'description', 'parentKey'])
            || !key(object.key) || !text(object.role, 100) || !text(object.description, 300)
            || object.parentKey !== undefined && !key(object.parentKey)
            || parents.has(object.key)) return invalid(path, '需提供唯一合法 key、role、description 和可选 parentKey，不能包含坐标或额外字段')
        parents.set(object.key, object.parentKey as string | undefined)
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
        if (!isRecord(relation) || !fields(relation, ['from', 'to', 'description'])
            || !key(relation.from) || !key(relation.to) || !text(relation.description, 300)
            || !parents.has(relation.from) || !parents.has(relation.to)) return invalid(`brief.relations[${index}]`, '需提供 from、to、description，且两端必须引用已列出的对象 key')
    }
    return value as BoardTaskPreparation
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
