import styles from './page.module.scss'

function readValue(value: unknown, field?: string): unknown {
    if (typeof value === 'string' && (field === 'content' || field === 'arguments')) {
        try {
            const parsed: unknown = JSON.parse(value)
            if (parsed !== null && typeof parsed === 'object') return parsed
        } catch { /* 截断的 JSON 保留原文，不猜测或替换转义字符。 */ }
    }
    return value
}

export default function TraceData({ value, depth = 0 }: { value: unknown; depth?: number }) {
    // shortcut: 超过 12 层时回退为 JSON 文本；需要检查更深日志时再增加按需展开。
    if (depth >= 12) return <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    if (Array.isArray(value)) {
        if (!value.length) return <pre>[]</pre>
        return <ol className={styles.dataItems}>{value.map((item, index) => <li key={index}>
            <TraceData value={item} depth={depth + 1} />
        </li>)}</ol>
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value)
        if (!entries.length) return <pre>{'{}'}</pre>
        return <div className={styles.dataFields}>{entries.map(([key, item]) => {
            const child = readValue(item, key)
            return child !== null && typeof child === 'object'
                ? <details key={key} className={styles.dataGroup} open={key !== 'tools'}>
                    <summary><span>{key}</span><span className={styles.expandLabel}>展开</span><span className={styles.collapseLabel}>收起</span></summary>
                    <TraceData value={child} depth={depth + 1} />
                </details>
                : <div key={key}><p className={styles.dataKey}>{key}</p><TraceData value={child} depth={depth + 1} /></div>
        })}</div>
    }
    return <pre>{value === '' ? '（空字符串）' : String(value)}</pre>
}
