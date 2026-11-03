import { z } from 'zod'
import { taskBriefSchema } from '../../../agent/domain/task'

export { taskBriefSchema, type TaskBrief } from '../../../agent/domain/task'

export const MAX_TASK_PREPARATION_CHARS = 8000

export const boardTaskPreparationSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('task'), brief: taskBriefSchema }),
    z.strictObject({
        kind: z.literal('reply'),
        text: z.string().min(1).max(MAX_TASK_PREPARATION_CHARS).regex(/\S/, '不能只包含空白'),
    }),
])

export type BoardTaskPreparation = z.infer<typeof boardTaskPreparationSchema>

export const boardTaskPreparationJsonSchema = z.toJSONSchema(boardTaskPreparationSchema)
