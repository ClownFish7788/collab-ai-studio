import { z } from 'zod'

/** Agent 对外的稳定错误词汇；HTTP、供应商响应和堆栈由适配层保留。 */
export enum ERROR_CODES {
    INVALID_ARGUMENTS = 'INVALID_ARGUMENTS',
    INVALID_MODEL_RESPONSE = 'INVALID_MODEL_RESPONSE',
    EXECUTION_FAILED = 'EXECUTION_FAILED',
    ACCESS_DENIED = 'ACCESS_DENIED',
    TASK_INACTIVE = 'TASK_INACTIVE',
    TASK_FAILED = 'TASK_FAILED',
}

export const validationIssueSchema = z.strictObject({
    path: z.string().regex(/^[\w.[\]]{1,100}$/),
    message: z.string().min(1).max(200).regex(/\S/),
})
export const agentErrorSchema = z.strictObject({
    code: z.enum(ERROR_CODES),
    message: z.string().min(1).max(1000).regex(/\S/),
    issues: z.array(validationIssueSchema).min(1).max(40).optional(),
})
export type AgentError = z.infer<typeof agentErrorSchema>
export type ValidationIssue = z.infer<typeof validationIssueSchema>
