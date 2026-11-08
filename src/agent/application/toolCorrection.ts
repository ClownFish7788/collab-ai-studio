import { z } from 'zod'
import type { AgentContext } from '../domain/context'
import { jsonObjectSchema } from '../domain/data'
import { ERROR_CODES } from '../domain/error'
import type { ToolCallProposal } from '../domain/invocation'
import type { BoardToolContracts } from '../domain/tool'
import { getToolCorrectionContract } from '../domain/toolCorrection'
import { AgentApplicationError, validationFailure } from './ports'

/**
 * 在登记新一轮助手调用前，把写入纠错提议转换为可供原工具校验的完整提议。
 * 旧参数直接取自本任务 context，不建立额外的参数缓存，也不执行白板操作。
 * @param proposal 本轮模型提议，包含全新的 id、工具名 name 和完整参数或补丁 input。
 * 增量补丁使用 { retryOf, patches: [{ itemKey: 'item_0', props: { font: 'sans' } }] }；
 * 完整替代使用 { retryOf, shapes/changes/targets: [...], isFinal, ... }，不继承旧字段。
 * @param context 当前任务上下文；messages 保存旧调用参数，toolResults 保存真实执行结果。
 * @param pending 当前任务尚未被纠错提议认领的调用 ID 集合，由执行循环维护。
 * 来源调用必须同名，且结果为 not_executed / INVALID_ARGUMENTS。
 * @param tools 原有工具契约表，提供工具种类以及完整输入 schema。
 * @returns 普通提议返回 { proposal }；纠错返回 { proposal: 完整提议, retryOf: 旧调用ID }。
 * 新提议保留新 callId，纠错元数据不会进入执行参数。纠错必须显式指定 retryOf；
 * 未带 retryOf 的提议视为独立调用，不消费旧失败，也不建立纠错关联。
 * @throws {AgentApplicationError} 来源不合法或补全失败，错误码为 INVALID_ARGUMENTS，
 * 可包含字段诊断；其他非预期异常原样抛出。
 * @remarks 找到合法来源后会立即从 pending 删除旧 ID，防止同批重复认领；即使后续
 * 合并失败也不会放回。context 和旧参数不变。调用方须登记返回的完整提议，并继续
 * 原有结构、任务范围及原生属性校验；本函数返回成功不代表可以跳过校验直接执行。
 * @example
 * const resolved = resolveToolCorrection(nextCall, context, pendingCorrections, tools)
 * // 将 resolved.proposal 登记到本轮助手消息，再交给 registry.prepare 校验。
 */
export function resolveToolCorrection(proposal: ToolCallProposal, context: AgentContext, pending: Set<string>, tools: BoardToolContracts) {
    const input = proposal.input
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.retryOf === undefined) return { proposal }
    /** 输入拒绝原因；无返回值，抛出定位到 input.retryOf 的 INVALID_ARGUMENTS 应用错误。 */
    const reject = (message: string): never => { throw new AgentApplicationError({ code: ERROR_CODES.INVALID_ARGUMENTS, message,
        issues: [{ path: 'input.retryOf', message }] }) }
    if (tools[proposal.name].kind !== 'write') return { proposal }
    const retryOf = input.retryOf
    if (typeof retryOf !== 'string' || !pending.has(retryOf)) return reject('retryOf 只能引用本任务中尚未纠正的参数失败调用')
    const result = context.toolResults.find(result => result.callId === retryOf)
    if (!result || result.name !== proposal.name || result.state !== 'not_executed' || result.error.code !== ERROR_CODES.INVALID_ARGUMENTS) {
        return reject('retryOf 必须引用同名且确认未执行的 INVALID_ARGUMENTS 调用')
    }
    const base = context.messages.flatMap(message => message.role === 'assistant' ? message.calls ?? [] : []).find(call => call.id === retryOf)
    if (!base) return reject('没有找到本任务中的原始调用参数')
    pending.delete(retryOf)
    try {
        const contract = getToolCorrectionContract(tools[proposal.name].inputSchema)
        const replacement = { ...input }
        delete replacement.retryOf
        const resolved = Object.hasOwn(input, 'patches') ? contract.merge(base.input, input) : jsonObjectSchema.parse(replacement)
        return { proposal: { ...proposal, input: resolved }, retryOf }
    } catch (cause) {
        if (cause instanceof z.ZodError) throw validationFailure(cause, ERROR_CODES.INVALID_ARGUMENTS, '参数补全失败')
        throw cause
    }
}

/**
 * 生成发给下一轮模型的纠错来源清单，让模型知道 retryOf 和 itemKey 应该填写什么。
 * @param context 当前任务上下文，从助手历史消息读取原始调用及数组顺序。
 * @param pending 执行循环已确认未执行、尚未被认领的参数失败调用 ID；本函数只读使用。
 * @param tools 工具契约表，用于筛选写入工具并识别对应的 shapes/changes/targets 数组。
 * @returns 无候选时返回空字符串；否则返回换行、说明文字和 JSON 清单组成的提示文本。
 * 每项包含 retryOf、name、元素的 itemKey/objectKey/type/shapeId，以及
 * fullReplacementRequired。itemKey 按旧数组从 item_0 编号，不是可重复的 objectKey。
 * 原数组结构不可合并时 fullReplacementRequired 为 true，提示模型提交完整替代参数。
 * @remarks 不修改上下文或 pending，不复制完整 props，不授予重试权限；实际来源资格仍
 * 必须由 resolveToolCorrection 再检查。返回值可直接拼到本轮的参数纠正 system 消息。
 */
export function toolCorrectionHints(context: AgentContext, pending: ReadonlySet<string>, tools: BoardToolContracts): string {
    const candidates = context.messages.flatMap(message => message.role === 'assistant' ? message.calls ?? [] : [])
        .filter(call => pending.has(call.id) && tools[call.name].kind === 'write')
        .map(call => {
            const items = getToolCorrectionContract(tools[call.name].inputSchema).items(call.input)
            return { retryOf: call.id, name: call.name, items: items?.map((item, index) => ({ itemKey: `item_${index}`,
                objectKey: item.objectKey, type: item.type, shapeId: item.shapeId })), fullReplacementRequired: !items }
        })
    return candidates.length ? `\n可纠正的调用与固定元素标识：${JSON.stringify(candidates)}` : ''
}
