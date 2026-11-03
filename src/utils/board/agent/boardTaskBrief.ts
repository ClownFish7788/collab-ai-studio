import type { TaskBrief } from '../../../agent/domain/task'

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
