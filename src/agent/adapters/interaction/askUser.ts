import { answersMatchQuestions, boardAnswerSchema, boardAnswersSchema, boardQuestionsSchema, type BoardAnswer, type BoardAnswers, type BoardQuestion } from '../../domain/tool'
import { BOARD_ANSWER_TIMEOUT_MS } from '../../application/ports'
import { validateImageDataUrl } from '../../../utils/chat/images'

export type PendingBoardQuestions = { questions: BoardQuestion[]; submit: (answers: BoardAnswers) => void }

/** 只校验回答内容和 ID 格式；选区是否真实存在、能否操作，由白板适配器另行核实。 */
export function validateBoardAnswer(value: unknown): BoardAnswer {
    const answer = boardAnswerSchema.parse(value)
    answer.images?.forEach(validateImageDataUrl)
    const text = answer.text?.trim()
    return boardAnswerSchema.parse({
        ...(text ? { text } : {}),
        ...(answer.images?.length ? { images: answer.images } : {}),
        ...(answer.selectedShapeIds?.length ? { selectedShapeIds: answer.selectedShapeIds } : {}),
    })
}

export function validateBoardAnswers(value: unknown, questions?: readonly BoardQuestion[]): BoardAnswers {
    const answers = boardAnswersSchema.parse(value).map(({ id, ...answer }) => ({ id, ...validateBoardAnswer(answer) }))
    if (questions && !answersMatchQuestions(questions, answers)) throw new Error('请逐项回答本次全部问题')
    return answers
}

/**
 * 展示同一批问题并等待完整提交；取消和超时均拒绝等待并清理界面。
 * 超时会通知调用方取消当前任务；已结束问题的 submit 永久失效，不能恢复旧任务或重复提交。
 */
export function requestBoardAnswer(
    questions: BoardQuestion[],
    signal: AbortSignal,
    onChange: (question: PendingBoardQuestions | null) => void,
    abortTask: (reason: Error) => void,
): Promise<BoardAnswers> {
    signal.throwIfAborted()
    const pendingQuestions = boardQuestionsSchema.parse(questions)
    return new Promise((resolve, reject) => {
        let settled = false
        const finish = (result: { answers: BoardAnswers } | { error: unknown }) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal.removeEventListener('abort', onAbort)
            onChange(null)
            if ('answers' in result) resolve(result.answers)
            else reject(result.error)
        }
        const onAbort = () => finish({ error: signal.reason })
        const timer = setTimeout(() => {
            const reason = new Error('等待用户回答超时，请重新发起任务')
            abortTask(reason)
            finish({ error: reason })
        }, BOARD_ANSWER_TIMEOUT_MS)
        signal.addEventListener('abort', onAbort, { once: true })
        onChange({
            questions: pendingQuestions,
            submit: value => {
                try { finish({ answers: validateBoardAnswers(value, pendingQuestions) }) } catch { /* 无效提交保持等待，让用户补充。 */ }
            },
        })
    })
}
