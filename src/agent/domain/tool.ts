import { z } from 'zod'
import { MAX_BOARD_ELEMENT_ROWS, MAX_BOARD_QUESTIONS, taskObjectSchema } from './task'
import { MAX_BOARD_SNAPSHOT_SHAPES, boardSnapshotSchema, boardReferenceSchema, shapeIdSchema, shapeTypeSchema } from './observation'
import { jsonObjectSchema } from './data'
import { agentErrorSchema } from './error'

export const MAX_BOARD_WRITE_SHAPES = 30
export const MAX_BOARD_TOOL_ARGUMENT_CHARS = 10000
export const boardToolNameSchema = z.enum(['create_shapes', 'update_shapes', 'delete_shapes', 'get_board_snapshot', 'get_board_screenshot', 'ask_user'])
export type BoardToolName = z.infer<typeof boardToolNameSchema>
export const isBoardReadTool = (name: BoardToolName) => name === 'get_board_snapshot' || name === 'get_board_screenshot'

const coordinateSchema = z.number().min(-10000).max(10000)
const childrenSchema = z.array(shapeIdSchema).min(2).max(30)
    .refine(ids => new Set(ids).size === ids.length, '分组子元素 ID 不能重复').meta({ uniqueItems: true })
    .describe('已有且已读取的子元素 ID；同一批次的多个分组不能复用子元素。')
const propsSchema = z.preprocess((value, ctx) => {
    // Zod record 会跳过 __proto__，须在解析前拒绝，避免静默丢弃输入。
    if (value && typeof value === 'object' && Object.hasOwn(value, '__proto__')) {
        ctx.addIssue({ code: 'custom', message: '包含不支持的属性名' })
    }
    return value
}, z.record(z.string().regex(/^(?!__proto__$)/), z.unknown()).superRefine((value, ctx) => {
    if (!jsonObjectSchema.safeParse(value).success) ctx.addIssue({ code: 'custom', message: '属性必须是安全 JSON 对象' })
}))
const changeConstraint = {
    anyOf: [{ required: ['x'] }, { required: ['y'] }, { required: ['props'], properties: { props: { minProperties: 1 } } }],
}
const toolFailureSchema = z.strictObject({
    ok: z.literal(false),
    error: agentErrorSchema,
})

/** 用户的原始补充；图片文件头和实际选区来源仍由适配层验证。 */
export const boardAnswerSchema = z.strictObject({
    text: z.string().max(1000).optional(),
    images: z.array(z.string().min(1)).max(3).optional(),
    selectedShapeIds: z.array(shapeIdSchema).max(MAX_BOARD_SNAPSHOT_SHAPES)
        .refine(ids => new Set(ids).size === ids.length, '回答选区 ID 不能重复').optional(),
}).refine(answer => !!answer.text?.trim() || !!answer.images?.length || !!answer.selectedShapeIds?.length,
    '请提供文字、图片或选择元素')
export type BoardAnswer = z.infer<typeof boardAnswerSchema>

export const boardQuestionSchema = z.strictObject({
    id: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
    question: z.string().min(1).max(1000).regex(/\S/, '问题不能只包含空白'),
})
export const boardQuestionsSchema = z.array(boardQuestionSchema).min(1).max(MAX_BOARD_QUESTIONS)
    .refine(questions => new Set(questions.map(question => question.id)).size === questions.length, '问题 ID 不能重复')
export const boardAnswersSchema = z.array(boardAnswerSchema.safeExtend({ id: boardQuestionSchema.shape.id })).min(1).max(MAX_BOARD_QUESTIONS)
    .refine(answers => new Set(answers.map(answer => answer.id)).size === answers.length, '回答的问题 ID 不能重复')
    .refine(answers => answers.reduce((count, answer) => count + (answer.images?.length ?? 0), 0) <= 3,
        '本次全部回答合计最多上传 3 张图片')
    .refine(answers => new Set(answers.flatMap(answer => answer.selectedShapeIds ?? [])).size <= MAX_BOARD_SNAPSHOT_SHAPES,
        `所有回答合计最多选择 ${MAX_BOARD_SNAPSHOT_SHAPES} 个元素`)
export type BoardQuestion = z.infer<typeof boardQuestionSchema>
export type BoardAnswers = z.infer<typeof boardAnswersSchema>

/** 只接受本次问题的完整回答；顺序可变，不能漏题或把其他问题的答案混入。 */
export function answersMatchQuestions(questions: readonly BoardQuestion[], answers: BoardAnswers): boolean {
    return boardAnswersSchema.safeParse(answers).success && questions.length === answers.length
        && questions.every(question => answers.some(answer => answer.id === question.id))
}

/**
 * 原生能力目录由适配器提供，领域只依赖普通字符串和 Zod。
 * tools 的输入是模型意图；单独返回的 ShapesInput schema 用于移除 objectKey 等元数据后的执行参数。
 * props/图片这里只检查结构，原生属性与资源合法性仍须在适配层复核。
 */
export function createBoardToolContracts<T extends string>(shapeTypes: readonly T[], propsDescription = '仅提交明确修改的属性，省略字段保留原值。',
    propSchemas: Readonly<Record<string, z.core.JSONSchema.JSONSchema>> = {}) {
    z.array(shapeTypeSchema).min(1).parse(shapeTypes)
    const nonGroupTypes = shapeTypes.filter((type): type is Exclude<T, 'group'> => type !== 'group')
    const hasGroup = shapeTypes.some(type => type === 'group')
    const commonFields = { x: coordinateSchema, y: coordinateSchema, props: propsSchema.describe(propsDescription).meta({
        properties: propSchemas,
    }).optional() }
    const ordinaryShapeSchema = z.strictObject({ type: z.enum(nonGroupTypes), ...commonFields, children: z.never().optional() })
    const groupShapeSchema = z.strictObject({ type: z.literal('group'), ...commonFields, children: childrenSchema })
    // 在结构中省略不支持的变体，保证导出的 JSON Schema 与运行时能力一致。
    const firstShapeSchema = nonGroupTypes.length ? ordinaryShapeSchema : groupShapeSchema
    const remainingShapeSchemas = nonGroupTypes.length && hasGroup ? [groupShapeSchema] : []
    const createShapeInputSchema = z.discriminatedUnion('type', [firstShapeSchema, ...remainingShapeSchemas])
    const createShapesInputSchema = z.strictObject({ shapes: z.array(createShapeInputSchema).min(1).max(MAX_BOARD_WRITE_SHAPES) })
    const shapeChangesSchema = z.strictObject({
        x: coordinateSchema.optional(), y: coordinateSchema.optional(), props: commonFields.props,
    }).refine(shape => shape.x !== undefined || shape.y !== undefined || !!shape.props && Object.keys(shape.props).length > 0,
        '至少指定一个坐标或属性修改')
    const updateShapeInputSchema = shapeChangesSchema.safeExtend({ id: shapeIdSchema, type: z.enum(shapeTypes) }).meta(changeConstraint)
    const updateShapesInputSchema = z.strictObject({ shapes: z.array(updateShapeInputSchema).min(1).max(MAX_BOARD_WRITE_SHAPES)
        .superRefine((shapes, ctx) => {
            const ids = new Set<string>()
            shapes.forEach((shape, index) => {
                if (ids.has(shape.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: '须为不重复的真实元素 ID' })
                ids.add(shape.id)
            })
        }),
    })
    const deleteShapesInputSchema = z.strictObject({
        ids: z.array(shapeIdSchema).min(1).max(MAX_BOARD_WRITE_SHAPES)
            .refine(ids => new Set(ids).size === ids.length, '删除 ID 不能重复').meta({ uniqueItems: true }),
    })
    const snapshotInputSchema = z.strictObject({ range: z.enum(['viewport', 'page']) })
    const askInputSchema = z.strictObject({ questions: boardQuestionsSchema })
    const createdShapeSchema = z.discriminatedUnion('type', [firstShapeSchema.extend({ id: shapeIdSchema }),
        ...remainingShapeSchemas.map(schema => schema.extend({ id: shapeIdSchema }))])
    const createOutputSchema = z.discriminatedUnion('ok', [z.strictObject({
        ok: z.literal(true), state: z.literal('draft'),
        shapes: z.array(createdShapeSchema).min(1).max(MAX_BOARD_WRITE_SHAPES)
            .refine(shapes => new Set(shapes.map(shape => shape.id)).size === shapes.length, '工具结果 ID 不能重复'),
    }), toolFailureSchema])
    const updateOutputSchema = z.discriminatedUnion('ok', [z.strictObject({
        ok: z.literal(true), state: z.literal('draft'), operation: z.literal('update'), shapes: updateShapesInputSchema.shape.shapes,
    }), toolFailureSchema])
    const deleteOutputSchema = z.discriminatedUnion('ok', [z.strictObject({
        ok: z.literal(true), state: z.literal('draft'), operation: z.literal('delete'), ids: deleteShapesInputSchema.shape.ids,
    }), toolFailureSchema])
    const snapshotOutputSchema = z.discriminatedUnion('ok', [z.strictObject({
        ok: z.literal(true), state: z.literal('draft'), range: snapshotInputSchema.shape.range,
        snapshot: boardSnapshotSchema.extend({ shapes: boardSnapshotSchema.shape.shapes.max(MAX_BOARD_SNAPSHOT_SHAPES) }), truncated: z.boolean(),
    }), toolFailureSchema])
    const screenshotOutputSchema = z.discriminatedUnion('ok', [z.strictObject({
        ok: z.literal(true), state: z.literal('draft'), range: snapshotInputSchema.shape.range,
        image: z.string().min(1), reference: boardReferenceSchema,
        bounds: z.strictObject({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
    }), toolFailureSchema])
    const answerOutputSchema = z.discriminatedUnion('ok', [z.strictObject({
        ok: z.literal(true), answers: boardAnswersSchema, snapshot: boardSnapshotSchema.optional(),
    }), toolFailureSchema]).superRefine((output, ctx) => {
        if (!output.ok) return
        const ids = [...new Set(output.answers.flatMap(answer => answer.selectedShapeIds ?? []))]
        if (ids.length ? !output.snapshot || output.snapshot.shapes.length !== ids.length || output.snapshot.shapes.some(shape => !ids.includes(shape.id))
            : output.snapshot !== undefined) {
            ctx.addIssue({ code: 'custom', path: ['snapshot'], message: '回答选区与真实快照不匹配' })
        }
    })

    function getMutationIntentSchemas(sourceKeys?: readonly string[]) {
        const identity = {
            objectKey: (sourceKeys?.length ? z.enum(sourceKeys) : taskObjectSchema.shape.key)
                .describe('原 task_brief.objects 的 key；同一语义对象展开为多个实际目标时可重复使用，程序保留来源。'),
            role: sourceKeys?.length === 0 ? taskObjectSchema.shape.role : taskObjectSchema.shape.role.optional(),
        }
        const target = z.strictObject({ ...identity,
            shapeId: shapeIdSchema.describe('本任务实际附件、读取或新增结果中的真实 ID；每个目标只填一次。'),
        })
        const common = {
            references: z.array(target).max(MAX_BOARD_ELEMENT_ROWS).optional().describe('本步必要的已有参照对象，仅用于需求追踪，不参与本步写入。'),
            isFinal: z.boolean().describe('本次成功后全部任务完成时为 true；仍有后续写入时为 false。'),
        }
        return {
            create: z.strictObject({ shapes: z.array(z.discriminatedUnion('type', [firstShapeSchema.extend(identity),
                ...remainingShapeSchemas.map(schema => schema.extend(identity))]))
                .min(1).max(MAX_BOARD_WRITE_SHAPES), ...common }),
            update: z.strictObject({ changes: z.array(shapeChangesSchema.safeExtend(target.shape).meta(changeConstraint)).min(1).max(MAX_BOARD_WRITE_SHAPES), ...common }),
            delete: z.strictObject({ targets: z.array(target).min(1).max(MAX_BOARD_WRITE_SHAPES), ...common }),
        }
    }

    const mutationSchemas = getMutationIntentSchemas()
    const tools = {
        create_shapes: {
            kind: 'write' as const,
            description: `用户已明确要求新增元素时，在临时草稿新增 1～${MAX_BOARD_WRITE_SHAPES} 个原生 tldraw 元素。shapes 每项提交 objectKey、type、x/y 和明确的原生 props；程序生成内部元素表，不提交 elements/known/missing 或已有 shapeId。必要的已有参照放 references。同一语义对象展开多个图形时复用 objectKey。geo 支持所有原生几何和颜色；${hasGroup ? 'group 必须提供至少两个已读取的 children ID。' : ''}x/y 相对固定参照点，内部几何坐标仍为局部坐标。对象有歧义或要求先确认时先 ask_user。返回真实 ID，不提交正式白板。`,
            inputSchema: mutationSchemas.create, outputSchema: createOutputSchema,
        },
        update_shapes: {
            kind: 'write' as const,
            description: `在草稿更新 1～${MAX_BOARD_WRITE_SHAPES} 个已读取、页面直属、无旋转、未锁定的原生元素。changes 每项只提交 objectKey、真实 shapeId 和明确修改的 x/y/props；程序生成 type 和元素表，不提交 shapes/elements/known/missing。省略字段保留原值，不能转换 type。x/y 是元素原点相对固定参照点的坐标。必要参照放 references；对象不唯一先读取或询问；整批失败不执行，不提交正式白板。`,
            inputSchema: mutationSchemas.update, outputSchema: updateOutputSchema,
        },
        delete_shapes: {
            kind: 'write' as const,
            description: `在草稿删除 1～${MAX_BOARD_WRITE_SHAPES} 个已读取、页面直属、无旋转、未锁定的原生元素。targets 每项只提交 objectKey 和真实 shapeId，程序生成 ids 和元素表，不提交 ids/elements/type/known/missing。必要参照放 references，不能参与删除。容器后代和受影响箭头也必须已读取，越界副作用使整批回滚。目标不明确先读取或询问。只生成待确认的删除草稿，不提交正式白板。`,
            inputSchema: mutationSchemas.delete, outputSchema: deleteOutputSchema,
        },
        get_board_snapshot: {
            kind: 'read' as const,
            description: '读取当前任务草稿，支持查看、统计、分类等只读查询及写入前定位。只提交range，不提交elements；用户只说“帮我弄一下白板”等目标不明需求时先澄清。明确要求整个页面用page，否则优先viewport。truncated=true表示不完整。reference只是坐标原点，不代表用户指定对象。',
            inputSchema: snapshotInputSchema, outputSchema: snapshotOutputSchema,
        },
        get_board_screenshot: {
            kind: 'read' as const,
            description: '读取当前任务草稿的视口或整页截图。可与同范围get_board_snapshot一起调用，结合外观、文字和结构数据定位元素；图片不授予未读取ID的写入权限。只提交range，不提交elements。',
            inputSchema: snapshotInputSchema, outputSchema: screenshotOutputSchema,
        },
        ask_user: {
            kind: 'ask' as const,
            description: `向用户提问的统一入口：目标不明确、缺少必要信息、对象有多个候选，或用户要求先询问/确认时，必须实际调用本工具并等待真实回答后继续。只提交 questions 数组，包含 1～${MAX_BOARD_QUESTIONS} 个 {id,question}，每题 ID 唯一，每项只问一个能独立回答的问题；不提交答案或 elements。优先一次问齐所有已知待确认项，多个对象都须覆盖，不能只问第一个对象而猜测其余对象。用户逐题回答后一次提交，结果 answers 按 id 对应各题的文字、图片和所选元素。已有真实答案不得重复询问或套给其他对象；确需补问时，在本轮工具仍开放的额度内再次调用。禁止仅在 content 中反问或用文字冒充调用。候选用位置或特征区分；只有可选参数缺省且有默认值且用户没有要求确认时无需询问。`,
            inputSchema: askInputSchema, outputSchema: answerOutputSchema,
        },
    }
    return { tools, createShapeInputSchema, createShapesInputSchema, updateShapeInputSchema, updateShapesInputSchema,
        deleteShapesInputSchema, snapshotInputSchema, askInputSchema, getMutationIntentSchemas }
}

export type BoardToolContracts<T extends string = string> = ReturnType<typeof createBoardToolContracts<T>>['tools']
