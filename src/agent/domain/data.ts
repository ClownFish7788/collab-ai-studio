import { z } from 'zod'

function isJson(value: unknown, depth = 0): boolean {
    if (depth > 30) return false
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.every(item => isJson(item, depth + 1))
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
    return !Object.hasOwn(value, '__proto__') && !Object.getOwnPropertySymbols(value).length
        && Object.values(value).every(item => isJson(item, depth + 1))
}

/** 可跨消息/工具/上下文边界的 JSON 数据；先限制深度，避免递归 schema 遇到环时栈溢出。 */
export const jsonValueSchema = z.preprocess((value, ctx) => {
    if (!isJson(value)) {
        ctx.addIssue({ code: 'custom', message: '必须是安全 JSON 数据，嵌套最多 30 层' })
        return z.NEVER
    }
    return value
}, z.json())
export const jsonObjectSchema = jsonValueSchema.pipe(z.record(z.string(), z.json()))
export type JsonValue = z.infer<typeof jsonValueSchema>

/** 比较已校验的 JSON，保持数组顺序，忽略对象字段的序列化顺序。 */
export function jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true
    if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length
        && left.every((item, index) => jsonValuesEqual(item, right[index]))
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(right)) return false
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>
    return Object.keys(a).length === Object.keys(b).length
        && Object.keys(a).every(key => Object.hasOwn(b, key) && jsonValuesEqual(a[key], b[key]))
}
