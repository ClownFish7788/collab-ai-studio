import { DefaultColorStyle } from '@tldraw/tlschema'
import { DRAFT_SHAPE_TYPES } from './draft/draftShapeSchema'
import { MAX_BOARD_ELEMENT_ROWS } from '../../agent/domain/task'
import { MAX_BOARD_WRITE_SHAPES } from '../../agent/domain/tool'
import { MAX_BOARD_WRITES_PER_TASK, MAX_BOARD_TOOL_CALLS, MAX_BOARD_MODEL_CALLS, MAX_BOARD_ELEMENT_TABLE_CHARS, BOARD_RUN_TIMEOUT_MS, BOARD_ANSWER_TIMEOUT_MS } from '../../agent/application/ports'

export { MAX_BOARD_ELEMENT_ROWS, MAX_BOARD_WRITE_SHAPES, MAX_BOARD_WRITES_PER_TASK, MAX_BOARD_TOOL_CALLS, MAX_BOARD_MODEL_CALLS, MAX_BOARD_ELEMENT_TABLE_CHARS, BOARD_RUN_TIMEOUT_MS, BOARD_ANSWER_TIMEOUT_MS }
export const MAX_BOARD_TOOL_ARGUMENT_CHARS = 10000

/** 同一声明进入准备与执行调用；不代替本轮实际开放的工具、对象权限或用户确认。 */
export const boardAgentCapabilitiesPrompt = `以下是程序提供的真实能力边界，不是模型估计，也不表示已执行操作：
<board_agent_capabilities>${JSON.stringify({
    maxShapesPerWrite: MAX_BOARD_WRITE_SHAPES,
    maxWritesPerTask: MAX_BOARD_WRITES_PER_TASK,
    maxElementRows: MAX_BOARD_ELEMENT_ROWS,
    maxToolArgumentChars: MAX_BOARD_TOOL_ARGUMENT_CHARS,
    maxElementTableChars: MAX_BOARD_ELEMENT_TABLE_CHARS,
    supportedShapeTypes: DRAFT_SHAPE_TYPES,
    nativeColors: DefaultColorStyle.values,
    writeTarget: 'draft',
    canBindExistingShapes: false,
    canReadBoardSnapshot: true,
    canCaptureBoardScreenshot: true,
    observationRanges: ['viewport', 'page'],
})}</board_agent_capabilities>
拆分与元素表必须能交给这些能力执行。保留用户的完整目标；无法在边界内完成时说明具体限制，不能悄悄减少数量、忽略关系或输出注定无法执行的参数。已知信息与待补信息遵守工具 schema，不用 null、数组或对象占位。当前允许调用哪些工具仍以本轮工具列表为准。`
