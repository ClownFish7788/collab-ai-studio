type Path = (string | number)[]
type Frame = { kind: 'object' | 'array'; path: Path; start: number; key?: string; index: number }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown) => typeof value === 'string' ? value : ''

/** 仅提取展示文字；不补全 JSON，不向执行器返回任务或参数。 */
export function formatBoardJsonPreview(source: 'preparation' | 'tool', json: string): string {
    const lines: string[] = [], stack: Frame[] = []
    let i = 0
    const path = (): Path => {
        const parent = stack.at(-1)
        return parent ? [...parent.path, parent.kind === 'array' ? parent.index : parent.key ?? ''] : []
    }
    const finish = () => {
        const parent = stack.at(-1)
        if (parent?.kind === 'array') parent.index++
        else if (parent) parent.key = undefined
    }
    const publish = (path: Path, value: unknown) => {
        if (source === 'preparation') {
            if (path.length === 1 && path[0] === 'text' && typeof value === 'string') lines.push(value)
            if (path[0] !== 'brief') return
            if (path.length === 2 && path[1] === 'goal' && typeof value === 'string') lines.push(`目标：${value}`)
            if (path.length !== 3 || typeof path[2] !== 'number') return
            const labels: Record<string, string> = { tasks: '任务', constraints: '约束', unresolvedQuestions: '待确定' }
            const label = labels[String(path[1])]
            if (typeof label === 'string' && typeof value === 'string') lines.push(`${label} ${path[2] + 1}：${value}`)
            if (!value || typeof value !== 'object' || Array.isArray(value)) return
            const row = object(value)
            if (path[1] === 'objects') lines.push(`对象 ${string(row.key)}：${string(row.role)}；${string(row.description)}${row.parentKey ? `；属于 ${string(row.parentKey)}` : ''}`)
            if (path[1] === 'relations') lines.push(`关联：${string(row.from)} → ${string(row.to)}；${string(row.description)}`)
        } else {
            if (path.length === 1 && path[0] === 'question' && typeof value === 'string') lines.push(`待询问：${value}`)
            if (path.length === 1 && path[0] === 'range' && typeof value === 'string') lines.push(`读取范围：${value}`)
            if (path.length !== 2 || typeof path[1] !== 'number') return
            if (path[0] === 'ids' && typeof value === 'string') lines.push(`待删除对象 ${path[1] + 1}：${value}`)
            if (!value || typeof value !== 'object' || Array.isArray(value)) return
            const row = object(value)
            if (path[0] === 'elements') {
                const known = Object.entries(object(row.known)).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => `${k}=${v}`)
                const missing = Array.isArray(row.missing) ? row.missing.map(item => string(object(item).field)).filter(Boolean) : []
                lines.push(`元素 ${path[1] + 1}：${string(row.key)}；${string(row.operation)}${row.type ? `；${string(row.type)}` : ''}${row.shapeId ? `；${string(row.shapeId)}` : ''}${known.length ? `\n  已知：${known.join('；')}` : ''}${missing.length ? `\n  待补：${missing.join('；')}` : ''}`)
            }
            if (path[0] === 'shapes') {
                const props = object(row.props)
                const values = { type: row.type, x: row.x, y: row.y, geo: props.geo, w: props.w, h: props.h, color: props.color }
                lines.push(`待执行图形 ${path[1] + 1}：${Object.entries(values).filter(([, v]) => ['string', 'number'].includes(typeof v)).map(([k, v]) => `${k}=${v}`).join('；')}`)
            }
        }
    }
    const readString = () => {
        let value = ''
        i++
        while (i < json.length) {
            const char = json[i++]
            if (char === '"') return { value, complete: true }
            if (char === '\\') {
                if (i === json.length) break
                const escaped = json[i++]
                if (escaped === 'u') {
                    const digits = json.slice(i, i + 4)
                    if (!/^[\da-f]{4}$/i.test(digits)) break
                    value += String.fromCharCode(parseInt(digits, 16)); i += 4
                } else {
                    const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
                    if (!(escaped in escapes)) break
                    value += escapes[escaped]
                }
            } else {
                if (char.charCodeAt(0) < 32) break
                value += char
            }
        }
        return { value: value.replace(/[\uD800-\uDBFF]$/, ''), complete: false }
    }
    // shortcut: 预览只识别现有需求字段与完整工具表行；新展示字段在 publish 中扩展。
    while (i < json.length) {
        const char = json[i]
        if (/[\s:,]/.test(char)) { i++; continue }
        if (char === '"') {
            const parent = stack.at(-1)
            const key = parent?.kind === 'object' && parent.key === undefined
            const currentPath = path()
            const token = readString()
            if (key && token.complete) parent.key = token.value
            else if (!key) publish(currentPath, token.value)
            if (!token.complete) break
            if (!key) finish()
        } else if (char === '{' || char === '[') {
            if (stack.length >= 64) break
            stack.push({ kind: char === '{' ? 'object' : 'array', path: path(), start: i++, index: 0 })
        } else if (char === '}' || char === ']') {
            const frame = stack.pop()
            if (!frame || (char === '}') !== (frame.kind === 'object')) break
            i++
            if (frame.kind === 'object') {
                try { publish(frame.path, JSON.parse(json.slice(frame.start, i))) } catch { break }
            }
            finish()
        } else {
            const start = i
            while (i < json.length && !/[\s,}\]]/.test(json[i])) i++
            try { JSON.parse(json.slice(start, i)) } catch { break }
            finish()
        }
    }
    return lines.filter(Boolean).join('\n')
}
