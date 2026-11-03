import { z } from 'zod'
import { assertElementTargets, prepareElementRows } from '../../../agent/domain/elements'
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
    if (call.function.name === 'get_board_snapshot' || call.function.name === 'get_board_screenshot' || call.function.name === 'ask_user') {
        const args = call.function.name === 'ask_user' ? parseAskInput(call.function.arguments) : parseSnapshotInput(call.function.arguments)
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
        let elements: BoardElementRow[]
        try {
            elements = prepareElementRows(targets, intent.references ?? [],
                call.function.name === 'create_shapes' ? 'create' : call.function.name === 'update_shapes' ? 'update' : 'delete', brief, observedTypes)
        } catch (cause) {
            if (!(cause instanceof z.ZodError)) throw cause
            const issues = cause.issues.slice(0, 40).map(issue => ({
                path: (typeof issue.path[0] === 'number' ? 'elements' : '') + issue.path.map((part, index) =>
                    typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join(''),
                message: issue.message.slice(0, 200),
            }))
            throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '元素表校验失败：' + issues[0].message, issues })
        }
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
    const nativeArgs = { ...args }
    delete nativeArgs.elements
    if (operation) delete nativeArgs.isFinal
    const nativeCall = { ...call, function: { ...call.function, arguments: JSON.stringify(nativeArgs) } }
    if (operation) {
        let targets
        try {
            targets = call.function.name === 'create_shapes' ? parseCreateInput(nativeCall.function.arguments).shapes
                : call.function.name === 'update_shapes' ? parseUpdateInput(nativeCall.function.arguments).shapes
                    : parseDeleteInput(nativeCall.function.arguments).ids.map(id => ({ id }))
            assertElementTargets(elements, operation, targets)
        } catch (cause) {
            if (cause instanceof z.ZodError) {
                const issue = cause.issues[0]
                const path = issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('')
                return invalid(path, issue.message)
            }
            if (call.function.name === 'update_shapes' && cause instanceof BoardProtocolError) throw new BoardProtocolError({
                ...cause.detail, issues: cause.detail.issues?.map(issue => ({ ...issue, path: issue.path.replace(/^shapes\[/, 'changes[') })),
            })
            throw cause
        }
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
