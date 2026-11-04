import type { BoardElementRow } from '../../../agent/domain/elements'
import type { BoardToolCall } from '../../../agent/adapters/transport/boardProtocol'

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
