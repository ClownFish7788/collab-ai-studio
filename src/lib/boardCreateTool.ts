import { z } from 'zod'
import type { BoardToolName } from '../agent/domain/tool'
import { boardToolContracts } from '../utils/board/agent/boardToolInputSchema'

function modelTool<Name extends BoardToolName>(name: Name) {
    return { type: 'function' as const, function: {
        name, description: boardToolContracts[name].description,
        parameters: z.toJSONSchema(boardToolContracts[name].inputSchema, { target: 'draft-7' }),
    } }
}

export const boardCreateTool = modelTool('create_shapes')
export const boardUpdateTool = modelTool('update_shapes')
export const boardDeleteTool = modelTool('delete_shapes')
export const boardSnapshotTool = modelTool('get_board_snapshot')
export const boardScreenshotTool = modelTool('get_board_screenshot')
export const boardAskTool = modelTool('ask_user')
