import { getElementTableContract as getDomainElementTableContract } from '../../../agent/domain/elements'
import { DRAFT_SHAPE_TYPES } from '../draft/draftShapeSchema'

export type { BoardElementRow } from '../../../agent/domain/elements'

/** 原生支持类型由适配边缘复核，领域只处理可移植的元素事实。 */
export function getElementTableContract(sourceKeys?: readonly string[], forWrite = false) {
    return getDomainElementTableContract(sourceKeys, forWrite).superRefine((rows, ctx) => {
        rows.forEach((row, index) => {
            if (row.type !== undefined && !DRAFT_SHAPE_TYPES.some(type => type === row.type)) {
                ctx.addIssue({ code: 'custom', path: [index, 'type'], message: '请在行顶层填写受支持的原生 type' })
            }
        })
    })
}
