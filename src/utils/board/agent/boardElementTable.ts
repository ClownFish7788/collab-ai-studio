import { z } from 'zod'
import type { TaskBrief } from './boardTaskBrief'
import { MAX_BOARD_ELEMENT_ROWS, MAX_BOARD_ELEMENT_TABLE_CHARS } from '../boardCapabilities'
import { getElementTableContract, type BoardElementRow } from './boardElementTableSchema'
import { getMutationIntentSchemas } from './boardToolInputSchema'
import {
    BoardProtocolError, ERROR_CODES, parseCreateInput, parseUpdateInput, parseDeleteInput, parseSnapshotInput, parseAskInput, validateToolInput,
    type BoardToolCall,
} from './boardCreateProtocol'

export type { BoardElementRow } from './boardElementTableSchema'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** 读取/询问只检查自身参数；写入验证对象对应关系并移除模型元数据。 */
export function prepareElementTableCall(call: BoardToolCall, brief: TaskBrief, observedTypes: ReadonlyMap<string, string>): { call: BoardToolCall; elements: BoardElementRow[]; isFinal?: boolean } {
    if (call.function.name === 'get_board_snapshot' || call.function.name === 'ask_user') {
        const args = call.function.name === 'get_board_snapshot' ? parseSnapshotInput(call.function.arguments) : parseAskInput(call.function.arguments)
        return { call: { ...call, function: { ...call.function, arguments: JSON.stringify(args) } }, elements: [] }
    }
    const invalid = (path: string, message: string): never => { throw new BoardProtocolError({
        code: ERROR_CODES.INVALID_ARGUMENTS, message: `元素表校验失败：${message}`,
        issues: [{ path, message }],
    }) }
    let args: unknown
    try { args = JSON.parse(call.function.arguments) } catch { return invalid('arguments', '工具参数必须是合法 JSON') }
    const keys = new Set(brief.objects.map(object => object.key))
    if (call.function.name === 'create_shapes' || call.function.name === 'update_shapes' || call.function.name === 'delete_shapes') {
        const schemas = getMutationIntentSchemas([...keys])
        const intent = call.function.name === 'create_shapes' ? validateToolInput(schemas.create, args, '新增意图校验失败')
            : call.function.name === 'update_shapes' ? validateToolInput(schemas.update, args, '修改意图校验失败')
                : validateToolInput(schemas.delete, args, '删除意图校验失败')
        const targets = 'shapes' in intent ? intent.shapes : 'changes' in intent ? intent.changes : intent.targets
        const targetField = 'shapes' in intent ? 'shapes' : 'changes' in intent ? 'changes' : 'targets'
        const all = [...targets, ...(intent.references ?? [])]
        if (all.length > MAX_BOARD_ELEMENT_ROWS) return invalid('references', `目标与参照对象合计最多${MAX_BOARD_ELEMENT_ROWS}项`)
        const ids = new Set<string>()
        const counts = new Map<string, number>()
        all.forEach(target => counts.set(target.objectKey, (counts.get(target.objectKey) ?? 0) + 1))
        const reserved = new Set([...keys, ...counts.keys()])
        const elements = all.map((target, index) => {
            const path = index < targets.length ? `${targetField}[${index}]` : `references[${index - targets.length}]`
            const shapeId = 'shapeId' in target ? target.shapeId : undefined
            const type = 'type' in target ? target.type : shapeId ? observedTypes.get(shapeId) : undefined
            if (shapeId) {
                if (!type) return invalid(`${path}.shapeId`, 'ID 必须来自本任务附件、实际读取或新增结果，且未被删除')
                if (ids.has(shapeId)) return invalid(`${path}.shapeId`, '目标 ID 不能重复，也不能同时作为本步参照对象')
                ids.add(shapeId)
            }
            let key = target.objectKey
            if (counts.get(key)! > 1) {
                let suffix = index
                do { key = `element_${suffix++}` } while (reserved.has(key))
                reserved.add(key)
            }
            return {
                key, ...(key !== target.objectKey && keys.has(target.objectKey) ? { sourceKey: target.objectKey } : {}),
                role: brief.objects.find(object => object.key === target.objectKey)?.role ?? target.role,
                operation: index >= targets.length ? 'reference' as const : call.function.name === 'create_shapes' ? 'create' as const
                    : call.function.name === 'update_shapes' ? 'update' as const : 'delete' as const,
                type, ...(shapeId !== undefined ? { shapeId } : {}), known: {}, missing: [],
            }
        })
        args = {
            ...('shapes' in intent ? { shapes: intent.shapes.map(shape => ({
                type: shape.type, x: shape.x, y: shape.y,
                ...(shape.props !== undefined ? { props: shape.props } : {}),
                ...(shape.children !== undefined ? { children: shape.children } : {}),
            })) } : 'changes' in intent ? { shapes: intent.changes.map(change => ({
                id: change.shapeId, type: observedTypes.get(change.shapeId),
                ...(change.x !== undefined ? { x: change.x } : {}),
                ...(change.y !== undefined ? { y: change.y } : {}),
                ...(change.props !== undefined ? { props: change.props } : {}),
            })) } : { ids: intent.targets.map(target => target.shapeId) }),
            elements, isFinal: intent.isFinal,
        }
    }
    if (!record(args) || !Array.isArray(args.elements)) return invalid('elements', '每次工具调用必须提供 elements 数组')
    const operation = call.function.name === 'create_shapes' ? 'create' : call.function.name === 'update_shapes' ? 'update' : 'delete'
    if (operation && typeof args.isFinal !== 'boolean') return invalid('isFinal', '写入调用必须提供布尔值 isFinal；仅当本次写入成功后全部任务完成时为 true')
    if (JSON.stringify(args.elements).length > MAX_BOARD_ELEMENT_TABLE_CHARS || args.elements.length > MAX_BOARD_ELEMENT_ROWS) return invalid('elements', `最多${MAX_BOARD_ELEMENT_ROWS}项、${MAX_BOARD_ELEMENT_TABLE_CHARS}字符`)
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
    for (const [index, row] of elements.entries()) {
        const path = `elements[${index}]`
        if (supplied.has(row.key)) return invalid(path, '元素 key 必须唯一')
        supplied.add(row.key)
        const source = row.sourceKey ?? row.key
        if (keys.size) {
            if (!keys.has(source) || keys.has(row.key) && source !== row.key) return invalid(`${path}.sourceKey`, '必须引用原始需求中的对象，不能替换其他对象的 key')
        }
        if (row.shapeId !== undefined && !observedTypes.has(row.shapeId)) return invalid(`${path}.shapeId`, 'ID 必须来自本任务附件、实际读取或新增结果，且未被删除')
    }
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
        let targets
        try {
            targets = call.function.name === 'create_shapes' ? parseCreateInput(nativeCall.function.arguments).shapes
                : call.function.name === 'update_shapes' ? parseUpdateInput(nativeCall.function.arguments).shapes
                    : parseDeleteInput(nativeCall.function.arguments).ids.map(id => ({ id }))
        } catch (cause) {
            if (call.function.name === 'update_shapes' && cause instanceof BoardProtocolError) throw new BoardProtocolError({
                ...cause.detail, issues: cause.detail.issues?.map(issue => ({ ...issue, path: issue.path.replace(/^shapes\[/, 'changes[') })),
            })
            throw cause
        }
        if (changed.length !== targets.length || targets.some((target, index) =>
            'type' in target && target.type !== changed[index].type || 'id' in target && target.id !== changed[index].shapeId)) return invalid('elements', '元素表与实际写入参数必须按顺序一一对应，不能遗漏或误改参照对象')
    }
    return { call: nativeCall, elements, isFinal: operation ? args.isFinal as boolean : undefined }
}

export function formatElementTable(elements: readonly BoardElementRow[], call: BoardToolCall): string {
    if (!elements.length) return ''
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
