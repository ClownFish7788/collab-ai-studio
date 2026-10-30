import { DRAFT_SHAPE_TYPES, type DraftShapeType } from '../draft/draftShapeSchema'
import type { TaskBrief } from './boardTaskBrief'
import { MAX_BOARD_ELEMENT_ROWS, MAX_BOARD_ELEMENT_TABLE_CHARS } from '../boardCapabilities'
import {
    BoardProtocolError, ERROR_CODES, parseCreateInput, parseUpdateInput, parseDeleteInput,
    type BoardToolCall,
} from './boardCreateProtocol'

/** known 是模型整理的已知信息，不授予对象权限；实际写入参数仍由原生协议校验。 */
export type BoardElementRow = {
    key: string
    sourceKey?: string
    role?: string
    operation: 'create' | 'update' | 'delete' | 'reference'
    type?: DraftShapeType
    shapeId?: string
    known: Record<string, string | number | boolean>
    missing: { field: string; source: 'read' | 'ask' | 'calculate' }[]
}

/** 只附加到服务端模型工具；浏览器仍接收原来的原生工具协议。 */
export const elementTableSchema = {
    type: 'array', maxItems: MAX_BOARD_ELEMENT_ROWS,
    description: '完整元素表，通过 key 或 sourceKey 覆盖 task_brief.objects，包括参照对象。预期对象列表为空时从原始需求补齐并填写 role。读取/询问可有缺项，写入时 missing 全为空，按实际参数顺序列出待写入元素。',
    items: {
        type: 'object', additionalProperties: false, required: ['key', 'operation', 'known', 'missing'],
        properties: {
            key: { type: 'string', pattern: '^[a-zA-Z][\\w-]{0,63}$' },
            sourceKey: { type: 'string', description: '将一个语义对象展开为多个实际元素时，引用 task_brief.objects 中的 key。' },
            role: { type: 'string', minLength: 1, maxLength: 100, description: '对象用途；当准备阶段的 objects 为空时必须填写，且只能补齐原始需求涉及的对象。' },
            operation: { type: 'string', enum: ['create', 'update', 'delete', 'reference'] },
            type: { type: 'string', enum: DRAFT_SHAPE_TYPES },
            shapeId: { type: 'string', pattern: '^shape:[\\w-]{1,128}$', description: '仅填写本任务附件或读取结果已返回的真实 ID；新增对象不得填写。' },
            known: { type: 'object', maxProperties: 12,
                propertyNames: { minLength: 1, maxLength: 64, pattern: '\\S' },
                additionalProperties: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'number' }, { type: 'boolean' }] },
                description: '已知信息的平面字段表，如 {"props.color":"blue","颜色要求":"同行不同色"}；字段名允许中文，文字值最多300字符，未知值不填，不能用 null、数组或对象占位。' },
            missing: { type: 'array', maxItems: 8, items: {
                type: 'object', additionalProperties: false, required: ['field', 'source'],
                properties: { field: { type: 'string', minLength: 1, maxLength: 100 }, source: { type: 'string', enum: ['read', 'ask', 'calculate'] } },
            } },
        },
    },
} as const

/** 本轮上游对象的真实 key 进入工具声明；省略上下文仅供独立适配器调用。 */
export function getElementTableSchema(sourceKeys?: readonly string[]) {
    if (!sourceKeys) return elementTableSchema
    const properties: Record<string, unknown> = { ...elementTableSchema.items.properties }
    if (sourceKeys.length) properties.sourceKey = { ...elementTableSchema.items.properties.sourceKey, enum: sourceKeys }
    else delete properties.sourceKey
    return { ...elementTableSchema, minItems: sourceKeys.length, items: {
        ...elementTableSchema.items,
        properties,
        required: sourceKeys.length ? elementTableSchema.items.required : [...elementTableSchema.items.required, 'role'],
        ...(sourceKeys.length ? { anyOf: [
            { properties: { key: { enum: sourceKeys } } },
            { required: ['sourceKey'] },
        ] } : {}),
    } }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const fields = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key))

/** 验证逻辑对象、缺项及实际操作的对应关系；移除模型元数据后才能调用浏览器工具。 */
export function prepareElementTableCall(call: BoardToolCall, brief: TaskBrief, seenIds: ReadonlySet<string>): { call: BoardToolCall; elements: BoardElementRow[] } {
    const invalid = (path: string, message: string): never => { throw new BoardProtocolError({
        code: ERROR_CODES.INVALID_ARGUMENTS, message: `元素表校验失败：${message}`,
        issues: [{ path, message }],
    }) }
    let args: unknown
    try { args = JSON.parse(call.function.arguments) } catch { return invalid('arguments', '工具参数必须是合法 JSON') }
    if (!record(args) || !Array.isArray(args.elements)) return invalid('elements', '每次工具调用必须提供 elements 数组')
    if (JSON.stringify(args.elements).length > MAX_BOARD_ELEMENT_TABLE_CHARS || args.elements.length > MAX_BOARD_ELEMENT_ROWS) return invalid('elements', `最多${MAX_BOARD_ELEMENT_ROWS}项、${MAX_BOARD_ELEMENT_TABLE_CHARS}字符`)
    const keys = new Set(brief.objects.map(object => object.key))
    const supplied = new Set<string>()
    const covered = new Set<string>()
    for (const [index, row] of args.elements.entries()) {
        const path = `elements[${index}]`
        if (!record(row) || !fields(row, ['key', 'sourceKey', 'role', 'operation', 'type', 'shapeId', 'known', 'missing'])
            || typeof row.key !== 'string' || !/^[a-zA-Z][\w-]{0,63}$/.test(row.key) || supplied.has(row.key)
            || !['create', 'update', 'delete', 'reference'].includes(row.operation as string)) return invalid(path, '必须使用需求中的唯一 key 和合法操作类型')
        supplied.add(row.key)
        if (row.role !== undefined && (typeof row.role !== 'string' || !row.role.trim() || row.role.length > 100)) return invalid(`${path}.role`, '用途必须是1～100字符的非空文字')
        const source = row.sourceKey ?? row.key
        if (keys.size) {
            if (typeof source !== 'string' || !keys.has(source) || keys.has(row.key) && source !== row.key) return invalid(`${path}.sourceKey`, '必须引用原始需求中的对象，不能替换其他对象的 key')
            covered.add(source)
        } else if (row.sourceKey !== undefined || !row.role) return invalid(path, '预期对象列表为空时，应从原始需求补齐元素并声明 role 用途')
        if (row.type !== undefined && !DRAFT_SHAPE_TYPES.includes(row.type as DraftShapeType)) return invalid(`${path}.type`, '原生元素类型不合法')
        if (row.shapeId !== undefined && (typeof row.shapeId !== 'string' || !seenIds.has(row.shapeId))) return invalid(`${path}.shapeId`, 'ID 必须来自本任务附件或实际读取结果')
        if (row.operation === 'create' && row.shapeId !== undefined) return invalid(`${path}.shapeId`, '新增对象不得使用已有对象 ID')
        if (!record(row.known) || Object.keys(row.known).length > 12 || Object.entries(row.known).some(([key, value]) =>
            !key.trim() || key.length > 64 || !(typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 300))) return invalid(`${path}.known`, '已知信息最多12个平面字段，字段名须为1～64字符的非空文字，值须为有限数值、布尔或最多300字符文字')
        if (!Array.isArray(row.missing) || row.missing.length > 8 || row.missing.some(item => !record(item)
            || !fields(item, ['field', 'source']) || typeof item.field !== 'string' || !item.field.trim() || item.field.length > 100
            || !['read', 'ask', 'calculate'].includes(item.source as string))) return invalid(`${path}.missing`, '缺项需说明字段及 read、ask 或 calculate 来源')
    }
    if (covered.size !== keys.size) return invalid('elements', '必须覆盖需求中的全部对象，包括仅作参照的对象')
    const elements = args.elements as BoardElementRow[]
    const nativeArgs = { ...args }
    delete nativeArgs.elements
    const nativeCall = { ...call, function: { ...call.function, arguments: JSON.stringify(nativeArgs) } }
    const operation = call.function.name === 'create_shapes' ? 'create' : call.function.name === 'update_shapes' ? 'update' : call.function.name === 'delete_shapes' ? 'delete' : undefined
    if (operation) {
        for (const [index, row] of elements.entries()) {
            if (row.missing.length) return invalid(`elements[${index}].missing`, '仍有待读取、待询问或待计算的数据，不能提交写入')
            if (!row.type || row.operation !== 'create' && !row.shapeId) return invalid(`elements[${index}]`, '写入前必须确定原生类型及已有对象真实 ID')
            if (row.operation !== 'reference' && row.operation !== operation) return invalid(`elements[${index}].operation`, '本次只能提交同一种写入，参照对象不参与写入')
        }
        const changed = elements.filter(row => row.operation !== 'reference')
        const referenceIds = new Set(elements.filter(row => row.operation === 'reference').map(row => row.shapeId))
        if (changed.some(row => row.shapeId && referenceIds.has(row.shapeId))) return invalid('elements', '仅作参照的真实对象不能通过其他表项参与写入')
        const targets = call.function.name === 'create_shapes' ? parseCreateInput(nativeCall.function.arguments).shapes
            : call.function.name === 'update_shapes' ? parseUpdateInput(nativeCall.function.arguments).shapes
                : parseDeleteInput(nativeCall.function.arguments).ids.map(id => ({ id }))
        if (changed.length !== targets.length || targets.some((target, index) =>
            'type' in target && target.type !== changed[index].type || 'id' in target && target.id !== changed[index].shapeId)) return invalid('elements', '元素表与实际写入参数必须按顺序一一对应，不能遗漏或误改参照对象')
    }
    return { call: nativeCall, elements }
}

export function formatElementTable(elements: readonly BoardElementRow[], call: BoardToolCall): string {
    const operations = { create: '新增', update: '修改', delete: '删除', reference: '仅作参照' }
    const sources = { read: '读取', ask: '询问', calculate: '计算' }
    const shapes = ['create_shapes', 'update_shapes'].includes(call.function.name) ? JSON.parse(call.function.arguments).shapes : []
    let changed = 0
    return '元素表：\n' + elements.map(row => {
        const shape = row.operation === 'reference' ? undefined : shapes[changed++]
        const values = { x: shape?.x, y: shape?.y, w: shape?.props?.w, h: shape?.props?.h, color: shape?.props?.color, geo: shape?.props?.geo }
        const submitted = Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`).join('；')
        return [
            `- ${row.key}${row.role ? `（${row.role}）` : ''}：${operations[row.operation]}；类型 ${row.type ?? '待确定'}${row.shapeId ? `；${row.shapeId}` : ''}${row.sourceKey ? `；来源 ${row.sourceKey}` : ''}`,
            ...(Object.keys(row.known).length ? [`  已知：${Object.entries(row.known).map(([key, value]) => `${key}=${value}`).join('；')}`] : []),
            `  ${row.missing.length ? '待补：' + row.missing.map(item => `${item.field}（${sources[item.source]}）`).join('；') : '缺项：无'}`,
            ...(submitted ? [`  提交参数：${submitted}`] : []),
        ].join('\n')
    }).join('\n')
}
