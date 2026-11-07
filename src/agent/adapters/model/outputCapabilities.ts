import { createHash } from 'node:crypto'
import type { ModelConfig } from './client'

export type OutputMode = 'schema' | 'object' | 'prompt'
type Observation = { outcome: 'accepted' | 'unsupported'; expires: number }
// shortcut: 能力缓存只在单进程生效，需要跨实例复用时改为共享存储。
const observations = new Map<string, Partial<Record<Exclude<OutputMode, 'prompt'>, Observation>>>()
const TTL = 60 * 60 * 1000
const MAX_CONFIGURATIONS = 128

function configurationKey(config: ModelConfig) {
    // 这里只复用固定 preparation 组合：Chat Completions + stream + 无 tools + thinking=false（Qwen）。
    // 凭据只存摘要，避免不同账号/网关路由互相污染；HTTP accepted 不证明网关执行了约束解码。
    return JSON.stringify([config.provider ?? 'qwen', config.baseUrl, config.model,
        createHash('sha256').update(config.apiKey).digest('hex'), 'preparation-v1'])
}

export function getPreparationModes(config: ModelConfig): OutputMode[] {
    const records = observations.get(configurationKey(config))
    return (['schema', 'object', 'prompt'] as const).filter(mode => {
        const record = mode === 'prompt' ? undefined : records?.[mode]
        return !record || record.outcome !== 'unsupported' || record.expires <= Date.now()
    })
}

export function rememberOutputCapability(config: ModelConfig, mode: Exclude<OutputMode, 'prompt'>, outcome: Observation['outcome']) {
    const key = configurationKey(config)
    const oldest = observations.keys().next().value
    if (!observations.has(key) && observations.size >= MAX_CONFIGURATIONS && oldest !== undefined) observations.delete(oldest)
    const records = observations.get(key) ?? {}
    records[mode] = { outcome, expires: Date.now() + TTL }
    observations.set(key, records)
}
