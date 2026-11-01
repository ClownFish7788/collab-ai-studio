import { z } from 'zod'
import { MAX_BOARD_ELEMENT_ROWS } from '../boardCapabilities'
import { taskObjectSchema } from './boardTaskObject'

export const MAX_TASK_PREPARATION_CHARS = 8000

const shortTextSchema = z.string().min(1).max(300).regex(/\S/, '不能只包含空白')

export const taskBriefSchema = z.strictObject({
    goal: z.string().min(1).max(1000).regex(/\S/, '不能只包含空白'),
    tasks: z.array(shortTextSchema).min(1).max(30),
    objects: z.array(taskObjectSchema).max(MAX_BOARD_ELEMENT_ROWS),
    relations: z.array(z.strictObject({
        from: taskObjectSchema.shape.key,
        to: taskObjectSchema.shape.key,
        description: shortTextSchema,
    })).max(60),
    constraints: z.array(shortTextSchema).max(20),
    unresolvedQuestions: z.array(shortTextSchema).max(20),
})

export const boardTaskPreparationSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('task'), brief: taskBriefSchema }),
    z.strictObject({
        kind: z.literal('reply'),
        text: z.string().min(1).max(MAX_TASK_PREPARATION_CHARS).regex(/\S/, '不能只包含空白'),
    }),
])

export type TaskBrief = z.infer<typeof taskBriefSchema>
export type BoardTaskPreparation = z.infer<typeof boardTaskPreparationSchema>

export const boardTaskPreparationJsonSchema = z.toJSONSchema(boardTaskPreparationSchema)
