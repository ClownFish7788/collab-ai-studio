import { z } from 'zod'
import type { TaskBrief } from './boardTaskBrief'
import { MAX_BOARD_ELEMENT_ROWS, MAX_BOARD_ELEMENT_TABLE_CHARS } from '../boardCapabilities'
import { getElementTableContract, type BoardElementRow } from './boardElementTableSchema'
import {
    BoardProtocolError, ERROR_CODES, parseCreateInput, parseUpdateInput, parseDeleteInput,
    type BoardToolCall,
} from './boardCreateProtocol'

export type { BoardElementRow } from './boardElementTableSchema'
export { getElementTableSchema } from './boardElementTableSchema'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** 验证逻辑对象、缺项及实际操作的对应关系；移除模型元数据后才能调用浏览器工具。 */
export function prepareElementTableCall(call: BoardToolCall, brief: TaskBrief, seenIds: ReadonlySet<string>): { call: BoardToolCall; elements: BoardElementRow[]; isFinal?: boolean } {
    const invalid = (path: string, message: string): never => { throw new BoardProtocolError({
        code: ERROR_CODES.INVALID_ARGUMENTS, message: `元素表校验失败：${message}`,
        issues: [{ path, message }],
    }) }
    let args: unknown
    try { args = JSON.parse(call.function.arguments) } catch { return invalid('arguments', '工具参数必须是合法 JSON') }
    if (!record(args) || !Array.isArray(args.elements)) return invalid('elements', '每次工具调用必须提供 elements 数组')
    const operation = call.function.name === 'create_shapes' ? 'create' : call.function.name === 'update_shapes' ? 'update' : call.function.name === 'delete_shapes' ? 'delete' : undefined
    if (operation && typeof args.isFinal !== 'boolean') return invalid('isFinal', '写入调用必须提供布尔值 isFinal；仅当本次写入成功后全部任务完成时为 true')
    if (JSON.stringify(args.elements).length > MAX_BOARD_ELEMENT_TABLE_CHARS || args.elements.length > MAX_BOARD_ELEMENT_ROWS) return invalid('elements', `最多${MAX_BOARD_ELEMENT_ROWS}项、${MAX_BOARD_ELEMENT_TABLE_CHARS}字符`)
    const keys = new Set(brief.objects.map(object => object.key))
    const parsed = getElementTableContract([...keys], !!operation).safeParse(args.elements, { error: z.locales.zhCN().localeError })
    if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 40).map(issue => ({
            path: 'elements' + issue.path.map(part => typeof part === 'number' ? `[${part}]` : `.${String(part)}`).join(''),
            message: issue.message,
        }))
        throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS,
            message: '元素表校验失败：' + issues.slice(0, 3).map(issue => `${issue.path} ${issue.message}`).join('；'), issues })
    }
    const elements: BoardElementRow[] = parsed.data
    const supplied = new Set<string>()
    const covered = new Set<string>()
    for (const [index, row] of elements.entries()) {
        const path = `elements[${index}]`
        if (supplied.has(row.key)) return invalid(path, '元素 key 必须唯一')
        supplied.add(row.key)
        const source = row.sourceKey ?? row.key
        if (keys.size) {
            if (!keys.has(source) || keys.has(row.key) && source !== row.key) return invalid(`${path}.sourceKey`, '必须引用原始需求中的对象，不能替换其他对象的 key')
            covered.add(source)
        }
        if (row.shapeId !== undefined && !seenIds.has(row.shapeId)) return invalid(`${path}.shapeId`, 'ID 必须来自本任务附件、实际读取或新增结果，且未被删除')
    }
    if (!operation && covered.size !== keys.size) return invalid('elements', '读取或询问须覆盖需求中的全部对象，包括仅作参照的对象')
    const nativeArgs = { ...args }
    delete nativeArgs.elements
    if (operation) delete nativeArgs.isFinal
    const nativeCall = { ...call, function: { ...call.function, arguments: JSON.stringify(nativeArgs) } }
    if (operation) {
        for (const [index, row] of elements.entries()) {
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
    return { call: nativeCall, elements, isFinal: operation ? args.isFinal as boolean : undefined }
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
