import { z } from 'zod'
import { defaultShapeSchemas } from '@tldraw/tlschema'
import { ERROR_CODES, type AgentError as BoardAgentError } from '../../domain/error'
import { BoardProtocolError } from '../transport/errors'
import { DERIVED_SHAPE_PROPS, type DraftShapeType } from '../../../utils/board/draft/draftShapeSchema'
import {
    createShapesInputSchema, updateShapesInputSchema, deleteShapesInputSchema, snapshotInputSchema, askInputSchema,
    type CreateShapesInput, type UpdateShapesInput, type DeleteShapesInput, type SnapshotInput, type AskInput,
} from './contracts'

// 这里只检查 JSON、领域结构和原生属性；服务端校验不需要加载浏览器 Editor。
function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}
function number(value: unknown, min: number, max: number) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function json(value: unknown, depth = 0): boolean {
    if (depth > 30) return false
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (Array.isArray(value)) return value.every(item => json(item, depth + 1))
    return isRecord(value) && Object.values(value).every(item => json(item, depth + 1))
}

/** 新增与更新复用原生属性校验，结构 schema 不代替按类型检查和 JSON 深度限制。 */
function validateShapeProps(shape: { props?: unknown }, type: DraftShapeType, path: string, issues: NonNullable<BoardAgentError['issues']>) {
    if (!('props' in shape)) return
    if (!isRecord(shape.props) || !json(shape.props)) {
        issues.push({ path: `${path}.props`, message: '属性须为有限数值组成的合法 JSON 对象，嵌套最多 30 层' }); return
    }
    const validators = defaultShapeSchemas[type].props as Record<string, { validate(value: unknown): unknown }>
    for (const [key, prop] of Object.entries(shape.props)) {
        try {
            if (!Object.hasOwn(validators, key) || DERIVED_SHAPE_PROPS[type]?.includes(key)) throw new Error()
            validators[key].validate(prop)
            if (['w', 'h'].includes(key) && !number(prop, 1, 2000)) throw new Error()
            if (key === 'url' && prop !== '' && (typeof prop !== 'string' || !/^https?:\/\//i.test(prop))) throw new Error()
        } catch {
            issues.push({ path: `${path}.props`, message: '包含该类型不支持、只读或取值不合法的属性' })
        }
    }
}

export function validateToolInput<T extends z.ZodType>(schema: T, value: unknown, message: string): z.output<T> {
    const parsed = schema.safeParse(value, { error: z.locales.zhCN().localeError })
    if (!parsed.success) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message,
        issues: parsed.error.issues.slice(0, 40).map(issue => ({
            path: issue.path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${String(part)}`).join('') || 'arguments',
            message: issue.message.slice(0, 200),
        })),
    })
    return parsed.data
}

/** 验证整批新增参数，不分配 ID、不修改白板。 */
export function validateCreateInput(value: unknown): CreateShapesInput {
    const input = validateToolInput(createShapesInputSchema, value, '新增参数校验失败')
    const issues: NonNullable<BoardAgentError['issues']> = []
    const groupedChildren = new Set<string>()
    input.shapes.forEach((shape, index) => {
        const path = `shapes[${index}]`
        if (shape.type === 'group') {
            for (const id of shape.children) {
                if (groupedChildren.has(id)) issues.push({ path: `${path}.children`, message: '同一批次的多个分组不能复用子元素' })
                groupedChildren.add(id)
            }
        }
        validateShapeProps(shape, shape.type, path, issues)
    })
    if (issues.length) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '新增参数校验失败', issues: issues.slice(0, 40) })
    return input
}

/** JSON 语法错误仍可归属到已识别的调用；只反馈固定诊断，不转发解析器中的输入片段。 */
function parseToolArguments(argumentsText: string): unknown {
    let value: unknown
    try {
        value = JSON.parse(argumentsText)
    } catch {
        throw new BoardProtocolError({
            code: ERROR_CODES.INVALID_ARGUMENTS, message: '工具参数必须是合法 JSON',
            issues: [{ path: 'arguments', message: '请返回符合工具定义的 JSON 对象' }],
        })
    }
    return value
}

/** 解析新增实参，语法和字段错误均在产生任何图形前返回。 */
export function parseCreateInput(argumentsText: string): CreateShapesInput {
    return validateCreateInput(parseToolArguments(argumentsText))
}

/** 部分更新必须至少指定一个可写字段；整批校验完成前不访问 Editor，不改变省略字段。 */
export function validateUpdateInput(value: unknown): UpdateShapesInput {
    const input = validateToolInput(updateShapesInputSchema, value, '更新参数校验失败')
    const issues: NonNullable<BoardAgentError['issues']> = []
    const ids = new Set<string>()
    input.shapes.forEach((shape, index) => {
        const path = `shapes[${index}]`
        if (ids.has(shape.id)) issues.push({ path: `${path}.id`, message: '须为不重复的真实元素 ID' })
        ids.add(shape.id)
        validateShapeProps(shape, shape.type, path, issues)
    })
    if (issues.length) throw new BoardProtocolError({ code: ERROR_CODES.INVALID_ARGUMENTS, message: '更新参数校验失败', issues: issues.slice(0, 40) })
    return input
}

/** type 用于校验目标类型，不允许把已有元素转换成另一种类型。 */
export function parseUpdateInput(argumentsText: string): UpdateShapesInput {
    return validateUpdateInput(parseToolArguments(argumentsText))
}

/** 删除数量遵守共享写入上限；实际存在、类型和授权由当前任务执行器复核。 */
export function validateDeleteInput(value: unknown): DeleteShapesInput {
    return validateToolInput(deleteShapesInputSchema, value, '删除参数校验失败')
}

/** 解析删除实参；非法 JSON 和字段问题均在执行前转为受控参数错误。 */
export function parseDeleteInput(argumentsText: string): DeleteShapesInput {
    return validateDeleteInput(parseToolArguments(argumentsText))
}

/** 读取范围只能是任务绑定页面的视口或全页，模型不能指定其他房间、页面。 */
export function parseSnapshotInput(argumentsText: string): SnapshotInput {
    return validateToolInput(snapshotInputSchema, parseToolArguments(argumentsText), '快照读取范围不合法')
}

/** 询问工具只提交问题，不允许模型把答案伪装成用户输入。 */
export function parseAskInput(argumentsText: string): AskInput {
    return validateToolInput(askInputSchema, parseToolArguments(argumentsText), '询问参数不合法')
}
