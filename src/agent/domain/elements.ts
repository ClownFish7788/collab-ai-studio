import { z } from 'zod'
import { MAX_BOARD_ELEMENT_ROWS, taskObjectSchema, type TaskBrief } from './task'
import { shapeIdSchema, shapeTypeSchema } from './observation'

const MAX_KNOWN_FIELDS = 12
/** known 是需求追踪信息，不是原生写入参数，也不授予目标操作权限。 */
const baseRowSchema = z.strictObject({
    key: taskObjectSchema.shape.key,
    sourceKey: taskObjectSchema.shape.key.optional(),
    role: taskObjectSchema.shape.role.optional(),
    operation: z.enum(['create', 'update', 'delete', 'reference']),
    type: shapeTypeSchema.optional(),
    shapeId: shapeIdSchema.optional(),
    known: z.record(z.string().min(1).max(64).regex(/\S/, '字段名不能只包含空白'),
        z.union([z.string().max(300), z.number(), z.boolean()]))
        .refine(value => Object.keys(value).length <= MAX_KNOWN_FIELDS, `已知信息最多 ${MAX_KNOWN_FIELDS} 个字段`)
        .meta({ maxProperties: MAX_KNOWN_FIELDS }),
    missing: z.array(z.strictObject({
        field: z.string().min(1).max(100).regex(/\S/, '不能只包含空白'),
        source: z.enum(['read', 'ask', 'calculate']),
    })).max(8),
})

export type BoardElementRow = z.infer<typeof baseRowSchema>

/** sourceKeys 限定需求来源；写入行必须有类型/真实目标，并且没有尚未解决的缺项。 */
export function getElementTableContract(sourceKeys?: readonly string[], forWrite = false) {
    const base = baseRowSchema.extend({
        role: sourceKeys?.length === 0 ? taskObjectSchema.shape.role : baseRowSchema.shape.role,
        sourceKey: sourceKeys === undefined ? baseRowSchema.shape.sourceKey
            : sourceKeys.length ? z.enum(sourceKeys).optional() : z.never().optional(),
        type: forWrite ? shapeTypeSchema : baseRowSchema.shape.type,
        missing: forWrite ? baseRowSchema.shape.missing.max(0, '写入前必须补齐所有缺项') : baseRowSchema.shape.missing,
    })
    const rows = z.discriminatedUnion('operation', [
        base.omit({ shapeId: true }).extend({ operation: z.literal('create') }),
        base.extend({ operation: z.enum(['update', 'delete', 'reference']), shapeId: forWrite ? shapeIdSchema : baseRowSchema.shape.shapeId }),
    ])
    return z.array(rows).min(forWrite ? 1 : sourceKeys?.length ?? 0).max(MAX_BOARD_ELEMENT_ROWS).superRefine((elements, ctx) => {
        const keys = new Set(sourceKeys)
        const supplied = new Set<string>()
        const ids = new Set<string>()
        elements.forEach((row, index) => {
            if (supplied.has(row.key)) ctx.addIssue({ code: 'custom', path: [index], message: '元素 key 必须唯一' })
            supplied.add(row.key)
            const source = row.sourceKey ?? row.key
            if (keys.size && (!keys.has(source) || keys.has(row.key) && source !== row.key)) {
                ctx.addIssue({ code: 'custom', path: [index, 'sourceKey'], message: '必须引用原始需求中的对象，不能替换其他对象的 key' })
            }
            if ('shapeId' in row && row.shapeId !== undefined) {
                if (ids.has(row.shapeId)) ctx.addIssue({ code: 'custom', path: [index, 'shapeId'], message: '目标 ID 不能重复，也不能同时作为本步参照对象' })
                ids.add(row.shapeId)
            }
        })
    })
}

const elementTargetSchema = z.strictObject({
    objectKey: taskObjectSchema.shape.key, role: taskObjectSchema.shape.role.optional(),
    shapeId: shapeIdSchema.optional(), type: shapeTypeSchema.optional(),
})
type ElementTarget = z.infer<typeof elementTargetSchema>

/** 只处理解码后的目标事实；不解析模型字符串，也不构造原生写入参数。 */
export function prepareElementRows(
    targets: readonly ElementTarget[], references: readonly ElementTarget[], operation: 'create' | 'update' | 'delete',
    brief: TaskBrief, observedTypes: ReadonlyMap<string, string>,
): BoardElementRow[] {
    const issues: z.core.$ZodIssue[] = []
    const invalid = (path: (string | number)[], message: string) => { issues.push({ code: 'custom', path, message }) }
    const all = [...targets, ...references].map(target => elementTargetSchema.parse({
        objectKey: target.objectKey, role: target.role, shapeId: target.shapeId, type: target.type,
    }))
    if (all.length > MAX_BOARD_ELEMENT_ROWS) invalid(['references'], `目标与参照对象合计最多${MAX_BOARD_ELEMENT_ROWS}项`)
    const keys = brief.objects.map(object => object.key)
    const counts = new Map<string, number>()
    all.forEach(target => counts.set(target.objectKey, (counts.get(target.objectKey) ?? 0) + 1))
    const reserved = new Set([...keys, ...counts.keys()])
    const ids = new Set<string>()
    const targetPath = (index: number) => index < targets.length ? [operation === 'create' ? 'shapes' : operation === 'update' ? 'changes' : 'targets', index]
        : ['references', index - targets.length]
    const elements = all.map((target, index) => {
        const path = targetPath(index)
        if (keys.length && !keys.includes(target.objectKey)) invalid([...path, 'objectKey'], '必须引用原始需求中的对象 key')
        const type = target.shapeId ? observedTypes.get(target.shapeId) : target.type
        if (target.shapeId) {
            if (!type) invalid([...path, 'shapeId'], 'ID 必须来自本任务附件、实际读取或新增结果，且未被删除')
            if (ids.has(target.shapeId)) invalid([...path, 'shapeId'], '目标 ID 不能重复，也不能同时作为本步参照对象')
            ids.add(target.shapeId)
        }
        let key = target.objectKey
        // 同一语义对象可展开多个实际元素，生成独立行 key，并通过 sourceKey 保留需求来源。
        if (counts.get(key)! > 1) {
            let suffix = index
            do { key = `element_${suffix++}` } while (reserved.has(key))
            reserved.add(key)
        }
        return {
            key, ...(key !== target.objectKey && keys.includes(target.objectKey) ? { sourceKey: target.objectKey } : {}),
            role: brief.objects.find(object => object.key === target.objectKey)?.role ?? target.role,
            operation: index >= targets.length ? 'reference' as const : operation,
            type, ...(target.shapeId !== undefined ? { shapeId: target.shapeId } : {}), known: {}, missing: [],
        }
    })
    // 引用错误已足够解释缺失类型，不再生成依赖该类型的次生错误。
    if (issues.length) throw new z.ZodError(issues)
    const parsed = getElementTableContract(keys, true).safeParse(elements)
    if (!parsed.success) throw new z.ZodError(parsed.error.issues.map(issue => ({ ...issue, path: typeof issue.path[0] === 'number'
        ? [...targetPath(issue.path[0]), ...issue.path.slice(1).map(part => part === 'sourceKey' ? 'objectKey' : part)] : issue.path })))
    return parsed.data
}

/** 原生参数转换完成后复核行与目标的顺序/身份，防止转换过程中遗漏或误改对象。 */
export function assertElementTargets(
    elements: readonly BoardElementRow[], operation: 'create' | 'update' | 'delete', targets: readonly { id?: string; type?: string }[],
): void {
    for (const [index, row] of elements.entries()) {
        if (row.operation !== 'reference' && row.operation !== operation) {
            throw new z.ZodError([{ code: 'custom', path: ['elements', index, 'operation'], message: '本次只能提交同一种写入，参照对象不参与写入' }])
        }
    }
    const changed = elements.filter(row => row.operation !== 'reference')
    if (changed.length !== targets.length || targets.some((target, index) =>
        target.type !== undefined && target.type !== changed[index].type || target.id !== undefined && target.id !== changed[index].shapeId)) {
        throw new z.ZodError([{ code: 'custom', path: ['elements'], message: '元素表与实际写入参数必须按顺序一一对应，不能遗漏或误改参照对象' }])
    }
}

/** covered 只能由应用层根据真实成功结果累计；本函数计算本步之后的缺项，不修改运行状态。 */
export function getUncoveredTaskObjects(
    brief: TaskBrief, covered: ReadonlySet<string>, rows: readonly Pick<BoardElementRow, 'key' | 'sourceKey'>[],
) {
    const stepKeys = new Set(rows.map(row => row.sourceKey ?? row.key))
    return z.array(taskObjectSchema).parse(brief.objects.filter(object => !covered.has(object.key) && !stepKeys.has(object.key)))
}
