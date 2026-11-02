import styles from './page.module.scss'
import TraceJson, { type PreviewTraceImage } from './TraceJson'

function readValue(value: unknown, field?: string): unknown {
    if (typeof value === 'string' && (field === 'content' || field === 'arguments')) {
        try {
            const parsed: unknown = JSON.parse(value)
            if (parsed !== null && typeof parsed === 'object') return parsed
        } catch { /* 截断的 JSON 保留原文，不猜测或替换转义字符。 */ }
    }
    return value
}

export default function TraceData({ value, onPreview, depth = 0 }: { value: unknown; onPreview: PreviewTraceImage; depth?: number }) {
    // shortcut: 超过 12 层时回退为 JSON 文本；需要检查更深日志时再增加按需展开。
    if (depth >= 12) return <TraceJson text={typeof value === 'string' ? value : JSON.stringify(value, null, 2)} onPreview={onPreview} />
    if (Array.isArray(value)) {
        if (!value.length) return <pre>[]</pre>
        return <ol className={styles.dataItems}>{value.map((item, index) => <li key={index}>
            <TraceData value={item} depth={depth + 1} onPreview={onPreview} />
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
                    <TraceData value={child} depth={depth + 1} onPreview={onPreview} />
                </details>
                : <div key={key}><p className={styles.dataKey}>{key}</p><TraceData value={child} depth={depth + 1} onPreview={onPreview} /></div>
        })}</div>
    }
    return <TraceJson text={value === '' ? '（空字符串）' : String(value)} onPreview={onPreview} />
}
