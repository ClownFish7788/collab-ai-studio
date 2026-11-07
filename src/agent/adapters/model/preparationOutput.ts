import { z } from 'zod'
import { boardTaskPreparationSchema, taskBriefSchema, taskObjectSchema, MAX_BOARD_ELEMENT_ROWS } from '../../domain/task'

// strict 传输要求根为 object、所有字段必填；null 占位只存在于模型协议，不放宽领域契约。
const wireBriefSchema = z.strictObject({
    ...taskBriefSchema.shape,
    objects: z.array(taskObjectSchema.extend({ parentKey: taskObjectSchema.shape.parentKey.unwrap().nullable() })).max(MAX_BOARD_ELEMENT_ROWS),
})
const wireSchema = z.strictObject({
    kind: z.enum(['task', 'reply']),
    brief: wireBriefSchema.nullable(),
    text: boardTaskPreparationSchema.options[1].shape.text.nullable(),
})

export const preparationResponseFormat = {
    type: 'json_schema' as const,
    json_schema: { name: 'board_task_preparation', strict: true, schema: z.toJSONSchema(wireSchema, { target: 'draft-7' }) },
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** 只消除协议约定的 null；未知字段和非法值必须留给应用层诊断与一次纠错。 */
export function normalizePreparationOutput(text: string): string {
    let value: unknown
    try { value = JSON.parse(text) } catch { return text }
    if (!isObject(value)) return text
    if (value.kind === 'reply' && value.brief === null) delete value.brief
    if (value.kind === 'task') {
        if (value.text === null) delete value.text
        if (isObject(value.brief) && Array.isArray(value.brief.objects)) {
            for (const object of value.brief.objects) {
                if (isObject(object) && object.parentKey === null) delete object.parentKey
            }
        }
    }
    return JSON.stringify(value)
}
