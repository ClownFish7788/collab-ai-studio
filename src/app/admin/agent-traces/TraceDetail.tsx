'use client'

import { useState } from 'react'
import { buildTraceFlow, eventLabels, operationLabels, outcomeLabels, readTraceData, statusLabels, traceStatus, traceEventOutcome, type TraceDetail as Detail, type TraceEvent } from '@/utils/agent-traces/flow'
import { errorCategories } from '@/utils/agent-traces/outcomes'
import FlowGraph from './FlowGraph'
import styles from './page.module.scss'

const pretty = (raw: string) => { try { return JSON.stringify(JSON.parse(raw), null, 2) } catch { return raw } }

function EventContent({ event }: { event: TraceEvent }) {
    const data = readTraceData(event.data)
    const result = traceEventOutcome(event)
    const failure = data.failure as { message?: string } | undefined
    return <section className={styles.event}>
        <h4>{event.type === 'operation_result' ? operationLabels[String(data.operation)] ?? '操作结果' : eventLabels[event.type] ?? event.type}{event.durationMs != null && <small>{event.durationMs} ms</small>}</h4>
        <div className={styles.eventMeta}><span>{outcomeLabels[result.outcome]}</span><span>{event.source === 'client' ? '浏览器上报' : '服务端记录'}</span>
            {result.errorCategory && <span>{errorCategories[result.errorCategory]}</span>}{result.errorCode && <code>{result.errorCode}</code>}
            {event.outcome === 'unknown' && <span>历史事件按已有内容展示，未补写新埋点</span>}
        </div>
        {failure?.message && <p className={styles.error}>{failure.message}</p>}
        {event.type === 'model_response' && <>
            <p className={styles.fieldLabel}>模型输出</p><pre>{typeof data.content === 'string' && data.content ? data.content : '本轮未返回正文，请查看工具调用。'}</pre>
            <p className={styles.fieldLabel}>服务商返回的推理内容</p><pre>{typeof data.reasoning === 'string' && data.reasoning ? data.reasoning : '未提供。当前请求保持原有 thinking 配置。'}</pre>
            {data.truncated === true && <p className={styles.notice}>响应内容达到记录上限，已截断。</p>}
        </>}
        <details open={event.type !== 'model_request' && event.type !== 'model_response'}><summary>查看原始 JSON</summary><pre>{pretty(event.data)}</pre></details>
    </section>
}

export default function TraceDetail({ trace }: { trace: Detail }) {
    const nodes = buildTraceFlow(trace)
    const [selected, setSelected] = useState(nodes[1]?.id ?? 'input')
    const node = nodes.find(item => item.id === selected) ?? nodes[0]
    const status = traceStatus(trace)
    const groups: Record<string, number> = {}
    trace.events.forEach(event => { const category = traceEventOutcome(event).errorCategory; if (category) groups[category] = (groups[category] ?? 0) + 1 })
    return <article className={styles.detail}>
        <header className={styles.detailHeader}>
            <div><p className={styles.eyebrow}>{trace.kind === 'board' ? '白板 Agent' : '普通聊天'}</p><h2>{trace.prompt || '图片或白板附件请求'}</h2></div>
            <span className={styles.badge} data-status={status}>{statusLabels[status] ?? status}</span>
        </header>
        <div className={styles.metadata}><span>模型 {trace.model}</span><span>耗时 {trace.durationMs == null ? '尚未结束' : `${trace.durationMs} ms`}</span><span>用户 {trace.userId ?? '未记录'}</span>{trace.roomId && <span>白板 {trace.roomId}</span>}<span>任务 {trace.id}</span></div>
        {status === 'interrupted' && <p className={styles.notice}>任务超过两分钟未写回结束状态，可能已中断；现有步骤保留供排查。</p>}
        {!!Object.keys(groups).length && <div className={styles.eventMeta}><span>异常与中止分类</span>{Object.entries(groups).map(([category, count]) => <span key={category} className={styles.badge}>{errorCategories[category as keyof typeof errorCategories]} · {count}</span>)}</div>}
        <p className={styles.help}>箭头表示实际执行顺序。点击节点查看输入与结果；白板写入结果为草稿。</p>
        <p className={styles.help}>成功表示程序执行通过。浏览器上报单独标注来源，不会修改服务端任务结果。</p>
        <div className={styles.viewer}>
            <section className={styles.flowPanel}><div className={styles.panelHeading}><h3>执行流程</h3><span>{nodes.length} 个节点</span></div><FlowGraph nodes={nodes} selected={selected} onSelect={setSelected} /></section>
            <section className={styles.inspector} aria-label="节点详情" aria-live="polite">
                <div className={styles.panelHeading}><h3>{node.label}</h3><span>{statusLabels[node.status] ?? node.status}</span></div>
                <div className={styles.inspectorBody}>
                    {node.kind === 'input' && <><p className={styles.fieldLabel}>用户输入与附件上下文</p><pre>{pretty(trace.input)}</pre></>}
                    {node.kind === 'result' && <><p className={styles.fieldLabel}>最终回复／已接收的部分回复</p><pre>{trace.reply || '本次任务未保存最终回复。'}</pre>{trace.error && <p className={styles.error}>{trace.error}</p>}</>}
                    {trace.events.filter(event => node.eventIds.includes(event.id)).map(event => <EventContent key={event.id} event={event} />)}
                </div>
            </section>
        </div>
        <details className={styles.timeline}><summary>文字时间线 · {trace.events.length} 条事件</summary><ol>{trace.events.map(event => <li key={event.id}><EventContent event={event} /></li>)}</ol></details>
    </article>
}
