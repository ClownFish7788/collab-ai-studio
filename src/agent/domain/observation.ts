import { z } from 'zod'

export const MAX_BOARD_SNAPSHOT_SHAPES = 30
/** 写入协议的 ID 格式；观察事实保持原快照允许的 shape: 非空标识。 */
export const shapeIdSchema = z.string().regex(/^shape:[\w-]{1,128}$/)
const observedShapeIdSchema = z.string().startsWith('shape:').min(7)
export const shapeTypeSchema = z.string().min(1)
export const boardReferenceSchema = z.strictObject({
    id: observedShapeIdSchema.nullable(), x: z.number(), y: z.number(),
})

/** 仅保留领域决策所需的观察事实；截图、原生 props 和展示文字由适配层保留。 */
export const boardObservationSchema = z.strictObject({
    reference: boardReferenceSchema,
    shapes: z.array(z.strictObject({ id: observedShapeIdSchema, type: shapeTypeSchema })).max(MAX_BOARD_SNAPSHOT_SHAPES)
        .refine(shapes => new Set(shapes.map(shape => shape.id)).size === shapes.length, '观察元素 ID 不能重复'),
})

export type BoardReference = z.infer<typeof boardReferenceSchema>
export type BoardObservation = z.infer<typeof boardObservationSchema>

/** 固定参照点可以不在后续读取范围中，但身份和坐标不能改变。 */
export function resolveBoardReference(current: BoardReference | undefined, candidate: BoardReference): BoardReference {
    return boardReferenceSchema.superRefine((point, ctx) => {
        if (current && (point.id !== current.id || point.x !== current.x || point.y !== current.y)) {
            ctx.addIssue({ code: 'custom', message: '任务参照点发生变化' })
        }
    }).parse(candidate)
}
