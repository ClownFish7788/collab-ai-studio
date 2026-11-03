import { z } from 'zod'
import { boardTaskPreparationSchema } from '../../../agent/domain/task'

export { boardTaskPreparationSchema, taskBriefSchema, MAX_TASK_PREPARATION_CHARS, type TaskBrief, type BoardTaskPreparation } from '../../../agent/domain/task'

/** 模型适配使用的 JSON Schema；领域图引用约束仍须在完整输出上运行时校验。 */
export const boardTaskPreparationJsonSchema = z.toJSONSchema(boardTaskPreparationSchema)
