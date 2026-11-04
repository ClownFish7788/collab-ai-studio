import type { TaskBrief } from '../../domain/task'
import type { BoardElementRow } from '../../domain/elements'
import type { BoardToolCall } from '../transport/boardProtocol'

/** 只展示已校验的领域任务，不决定准备重试或执行流程。 */
export function formatTaskBrief(brief: TaskBrief): string {
    return [
        `目标：${brief.goal}`,
        `任务点：\n${brief.tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')}`,
        ...(brief.objects.length ? [`对象与包含关系：\n${brief.objects.map(object => `- ${object.key}：${object.role}；${object.description}${object.parentKey ? `；属于 ${object.parentKey}` : ''}`).join('\n')}`] : []),
        ...(brief.relations.length ? [`关联：\n${brief.relations.map(relation => `- ${relation.from} → ${relation.to}：${relation.description}`).join('\n')}`] : []),
        ...(brief.constraints.length ? [`约束：\n${brief.constraints.map(item => `- ${item}`).join('\n')}`] : []),
        ...(brief.unresolvedQuestions.length ? [`待确定（继续读取或询问）：\n${brief.unresolvedQuestions.map(item => `- ${item}`).join('\n')}`] : []),
    ].join('\n\n')
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
