import { z } from 'zod'

// 只描述用户任务与逻辑对象关系，不包含模型消息、工具协议或运行状态。
export const MAX_BOARD_ELEMENT_ROWS = 30
export const MAX_BOARD_QUESTIONS = 20

const objectKeySchema = z.string().regex(/^[a-zA-Z][\w-]{0,63}$/)
const shortTextSchema = z.string().min(1).max(300).regex(/\S/, '不能只包含空白')

/** key 是逻辑对象身份，role 是语义角色，均不表示真实白板元素。 */
export const taskObjectSchema = z.strictObject({
    key: objectKeySchema,
    role: z.string().min(1).max(100).regex(/\S/, '不能只包含空白'),
    description: shortTextSchema,
    parentKey: objectKeySchema.optional(),
})

/** 一次解析同时检查结构与图引用；通过校验不代表自然语言需求已被完整理解。 */
export const taskBriefSchema = z.strictObject({
    goal: z.string().min(1).max(1000).regex(/\S/, '不能只包含空白'),
    tasks: z.array(shortTextSchema).min(1).max(30),
    objects: z.array(taskObjectSchema).max(MAX_BOARD_ELEMENT_ROWS),
    relations: z.array(z.strictObject({
        from: objectKeySchema,
        to: objectKeySchema,
        description: shortTextSchema,
    })).max(60),
    constraints: z.array(shortTextSchema).max(20),
    unresolvedQuestions: z.array(shortTextSchema).max(MAX_BOARD_QUESTIONS),
}).superRefine((brief, ctx) => {
    const parents = new Map<string, string | undefined>()
    for (const [index, object] of brief.objects.entries()) {
        if (parents.has(object.key)) {
            ctx.addIssue({ code: 'custom', path: ['objects', index], message: '对象 key 必须唯一' })
            return
        }
        parents.set(object.key, object.parentKey)
    }
    // 沿父链检查间接环；优先报告对象问题，保持现有准备阶段的诊断顺序。
    for (const [index, object] of brief.objects.entries()) {
        const seen = new Set<string>()
        let current: string | undefined = object.key
        while (current !== undefined) {
            if (!parents.has(current) || seen.has(current)) {
                ctx.addIssue({ code: 'custom', path: ['objects', index, 'parentKey'], message: !parents.has(current)
                    ? `引用的父对象 key "${current}" 不存在` : '包含关系形成环' })
                return
            }
            seen.add(current)
            current = parents.get(current)
        }
    }
    // 同一关系的两个端点可能同时缺失，全部保留，交由调用边缘限制诊断条数。
    for (const [index, relation] of brief.relations.entries()) {
        for (const field of ['from', 'to'] as const) {
            if (!parents.has(relation[field])) ctx.addIssue({ code: 'custom', path: ['relations', index, field],
                message: `引用了未声明的对象 key "${relation[field]}"，须与 objects 中的 key 完全一致` })
        }
    }
})

export type TaskObject = z.infer<typeof taskObjectSchema>
export type TaskBrief = z.infer<typeof taskBriefSchema>

export const MAX_TASK_PREPARATION_CHARS = 8000
/** 准备阶段的完整语义决策；是否纠正重试由应用层决定。 */
export const boardTaskPreparationSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('task'), brief: taskBriefSchema }),
    z.strictObject({ kind: z.literal('reply'), text: z.string().min(1).max(MAX_TASK_PREPARATION_CHARS).regex(/\S/, '不能只包含空白') }),
])
export type BoardTaskPreparation = z.infer<typeof boardTaskPreparationSchema>
