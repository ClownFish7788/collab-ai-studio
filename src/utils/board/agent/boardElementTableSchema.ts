import { z } from 'zod'
import { DRAFT_SHAPE_TYPES } from '../draft/draftShapeSchema'
import { MAX_BOARD_ELEMENT_ROWS } from '../boardCapabilities'
import { taskObjectSchema } from './boardTaskObject'

const MAX_KNOWN_FIELDS = 12
const shapeTypeSchema = z.enum(DRAFT_SHAPE_TYPES).describe('原生类型，如 geo；props.geo 不能代替 type。')
const shapeIdSchema = z.string().regex(/^shape:[\w-]{1,128}$/)
    .describe('本任务附件、实际读取或新增结果中的真实 ID，填写在顶层；known.shapeId 不能代替。')
const missingSchema = z.strictObject({
    field: z.string().min(1).max(100).regex(/\S/, '不能只包含空白'),
    source: z.enum(['read', 'ask', 'calculate']),
})
const knownSchema = z.record(
    z.string().min(1).max(64).regex(/\S/, '字段名不能只包含空白'),
    z.union([z.string().max(300), z.number(), z.boolean()]),
).refine(value => Object.keys(value).length <= MAX_KNOWN_FIELDS, `已知信息最多 ${MAX_KNOWN_FIELDS} 个字段`)
    // Zod record 的自定义数量检查需要同时声明 JSON Schema 的对象属性数量限制。
    .meta({ maxProperties: MAX_KNOWN_FIELDS })
    .describe('必填平面信息表，包括 reference 行；无已知信息用 {}，如 {"props.color":"blue"}，不填 null、数组或嵌套对象。')

/** known 只记录模型整理的信息，不授予对象权限，也不是原生写入参数。 */
const baseRowSchema = z.strictObject({
    key: taskObjectSchema.shape.key,
    sourceKey: taskObjectSchema.shape.key.optional(),
    role: taskObjectSchema.shape.role.optional(),
    operation: z.enum(['create', 'update', 'delete', 'reference']),
    type: shapeTypeSchema.optional(),
    shapeId: shapeIdSchema.optional(),
    known: knownSchema,
    missing: z.array(missingSchema).max(8),
})

export type BoardElementRow = z.infer<typeof baseRowSchema>

/** 模型说明与运行时解析共用同一工厂，按本任务对象和读写阶段确定规则。 */
export function getElementTableContract(sourceKeys?: readonly string[], forWrite = false) {
    const scopedSourceKeySchema = sourceKeys?.length ? z.enum(sourceKeys).optional() : z.never().optional()
    const base = baseRowSchema.extend({
        role: sourceKeys?.length === 0 ? taskObjectSchema.shape.role : baseRowSchema.shape.role,
        sourceKey: (sourceKeys === undefined ? baseRowSchema.shape.sourceKey : scopedSourceKeySchema)
            .describe('展开语义对象时引用原 task_brief.objects 的 key，继承其关系和约束。'),
        type: forWrite ? shapeTypeSchema : baseRowSchema.shape.type,
        missing: forWrite ? baseRowSchema.shape.missing.max(0, '写入前必须补齐所有缺项') : baseRowSchema.shape.missing,
    })
    const rows = z.discriminatedUnion('operation', [
        base.omit({ shapeId: true }).extend({ operation: z.literal('create') }),
        base.extend({
            operation: z.enum(['update', 'delete', 'reference']),
            shapeId: forWrite ? shapeIdSchema : baseRowSchema.shape.shapeId,
        }),
    ])
    const scopedRows = sourceKeys?.length ? rows.refine(
        row => sourceKeys.includes(row.key) || row.sourceKey !== undefined,
        { path: ['sourceKey'], message: '展开后的元素必须通过 sourceKey 引用原始需求对象' },
    ).meta({
        // 自定义引用条件不能由 Zod 自动转换，需要声明等价的 JSON Schema 条件。
        anyOf: [{ properties: { key: { enum: [...sourceKeys] } } }, { required: ['sourceKey'] }],
    }) : rows
    return z.array(scopedRows).min(forWrite ? 1 : sourceKeys?.length ?? 0).max(MAX_BOARD_ELEMENT_ROWS)
        .describe(forWrite
            ? '只列出本次写入及必要参照对象，按实际写入参数顺序排列；missing 必须为空，新增行有 type，已有行还有 shapeId。'
            : '覆盖全部需求对象，包括参照对象；通过 key 或 sourceKey 引用需求对象。可以有待读取、待询问或待计算的缺项。objects 为空时补齐对象并填写 role。')
}

export function getElementTableSchema(sourceKeys?: readonly string[], forWrite = false) {
    return z.toJSONSchema(getElementTableContract(sourceKeys, forWrite), { target: 'draft-7' })
}
