import type { BoardAnswer } from '../../domain/tool'
import type { createTldrawTools } from '../board/tldraw'
import { validateBoardAnswer } from '../interaction/askUser'
import { validateBoardToolCall, validateBoardToolSuccess, ERROR_CODES, type BoardToolOutput } from '../transport/boardProtocol'
import { parseCreateInput, parseSnapshotInput, parseAskInput, parseUpdateInput, parseDeleteInput } from '../board/nativeValidation'
import { BoardProtocolError } from '../transport/errors'

/** 单任务浏览器分发入口：统一去重与错误输出，具体白板能力保持各自的成功返回类型。 */
export function createBrowserToolDispatcher({ board, ask, assertActive, onReadRetry }: {
    board: ReturnType<typeof createTldrawTools>
    ask: (question: string) => Promise<BoardAnswer>
    assertActive: () => void
    onReadRetry?: (callId: string, attempt: number) => void
}) {
    const results = new Map<string, { name: string; arguments: string; output: Promise<BoardToolOutput> }>()

    return async (value: unknown): Promise<BoardToolOutput> => {
        assertActive()
        const call = validateBoardToolCall(value)
        const previous = results.get(call.id)
        if (previous) {
            if (previous.name !== call.function.name || previous.arguments !== call.function.arguments) {
                throw new Error('同一工具调用 ID 的名称或参数发生变化')
            }
            return previous.output
        }
        const output = (async (): Promise<BoardToolOutput> => {
            let invoked = false
            try {
                switch (call.function.name) {
                    case 'get_board_snapshot': {
                        const input = parseSnapshotInput(call.function.arguments)
                        invoked = true
                        return await board.get_board_snapshot(input, attempt => onReadRetry?.(call.id, attempt))
                    }
                    case 'get_board_screenshot': {
                        const input = parseSnapshotInput(call.function.arguments)
                        invoked = true
                        return await board.get_board_screenshot(input, attempt => onReadRetry?.(call.id, attempt))
                    }
                    case 'ask_user': {
                        const { question } = parseAskInput(call.function.arguments)
                        invoked = true
                        const answer = validateBoardAnswer(await ask(question))
                        assertActive()
                        // 交互适配器只提供回答；分发器再请求同一个白板实例核实选区，沿用其参照和授权范围。
                        const snapshot = answer.selectedShapeIds?.length ? await board.readSelection(answer.selectedShapeIds) : undefined
                        return validateBoardToolSuccess('ask_user', { ok: true, answer, ...(snapshot ? { snapshot } : {}) })
                    }
                    case 'create_shapes': {
                        const input = parseCreateInput(call.function.arguments)
                        invoked = true
                        return board.create_shapes(input)
                    }
                    case 'update_shapes': {
                        const input = parseUpdateInput(call.function.arguments)
                        invoked = true
                        return board.update_shapes(input)
                    }
                    case 'delete_shapes': {
                        const input = parseDeleteInput(call.function.arguments)
                        invoked = true
                        return board.delete_shapes(input)
                    }
                }
            } catch (cause) {
                // 具体能力抛出的写入异常不等于没有副作用，服务端仍按原约定将 EXECUTION_FAILED 记为 unknown。
                return { ok: false, error: !invoked && cause instanceof BoardProtocolError ? cause.detail
                    : { code: ERROR_CODES.EXECUTION_FAILED, message: call.function.name === 'get_board_snapshot' || call.function.name === 'get_board_screenshot'
                        ? '白板读取失败，有限重试后仍未获得有效结果' : '白板工具执行失败，本轮不自动重放操作' },
                }
            }
        })()
        // 缓存 Promise 而非仅缓存成功值；重复事件不会再次写入草稿，也不会再次展示问题。
        results.set(call.id, { name: call.function.name, arguments: call.function.arguments, output })
        return output
    }
}
