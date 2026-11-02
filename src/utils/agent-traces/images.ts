import { validateImageDataUrl } from '../chat/images'

const imagePattern = /data:image\/([a-z0-9.+-]+);base64,[a-z0-9+/=]+/gi
const imageUrlPattern = /\/api\/admin\/agent-traces\/[a-zA-Z0-9_-]{1,100}\/images\/[a-f0-9]{64}/g

export function isTraceImageUrl(value: unknown): value is string {
    return typeof value === 'string' && /^\/api\/admin\/agent-traces\/[a-zA-Z0-9_-]{1,100}\/images\/[a-f0-9]{64}$/.test(value)
}

/** 保留原始 JSON 的所有字符，只将已知图片引用拆出来供按钮使用。 */
export function splitTraceImageUrls(value: string): string[] {
    return value.split(new RegExp(`(${imageUrlPattern.source})`, 'g'))
}

/** 只转换日志副本；包括 tool content 中内嵌的 JSON，实际模型请求保持原样。 */
export async function captureTraceImages(value: unknown, save: (dataUrl: string) => Promise<string>, onFailure?: (cause: unknown) => void): Promise<unknown> {
    const saved = new Map<string, Promise<string>>()
    const capture = (dataUrl: string, mimeType: string) => {
        let pending = saved.get(dataUrl)
        if (!pending) {
            pending = (async () => {
                try {
                    validateImageDataUrl(dataUrl)
                    const url = await save(dataUrl)
                    if (!isTraceImageUrl(url)) throw new Error('Trace image URL is invalid')
                    return url
                } catch (cause) {
                    onFailure?.(cause)
                    return `[image omitted: image/${mimeType}]`
                }
            })()
            saved.set(dataUrl, pending)
        }
        return pending
    }
    const visit = async (item: unknown): Promise<unknown> => {
        if (typeof item === 'string') {
            let result = '', end = 0
            for (const match of item.matchAll(imagePattern)) {
                result += item.slice(end, match.index) + await capture(match[0], match[1])
                end = match.index + match[0].length
            }
            return result + item.slice(end)
        }
        if (Array.isArray(item)) {
            const result = []
            for (const child of item) result.push(await visit(child))
            return result
        }
        if (item && typeof item === 'object') {
            const entries: [string, unknown][] = []
            for (const [key, child] of Object.entries(item)) {
                entries.push([key, /^(authorization|cookie|api[-_]?key|password|access_token|refresh_token|secret)$/i.test(key) ? '[redacted]' : await visit(child)])
            }
            return Object.fromEntries(entries)
        }
        return item
    }
    return visit(value)
}
