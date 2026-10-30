import { defaultShapeSchemas } from '@tldraw/tlschema'

export type DraftShapeType = keyof typeof defaultShapeSchemas
export const DRAFT_SHAPE_TYPES = Object.keys(defaultShapeSchemas) as DraftShapeType[]

/** 原生排版派生属性可读不可写。 */
export const DERIVED_SHAPE_PROPS: Partial<Record<DraftShapeType, readonly string[]>> = {
    geo: ['growY'],
    note: ['growY', 'fontSizeAdjustment'],
    bookmark: ['h'],
}
