import { z } from 'zod'
import { defaultShapeSchemas } from '@tldraw/tlschema'
import { DRAFT_SHAPE_TYPES, DERIVED_SHAPE_PROPS } from '../draft/draftShapeSchema'
import { MAX_BOARD_WRITE_SHAPES } from '../boardCapabilities'

export const nativeShapePropsDescription = `仅传明确设置的原生属性，省略使用原生默认值（更新时保留原值）。w/h 为 1～2000。文字使用 richText={"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"文字"}]}]}。属性按 type 校验，可写字段：${DRAFT_SHAPE_TYPES.map(type => `${type}: ${Object.keys(defaultShapeSchemas[type].props).filter(key => !DERIVED_SHAPE_PROPS[type]?.includes(key)).join('/')}`).join('；')}。text 设置 w 时同时指定 autoSize=false；note 尺寸用 scale。arrow.start/end 和 line.points 是元素局部坐标。draw/highlight 的 segments 必须是有效原生编码。image/video 仅引用已有 assetId，不能编造资产。`

const coordinateSchema = z.number().min(-10000).max(10000)
const childrenSchema = z.array(z.string().regex(/^shape:[\w-]{1,128}$/)).min(2).max(30)
    .refine(ids => new Set(ids).size === ids.length, '分组子元素 ID 不能重复')
    .meta({ uniqueItems: true })
    .describe('已有且已读取的子元素 ID；同一批次的多个分组不能复用子元素。')
const propsSchema = z.preprocess((value, ctx) => {
    // Zod record 会跳过 __proto__；先拒绝该键，避免静默丢弃请求中的属性。
    if (value && typeof value === 'object' && Object.hasOwn(value, '__proto__')) {
        ctx.addIssue({ code: 'custom', message: '包含不支持的属性名' })
    }
    return value
}, z.record(z.string().regex(/^(?!__proto__$)/), z.unknown()))
const commonFields = {
    x: coordinateSchema,
    y: coordinateSchema,
    props: propsSchema.describe(nativeShapePropsDescription).optional(),
}

export const createShapeInputSchema = z.discriminatedUnion('type', [
    z.strictObject({
        type: z.enum(DRAFT_SHAPE_TYPES.filter(type => type !== 'group')),
        ...commonFields,
        children: z.never().optional(),
    }),
    z.strictObject({ type: z.literal('group'), ...commonFields, children: childrenSchema }),
])

export const createShapesInputSchema = z.strictObject({
    shapes: z.array(createShapeInputSchema).min(1).max(MAX_BOARD_WRITE_SHAPES),
})

export type CreateShapeParameters = z.infer<typeof createShapeInputSchema>
export type CreateShapesInput = z.infer<typeof createShapesInputSchema>
