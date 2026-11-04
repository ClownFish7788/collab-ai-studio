import { z } from 'zod'
import { defaultShapeSchemas, EnumStyleProp } from '@tldraw/tlschema'
import { DRAFT_SHAPE_TYPES, DERIVED_SHAPE_PROPS } from './draftShapeSchema'
import { createBoardToolContracts } from "../../domain/tool"

export { shapeIdSchema } from "../../domain/observation"

const nativePropertyEnums = Object.fromEntries(Object.values(defaultShapeSchemas).flatMap(({ props }) =>
    Object.entries(props).flatMap(([key, validator]) => validator instanceof EnumStyleProp ? [[key, validator.values]] : [])))

const vectorSchema: z.core.JSONSchema.JSONSchema = { type: 'object', properties: {
    x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
}, required: ['x', 'y'], additionalProperties: false }

// 仅补模型可见元数据；实际属性合法性仍以 defaultShapeSchemas 和项目原生校验为准。
const nativePropertySchemas: Record<string, z.core.JSONSchema.JSONSchema> = {
    ...Object.fromEntries(Object.entries(nativePropertyEnums).map(([key, values]) => [key, { type: 'string', enum: values }])),
    ...Object.fromEntries(['bend', 'labelPosition', 'elbowMidPoint', 'time'].map(key => [key, { type: 'number' }])),
    ...Object.fromEntries(['w', 'h'].map(key => [key, { type: 'number', minimum: 1, maximum: 2000 }])),
    scale: { type: 'number', exclusiveMinimum: 0, description: '缩放倍率，必须大于 0，例如 1 或 1.5；不能使用 size 的 s/m/l/xl。' },
    ...Object.fromEntries(['scaleX', 'scaleY'].map(key => [key, { type: 'number', not: { const: 0 } }])),
    ...Object.fromEntries(['isComplete', 'isClosed', 'isPen', 'playing', 'autoplay', 'flipX', 'flipY', 'autoSize'].map(key => [key, { type: 'boolean' }])),
    ...Object.fromEntries(['name', 'altText'].map(key => [key, { type: 'string' }])),
    url: { type: 'string', description: '空字符串或 http/https 链接。' },
    assetId: { anyOf: [{ type: 'string', pattern: '^asset:' }, { type: 'null' }], description: '仅引用已有资产 ID，不能编造；无资产时为 null。' },
    start: vectorSchema, end: vectorSchema,
    richText: { type: 'object', properties: { type: { type: 'string' }, content: { type: 'array', items: {} }, attrs: {} },
        required: ['type', 'content'], additionalProperties: false },
    points: { type: 'object', additionalProperties: { type: 'object', properties: {
        id: { type: 'string' }, index: { type: 'string', description: '原生排序键 IndexKey，例如 a1。' },
        x: { type: 'number' }, y: { type: 'number' },
    }, required: ['id', 'index', 'x', 'y'], additionalProperties: false } },
    segments: { type: 'array', items: { type: 'object', properties: {
        type: { type: 'string', enum: ['free', 'straight'] }, path: { type: 'string', description: '原生 delta-encoded base64 路径，不是坐标数组。' },
    }, required: ['type', 'path'], additionalProperties: false } },
    crop: { anyOf: [{ type: 'null' }, { type: 'object', properties: {
        topLeft: vectorSchema, bottomRight: vectorSchema, isCircle: { type: 'boolean' },
    }, required: ['topLeft', 'bottomRight'], additionalProperties: false }] },
}

export const nativeShapePropsDescription = `仅传明确设置的原生属性，省略使用原生默认值（更新时保留原值）。w/h、color、fill、font、size、richText、scale 等原生属性必须放在 props 内，不能放在 shapes/changes 每项的顶层。例如 {"type":"geo","x":0,"y":0,"props":{"w":240,"h":160,"fill":"solid"}}。w/h 为 1～2000。scale 是大于 0 的数字倍率，例如 1 或 1.5；数字和布尔值不能编码成字符串，具体类型及嵌套结构见 props 的属性 schema。fill 是填充方式，颜色用 color/labelColor；size 是枚举而非像素字号，font 是原生字体枚举而非 CSS 字体名。合法枚举：${JSON.stringify(nativePropertyEnums)}。文字使用 richText={"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"文字"}]}]}，scale 等图形属性放在 props 中，不能放进 richText。属性按 type 校验，可写字段：${DRAFT_SHAPE_TYPES.map(type => `${type}: ${Object.keys(defaultShapeSchemas[type].props).filter(key => !DERIVED_SHAPE_PROPS[type]?.includes(key)).join('/')}`).join('；')}。text 设置 w 时同时指定 autoSize=false；note 尺寸用 scale。arrow.start/end 和 line.points 是元素局部坐标。draw/highlight 的 segments 必须是有效原生编码。image/video 仅引用已有 assetId，不能编造资产。`

export const boardToolContractSet = createBoardToolContracts(DRAFT_SHAPE_TYPES, nativeShapePropsDescription, nativePropertySchemas)

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
