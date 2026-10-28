import { CREATE_GEOS, CREATE_COLORS } from '../utils/boardCreateProtocol'

/** 仅由后端提供给模型的工具定义，不包含浏览器执行逻辑。 */
export const boardCreateTool = {
    type: 'function',
    function: {
        name: 'create_shapes',
        description: '用户已明确要求新增具体图形，且必要信息齐全或已有默认值时，在临时草稿新增 1～5 个基础图形。对象有歧义或用户要求先确认时，必须先调用 ask_user 并获得答案，不能自行选择 reference 对象。ellipse 宽高相等时是圆。x/y 相对固定参照点；返回真实 ID，不提交正式白板。',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['shapes'],
            properties: {
                shapes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 5,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['geo', 'x', 'y', 'w', 'h', 'color'],
                        properties: {
                            geo: { type: 'string', enum: CREATE_GEOS },
                            x: { type: 'number', minimum: -10000, maximum: 10000 },
                            y: { type: 'number', minimum: -10000, maximum: 10000 },
                            w: { type: 'number', minimum: 1, maximum: 2000 },
                            h: { type: 'number', minimum: 1, maximum: 2000 },
                            color: { type: 'string', enum: CREATE_COLORS },
                        },
                    },
                },
            },
        },
    },
} as const

/** 模型按需请求草稿上下文；范围受当前任务约束，结果明确标记是否截断。 */
export const boardSnapshotTool = {
    type: 'function',
    function: {
        name: 'get_board_snapshot',
        description: '仅在用户已明确具体白板操作时读取当前任务草稿；用户只说“帮我弄一下白板”等目标不明需求时禁止读取，应通过 content 澄清。优先 viewport，信息不足再用 page。实际返回的元素加入任务范围；truncated=true 表示不完整。reference 只是坐标原点，不代表用户指定对象。',
        parameters: {
            type: 'object', additionalProperties: false, required: ['range'],
            properties: { range: { type: 'string', enum: ['viewport', 'page'] } },
        },
    },
} as const

/** 明确任务缺少必要执行信息时提问；目标未明确则先通过普通文字澄清。 */
export const boardAskTool = {
    type: 'function',
    function: {
        name: 'ask_user',
        description: '用户已明确具体操作，但缺少必要参数、对象有多个候选，或明确要求先询问/确认时，必须调用本工具并等待真实回答后继续。禁止仅在 content 中提执行问题或用文字冒充调用。问题一次合并相关必要信息，候选用位置或特征区分。只有可选参数缺省且有默认值时无需询问。任务目标本身未明确时使用 content 澄清，不调用本工具。每任务最多一次。',
        parameters: {
            type: 'object', additionalProperties: false, required: ['question'],
            properties: { question: { type: 'string', minLength: 1, maxLength: 1000 } },
        },
    },
} as const
