import { z } from 'zod'
import { MAX_BOARD_WRITE_SHAPES } from '../utils/board/boardCapabilities'
import { getMutationIntentSchemas, snapshotInputSchema, askInputSchema } from '../utils/board/agent/boardToolInputSchema'

/** 仅由后端提供给模型的工具定义，不包含浏览器执行逻辑。 */
export const boardCreateTool = {
    type: 'function',
    function: {
        name: 'create_shapes',
        description: `用户已明确要求新增元素时，在临时草稿新增 1～${MAX_BOARD_WRITE_SHAPES} 个原生 tldraw 元素。shapes 每项提交 objectKey、type、x/y 和明确的原生 props；程序生成内部元素表，不提交 elements/known/missing 或已有 shapeId。必要的已有参照放 references。同一语义对象展开多个图形时复用 objectKey。geo 支持所有原生几何和颜色；group 必须提供至少两个已读取的 children ID。x/y 相对固定参照点，内部几何坐标仍为局部坐标。对象有歧义或要求先确认时先 ask_user。返回真实 ID，不提交正式白板。`,
        parameters: z.toJSONSchema(getMutationIntentSchemas().create, { target: 'draft-7' }),
    },
} as const

/** 开放各原生元素的部分属性更新；身份、层级、旋转不进入模型协议。 */
export const boardUpdateTool = {
    type: 'function',
    function: {
        name: 'update_shapes',
        description: `在草稿更新 1～${MAX_BOARD_WRITE_SHAPES} 个已读取、页面直属、无旋转、未锁定的原生元素。changes 每项只提交 objectKey、真实 shapeId 和明确修改的 x/y/props；程序生成 type 和元素表，不提交 shapes/elements/known/missing。省略字段保留原值，不能转换 type。x/y 是元素原点相对固定参照点的坐标。必要参照放 references；对象不唯一先读取或询问；整批失败不执行，不提交正式白板。`,
        parameters: z.toJSONSchema(getMutationIntentSchemas().update, { target: 'draft-7' }),
    },
} as const

/** 删除只接收任务已见的 ID，容器和绑定副作用由草稿层复核。 */
export const boardDeleteTool = {
    type: 'function',
    function: {
        name: 'delete_shapes',
        description: `在草稿删除 1～${MAX_BOARD_WRITE_SHAPES} 个已读取、页面直属、无旋转、未锁定的原生元素。targets 每项只提交 objectKey 和真实 shapeId，程序生成 ids 和元素表，不提交 ids/elements/type/known/missing。必要参照放 references，不能参与删除。容器后代和受影响箭头也必须已读取，越界副作用使整批回滚。目标不明确先读取或询问。只生成待确认的删除草稿，不提交正式白板。`,
        parameters: z.toJSONSchema(getMutationIntentSchemas().delete, { target: 'draft-7' }),
    },
} as const

/** 模型按需请求草稿上下文；范围受当前任务约束，结果明确标记是否截断。 */
export const boardSnapshotTool = {
    type: 'function',
    function: {
        name: 'get_board_snapshot',
        description: '仅在用户已明确具体白板操作时读取当前任务草稿，只提交 range，不提交 elements；无需先确定对象清单、ID、类型或缺项。用户只说“帮我弄一下白板”等目标不明需求时禁止读取，应通过 content 澄清。优先 viewport，信息不足再用 page。实际返回的元素加入任务范围；truncated=true 表示不完整。reference 只是坐标原点，不代表用户指定对象。',
        parameters: z.toJSONSchema(snapshotInputSchema, { target: 'draft-7' }),
    },
} as const

/** 明确任务缺少必要执行信息时提问；目标未明确则先通过普通文字澄清。 */
export const boardAskTool = {
    type: 'function',
    function: {
        name: 'ask_user',
        description: '用户已明确具体操作，但缺少必要参数、对象有多个候选，或明确要求先询问/确认时，必须调用本工具并等待真实回答后继续。只提交 question，不提交 elements；无需先确定对象清单、ID、类型或缺项。禁止仅在 content 中提执行问题或用文字冒充调用。问题一次合并相关必要信息，候选用位置或特征区分。只有可选参数缺省且有默认值时无需询问。任务目标本身未明确时使用 content 澄清，不调用本工具。每任务最多一次。',
        parameters: z.toJSONSchema(askInputSchema, { target: 'draft-7' }),
    },
} as const
