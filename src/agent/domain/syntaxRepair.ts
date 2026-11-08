import { z } from 'zod'
import { jsonObjectSchema, jsonValueSchema, type JsonValue } from './data'
import { validationIssueSchema } from './error'
import { MAX_BOARD_TOOL_ARGUMENT_CHARS } from './tool'

/** 原始错误片段与同源工具 Schema；不包含任务上下文，也不授予调用工具的权限。 */
export const syntaxProblemSchema = z.strictObject({
    field: z.string().regex(/^[a-zA-Z][\w-]{0,99}$/).optional(),
    text: z.string().min(1).max(MAX_BOARD_TOOL_ARGUMENT_CHARS),
    parameters: jsonObjectSchema,
    issues: z.array(validationIssueSchema).min(1).max(40),
})
export type SyntaxProblem = z.infer<typeof syntaxProblemSchema>

const invalid = () => new Error('语法修复无法证明保留原始内容，拒绝执行')

/** 保留字符串、数字、容器起点与每个闭合位置；只放宽逗号和闭括号种类。 */
function syntaxTokens(text: string, normalizeNumbers = false): string[] {
    if (!text.length || text.length > MAX_BOARD_TOOL_ARGUMENT_CHARS) throw invalid()
    const tokens: string[] = []
    let depth = 0
    for (let index = 0; index < text.length;) {
        const char = text[index]
        if (/\s/.test(char)) { index++; continue }
        if (char === ',') {
            if (/[,\[{]\s*$/.test(text.slice(0, index))) throw invalid()
            index++; continue
        }
        if (char === '{' || char === '[') { if (++depth > 30) throw invalid(); tokens.push(char); index++; continue }
        if (char === '}' || char === ']') { if (--depth < 0) throw invalid(); tokens.push('close'); index++; continue }
        if (char === ':') { tokens.push(char); index++; continue }
        const match = /^(?:"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(index))
        if (!match) throw invalid()
        // 解码等价转义，但不推测缺失引号、未知文本或被截断的值。
        const value: unknown = JSON.parse(match[0])
        if (typeof value === 'number' && !Number.isFinite(value)) throw invalid()
        const next = text[index + match[0].length]
        if (typeof value !== 'string' && next && !/[\s,[\]{}:"]/.test(next)) throw invalid()
        tokens.push(typeof value === 'number' && !normalizeNumbers ? match[0] : JSON.stringify(value)); index += match[0].length
    }
    if (depth || !['{', '['].includes(tokens[0])) throw invalid()
    return tokens
}

export function isSyntaxRepairable(text: string): boolean {
    try { syntaxTokens(text); return true } catch { return false }
}

/** 括号的类型由未改变的起点/闭合位置唯一决定；不允许移动边界或补全被截断的容器。 */
export function parseSyntaxRepair(original: string, candidate: string): JsonValue {
    const before = syntaxTokens(original), after = syntaxTokens(candidate)
    if (JSON.stringify(before) !== JSON.stringify(after)) throw invalid()
    const value = jsonValueSchema.parse(JSON.parse(candidate))
    // JSON.parse 会吞掉重复键；与规范序列化比较，拒绝这种静默丢失。
    if (JSON.stringify(syntaxTokens(candidate, true)) !== JSON.stringify(syntaxTokens(JSON.stringify(value), true))) throw invalid()
    return value
}
