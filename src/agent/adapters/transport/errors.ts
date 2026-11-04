import type { AgentError } from '../../domain/error'

/** 仅携带程序生成的诊断；不将未知异常正文反馈给模型。 */
export class BoardProtocolError extends Error {
    constructor(readonly detail: AgentError) {
        super(detail.message)
    }
}
