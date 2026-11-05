import { z } from 'zod'
import { jsonObjectSchema, jsonValuesEqual, type JsonValue } from './data'
import { toolCallIdSchema } from './invocation'
import { MAX_BOARD_TOOL_ARGUMENT_CHARS, MAX_BOARD_WRITE_SHAPES } from './tool'

/**
 * 判断一个值是否为非 null、非数组的对象，供已通过 JSON 边界校验的数据分支使用。
 * @param value 待判断的值。
 * @returns 是对象时返回 true 并缩窄类型，否则返回 false；不校验原型、属性值或嵌套深度。
 */
const object = (value: unknown): value is Record<string, JsonValue> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
/**
 * 将补全过程中的业务约束错误转换为带字段路径的 Zod 错误，交由应用层统一反馈。
 * @param message 可反馈给模型的错误原因。
 * @param path 相对于工具输入的字段路径，例如 ['patches', 0, 'itemKey']；省略表示整个输入。
 * @returns 不返回，始终抛出异常。
 * @throws {z.ZodError} 包含一条 custom 问题，保留传入的 message 和 path。
 */
const invalid = (message: string, path: (string | number)[] = []): never => {
    throw new z.ZodError([{ code: 'custom', path, message }])
}

/**
 * 从已有写入工具契约派生纠错契约，允许模型提交完整参数或针对旧调用的增量补丁。
 * 不修改原 schema，不读取任务上下文，也不执行白板操作。
 * @param fullSchema create_shapes、update_shapes 或 delete_shapes 的完整输入 Zod 对象 schema。
 * 必须包含 shapes/changes/targets 之一的对象数组，以及 references 和 isFinal 字段声明。
 * 数组项 props 的 JSON Schema 元数据用于识别误放在顶层、应移动到 props 的原生属性。
 * @returns 包含三个成员的对象：modelSchema 是提供给模型的联合 schema；
 * items(input) 提取可用于增量纠正的旧数组；merge(base, input) 返回合并后的完整候选参数。
 * 合并结果仍须经过原工具的完整结构、任务范围和原生属性校验，不能直接派发执行。
 * @throws {Error} 传入的契约没有受支持的写入数组，或数组项不是对象 schema。
 * @example
 * const correction = getToolCorrectionContract(tools.create_shapes.inputSchema)
 * const parameters = z.toJSONSchema(correction.modelSchema)
 * const candidate = correction.merge(oldInput, {
 *   retryOf: 'failed_call', patches: [{ itemKey: 'item_0', props: { font: 'sans' } }],
 * })
 */
export function getToolCorrectionContract(fullSchema: z.ZodObject) {
    const field = ['shapes', 'changes', 'targets'].find(key => fullSchema.shape[key] instanceof z.ZodArray)
    if (!field) throw new Error('补全仅适用于写入工具')
    const array: z.ZodArray = fullSchema.shape[field]
    const variants = (array.element instanceof z.ZodDiscriminatedUnion ? array.element.options : [array.element]).map(schema => {
        if (!(schema instanceof z.ZodObject)) throw new Error('写入数组须由对象组成')
        return schema
    })
    const fields = new Map<string, z.ZodType[]>()
    for (const variant of variants) {
        for (const [key, schema] of Object.entries(variant.shape)) {
            const schemas = fields.get(key) ?? []
            if (!schemas.includes(schema)) schemas.push(schema)
            fields.set(key, schemas)
        }
    }
    const partial = z.strictObject({
        ...Object.fromEntries([...fields].map(([key, schemas]) => [key, (schemas.length === 1 ? schemas[0] : z.union(schemas)).optional()])),
        itemKey: z.string().regex(/^item_(0|[1-9]\d?)$/).describe('旧调用数组的固定序号，例如 item_0；不是 objectKey 或元素 ID。'),
    }).refine(item => Object.keys(item).length > 1, '补丁须包含至少一个修改字段').meta({ minProperties: 2 })
    const patchSchema = z.strictObject({
        retryOf: toolCallIdSchema.describe('本任务中已收到 not_executed / INVALID_ARGUMENTS 结果的原调用 ID。'),
        patches: z.array(partial).max(MAX_BOARD_WRITE_SHAPES),
        references: fullSchema.shape.references,
        isFinal: fullSchema.shape.isFinal.optional(),
    }).refine(patch => patch.patches.length > 0 || patch.references !== undefined || patch.isFinal !== undefined,
        '须指定元素补丁、references 或 isFinal').describe('仅纠正未执行的旧调用；未提及的元素和字段保留，props 按字段合并，嵌套值整体替换。')
    const modelSchema = z.union([fullSchema.safeExtend({ retryOf: toolCallIdSchema.optional()
        .describe('完整替代旧失败调用时指定其 ID；完整替代不会继承旧字段。首次调用省略。') }), patchSchema])
    const nativeFields = new Set<string>()
    const itemFields = new Set<string>()
    for (const variant of variants) {
        Object.keys(variant.shape).forEach(key => itemFields.add(key))
        const props = z.toJSONSchema(variant, { target: 'draft-7' }).properties?.props
        if (props && typeof props === 'object') Object.keys(props.properties ?? {}).forEach(key => nativeFields.add(key))
    }

    return { modelSchema,
        /**
         * 提取旧调用中可用于生成 itemKey 的数组，仅判断是否具备增量合并所需的基本结构。
         * @param input 当前工具的完整候选参数，例如 { shapes: [...], isFinal: false }。
         * @returns 1～MAX_BOARD_WRITE_SHAPES 个对象组成的原数组引用；字段缺失、类型不符、
         * 空数组、超出项数或含非对象项时返回 undefined。返回值应只读使用，不修改旧参数。
         * 返回数组不代表其中的坐标、props 或对象身份已经通过完整校验。
         */
        items(input: JsonValue) {
            const items = object(input) ? input[field] : undefined
            return Array.isArray(items) && items.length > 0 && items.length <= MAX_BOARD_WRITE_SHAPES && items.every(object) ? items : undefined
        },
        /**
         * 将纠错补丁合并到旧调用的参数副本，避免重发时遗漏其他元素、尺寸或属性。
         * @param base 同一旧失败调用的完整候选参数；允许包含尚未通过校验的字段值。
         * @param input 补丁对象：retryOf 为旧调用 ID；patches 每项用 item_N 指定旧数组中
         * 从 0 开始的固定序号，并填写要修改的字段。可选 references/isFinal 整项覆盖旧值。
         * @returns 新的完整参数对象，不修改 base 或 input，也不填默认值或转换字段类型。
         * 未提及的元素和字段保留；props 浅合并，其内部对象/数组整项替换；可识别的顶层
         * 原生属性移入 props。已有 objectKey/type/shapeId 不能通过补丁更换。
         * @throws {z.ZodError} 补丁格式错误、原数组不可合并、itemKey 重复/越界、身份变更、
         * 顶层属性与 props 冲突未明确解决，或结果违反安全 JSON、深度和参数大小限制。
         * retryOf 的任务归属及未执行状态由应用层检查；本方法不验证这些执行事实。
         * 必须以 correction.merge(base, input) 调用，保留 this；返回值仍需完整工具校验。
         */
        merge(base: JsonValue, input: JsonValue): JsonValue {
            const patch = patchSchema.parse(input)
            const patches: (Record<string, unknown> & { itemKey: string })[] = patch.patches
            const source = this.items(base)
            if (!source || !object(base)) return invalid('旧参数不是完整对象数组，请使用 retryOf 提交整份替代参数')
            const merged = structuredClone(base)
            const items = structuredClone(source)
            const seen = new Set<number>()
            for (const [position, change] of patches.entries()) {
                const index = Number(change.itemKey.slice(5))
                if (index >= items.length || seen.has(index)) return invalid('itemKey 越界或重复', ['patches', position, 'itemKey'])
                seen.add(index)
                const target = items[index]
                for (const [key, value] of Object.entries(change)) {
                    if (key === 'itemKey') continue
                    if (['objectKey', 'type', 'shapeId'].includes(key) && Object.hasOwn(target, key) && !jsonValuesEqual(target[key], value)) {
                        return invalid('已有身份字段不可增量更换，请使用 retryOf 提交整份替代参数', ['patches', position, key])
                    }
                    if (key === 'props' && object(value)) target.props = { ...(object(target.props) ? target.props : {}), ...value }
                    else target[key] = value as JsonValue
                }
            }
            // 原生字段误放在顶层时移动位置，不能在纠错中静默丢掉已有尺寸。
            items.forEach((item, index) => {
                for (const key of Object.keys(item)) {
                    if (itemFields.has(key) || !nativeFields.has(key)) continue
                    if (item.props !== undefined && !object(item.props)) return invalid('props 必须是对象', [field, index, 'props'])
                    const props = object(item.props) ? item.props : {}
                    const explicit = patches.some(change => change.itemKey === `item_${index}` && object(change.props) && Object.hasOwn(change.props, key))
                    if (!explicit && Object.hasOwn(props, key) && !jsonValuesEqual(props[key], item[key])) {
                        return invalid('顶层属性与 props 冲突，请在补丁 props 中明确指定', [field, index, key])
                    }
                    if (!explicit) props[key] = item[key]
                    item.props = props
                    delete item[key]
                }
            })
            merged[field] = items
            if (patch.references !== undefined) merged.references = patch.references
            if (patch.isFinal !== undefined) merged.isFinal = patch.isFinal
            const safe = jsonObjectSchema.parse(merged)
            if (JSON.stringify(safe).length > MAX_BOARD_TOOL_ARGUMENT_CHARS) return invalid('补全后的参数超过大小限制')
            return safe
        },
    }
}
