export type BoardQuestion = { text: string; submit: (answer: string) => void }

/**
 * 展示一个问题并等待真实提交，返回去空格后的非空回答；取消和超时均拒绝等待并清理界面。
 * 超时会通知调用方取消当前任务；已结束问题的 submit 永久失效，不能恢复旧任务或重复提交。
 */
export function requestBoardAnswer(
    question: string,
    signal: AbortSignal,
    onChange: (question: BoardQuestion | null) => void,
    abortTask: (reason: Error) => void,
): Promise<string> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
        let settled = false
        const finish = (result: { answer: string } | { error: unknown }) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal.removeEventListener('abort', onAbort)
            onChange(null)
            if ('answer' in result) resolve(result.answer)
            else reject(result.error)
        }
        const onAbort = () => finish({ error: signal.reason })
        const timer = setTimeout(() => {
            const reason = new Error('等待用户回答超时，请重新发起任务')
            abortTask(reason)
            finish({ error: reason })
        }, 45000)
        signal.addEventListener('abort', onAbort, { once: true })
        onChange({
            text: question,
            submit: value => {
                const answer = value.trim()
                if (answer && answer.length <= 1000) finish({ answer })
            },
        })
    })
}
