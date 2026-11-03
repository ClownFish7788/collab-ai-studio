import { z } from 'zod'
import { defaultShapeSchemas } from '@tldraw/tlschema'
import { DRAFT_SHAPE_TYPES, DERIVED_SHAPE_PROPS } from '../draft/draftShapeSchema'
import { createBoardToolContracts } from '../../../agent/domain/tool'

export { shapeIdSchema } from '../../../agent/domain/observation'

export const nativeShapePropsDescription = `仅传明确设置的原生属性，省略使用原生默认值（更新时保留原值）。w/h 为 1～2000。文字使用 richText={"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"文字"}]}]}。属性按 type 校验，可写字段：${DRAFT_SHAPE_TYPES.map(type => `${type}: ${Object.keys(defaultShapeSchemas[type].props).filter(key => !DERIVED_SHAPE_PROPS[type]?.includes(key)).join('/')}`).join('；')}。text 设置 w 时同时指定 autoSize=false；note 尺寸用 scale。arrow.start/end 和 line.points 是元素局部坐标。draw/highlight 的 segments 必须是有效原生编码。image/video 仅引用已有 assetId，不能编造资产。`

export const boardToolContractSet = createBoardToolContracts(DRAFT_SHAPE_TYPES, nativeShapePropsDescription)

export const {
    tools: boardToolContracts, createShapeInputSchema, createShapesInputSchema, updateShapeInputSchema, updateShapesInputSchema,
    deleteShapesInputSchema, snapshotInputSchema, askInputSchema, getMutationIntentSchemas,
} = boardToolContractSet

export type CreateShapeParameters = z.infer<typeof createShapeInputSchema>
export type CreateShapesInput = z.infer<typeof createShapesInputSchema>
export type UpdateShapeParameters = z.infer<typeof updateShapeInputSchema>
export type UpdateShapesInput = z.infer<typeof updateShapesInputSchema>
export type DeleteShapesInput = z.infer<typeof deleteShapesInputSchema>
export type SnapshotInput = z.infer<typeof snapshotInputSchema>
export type SnapshotRange = SnapshotInput['range']
export type AskInput = z.infer<typeof askInputSchema>
