import { z } from 'zod'

const objectKeySchema = z.string().regex(/^[a-zA-Z][\w-]{0,63}$/)

/** 需求层的逻辑对象；key 不是白板 ID，role 不是原生元素类型。 */
export const taskObjectSchema = z.strictObject({
    key: objectKeySchema,
    role: z.string().min(1).max(100).regex(/\S/, '不能只包含空白'),
    description: z.string().min(1).max(300).regex(/\S/, '不能只包含空白'),
    parentKey: objectKeySchema.optional(),
})

export type TaskObject = z.infer<typeof taskObjectSchema>
