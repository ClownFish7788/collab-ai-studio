import { z } from 'zod'
import { defaultShapeSchemas, EnumStyleProp } from '@tldraw/tlschema'
import { DRAFT_SHAPE_TYPES, DERIVED_SHAPE_PROPS } from './draftShapeSchema'
import { createBoardToolContracts } from "../../domain/tool"

export { shapeIdSchema } from "../../domain/observation"

const nativePropertyEnums = Object.fromEntries(Object.values(defaultShapeSchemas).flatMap(({ props }) =>
    Object.entries(props).flatMap(([key, validator]) => validator instanceof EnumStyleProp ? [[key, validator.values]] : [])))

export const nativeShapePropsDescription = `仅传明确设置的原生属性，省略使用原生默认值（更新时保留原值）。w/h、color、fill、font、size、richText、scale 等原生属性必须放在 props 内，不能放在 shapes/changes 每项的顶层。例如 {"type":"geo","x":0,"y":0,"props":{"w":240,"h":160,"fill":"solid"}}。w/h 为 1～2000。fill 是填充方式，颜色用 color/labelColor；size 是枚举而非像素字号，font 是原生字体枚举而非 CSS 字体名。合法枚举：${JSON.stringify(nativePropertyEnums)}。文字使用 richText={"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"文字"}]}]}，scale 等图形属性放在 props 中，不能放进 richText。属性按 type 校验，可写字段：${DRAFT_SHAPE_TYPES.map(type => `${type}: ${Object.keys(defaultShapeSchemas[type].props).filter(key => !DERIVED_SHAPE_PROPS[type]?.includes(key)).join('/')}`).join('；')}。text 设置 w 时同时指定 autoSize=false；note 尺寸用 scale。arrow.start/end 和 line.points 是元素局部坐标。draw/highlight 的 segments 必须是有效原生编码。image/video 仅引用已有 assetId，不能编造资产。`

export const boardToolContractSet = createBoardToolContracts(DRAFT_SHAPE_TYPES, nativeShapePropsDescription, nativePropertyEnums)

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
