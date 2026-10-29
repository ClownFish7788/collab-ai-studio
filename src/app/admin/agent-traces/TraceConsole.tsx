'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Activity, LockKeyhole, LogOut, RefreshCw } from 'lucide-react'
import { statusLabels, traceStatus, type TraceDetail as Detail, type TraceSummary } from '@/utils/agent-traces/flow'
import TraceDetail from './TraceDetail'
import { errorCategories } from '@/utils/agent-traces/outcomes'
import styles from './page.module.scss'

const endpoint = '/api/admin/agent-traces'
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试'

function Login({ onSuccess }: { onSuccess: () => void }) {
    const [password, setPassword] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (busy) return
        setBusy(true); setError('')
        try {
            const response = await fetch(endpoint + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || '无法登录后台')
            setPassword(''); onSuccess()
        } catch (error) { setError(message(error)) } finally { setBusy(false) }
    }
    return <section className={styles.login}>
        <LockKeyhole size={28} aria-hidden /><p className={styles.eyebrow}>开发者后台</p><h2>查看 Agent 执行现场</h2>
        <p>使用独立后台密码登录。普通用户账号不具备运行记录的访问权限。</p>
        <form onSubmit={submit}><label htmlFor="trace-password">后台密码</label><input id="trace-password" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <button type="submit" disabled={busy}>{busy ? '正在验证…' : '登录运行记录后台'}</button>
        </form>
    </section>
}

function Workspace({ onExit }: { onExit: () => void }) {
    const [items, setItems] = useState<TraceSummary[]>([])
    const [cursor, setCursor] = useState<string | null>(null)
    const [trace, setTrace] = useState<Detail | null>(null)
    const [listBusy, setListBusy] = useState(true)
    const [detailBusy, setDetailBusy] = useState(false)
    const [logoutBusy, setLogoutBusy] = useState(false)
    const [error, setError] = useState('')
    const pageRequest = useRef<AbortController | null>(null)
    const [category, setCategory] = useState('')
    const [status, setStatus] = useState('')
    const detailRequest = useRef<AbortController | null>(null)
    const loadPage = useCallback(async (after?: string, append = false) => {
        pageRequest.current?.abort()
        const controller = new AbortController()
        pageRequest.current = controller
        try {
            const params = new URLSearchParams({ ...(after ? { cursor: after } : {}), ...(category ? { category } : {}), ...(status ? { status } : {}) })
            const response = await fetch(endpoint + (params.size ? '?' + params : ''), { cache: 'no-store', signal: controller.signal })
            if (response.status === 401) { onExit(); return }
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || '无法读取运行记录')
            if (controller.signal.aborted) return
            setItems(previous => append ? [...previous, ...data.items] : data.items)
            setCursor(data.nextCursor)
        } catch (error) { if (!controller.signal.aborted) setError(message(error)) }
        finally { if (!controller.signal.aborted) setListBusy(false) }
    }, [onExit, category, status])

    useEffect(() => {
        void loadPage()
        return () => { pageRequest.current?.abort(); detailRequest.current?.abort() }
    }, [loadPage])

    const loadDetail = async (id: string) => {
        // Selecting a second run must never let the first response overwrite the inspector.
        detailRequest.current?.abort()
        const controller = new AbortController()
        detailRequest.current = controller
        setDetailBusy(true); setTrace(null); setError('')
        try {
            const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal })
            if (response.status === 401) { onExit(); return }
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || '无法读取记录详情')
            if (!controller.signal.aborted) setTrace(data.trace)
        } catch (error) { if (!controller.signal.aborted) setError(message(error)) }
        finally { if (!controller.signal.aborted) setDetailBusy(false) }
    }
    const logout = async () => {
        setLogoutBusy(true); setError('')
        try {
            const response = await fetch(endpoint + '/session', { method: 'DELETE' })
            if (!response.ok && response.status !== 401) throw new Error('退出失败，请重试')
            onExit()
        } catch (error) { setError(message(error)); setLogoutBusy(false) }
    }
    const resetFilterResults = () => {
        detailRequest.current?.abort()
        setItems([]); setCursor(null); setTrace(null); setDetailBusy(false); setListBusy(true); setError('')
    }
    return <>
        <div className={styles.toolbar}><p>开发者会话 · 仅后台可见</p><div><button className={styles.secondary} disabled={listBusy} onClick={() => {
            setError(''); setListBusy(true); void loadPage(); if (trace) void loadDetail(trace.id)
        }}><RefreshCw size={15} aria-hidden />刷新</button><button className={styles.secondary} disabled={logoutBusy} onClick={logout}><LogOut size={15} aria-hidden />{logoutBusy ? '正在退出…' : '退出后台'}</button></div></div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.filters}>
            <label>任务结果<select value={status} onChange={event => { setStatus(event.target.value); resetFilterResults() }}><option value="">全部结果</option>{['completed', 'failed', 'cancelled', 'timed_out', 'running'].map(value => <option key={value} value={value}>{value === 'running' ? '未结束／未回写' : statusLabels[value]}</option>)}</select></label>
            <label>错误类型<select value={category} onChange={event => { setCategory(event.target.value); resetFilterResults() }}><option value="">全部类型</option>{Object.entries(errorCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <p>任务成功也可能包含已纠正的失败步骤；按错误类型可找到这些记录。</p>
        </div>
        <div className={styles.workspace}>
            <aside className={styles.list} aria-label="运行记录列表"><div className={styles.panelHeading}><h2>最近运行</h2><span>{items.length} 条</span></div>
                {!items.length && <p className={styles.empty} role="status">{listBusy ? '正在读取记录…' : '暂无记录。完成一次聊天或白板任务后，刷新查看。'}</p>}
                <ul>{items.map(item => {
                    const status = traceStatus(item)
                    return <li key={item.id}><button className={styles.runItem} aria-pressed={trace?.id === item.id} onClick={() => void loadDetail(item.id)}>
                        <span className={styles.runTop}><span>{item.kind === 'board' ? '白板 Agent' : '普通聊天'}</span><span className={styles.badge} data-status={status}>{statusLabels[status] ?? status}</span></span>
                        <strong>{item.prompt || '图片或白板附件请求'}</strong><span className={styles.runMeta}>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                        <span className={styles.runMeta}>{item.model} · {item.durationMs == null ? '尚未结束' : `${item.durationMs} ms`}</span>
                        {!!item.errorCount && <span className={styles.errorCount}>{item.errorCount} 条失败事件</span>}
                    </button></li>
                })}</ul>
                {cursor && <button className={styles.loadMore} disabled={listBusy} onClick={() => { setListBusy(true); void loadPage(cursor, true) }}>{listBusy ? '正在读取…' : '加载更早记录'}</button>}
            </aside>
            <section className={styles.detailSlot} aria-label="运行记录详情" aria-busy={detailBusy}>
                {detailBusy ? <p className={styles.placeholder} role="status">正在还原执行流程…</p> : trace ? <TraceDetail key={trace.id} trace={trace} />
                    : <div className={styles.placeholder}><Activity size={32} aria-hidden /><h2>选择一次运行</h2><p>查看执行流程图、模型上下文和工具结果。</p></div>}
            </section>
        </div>
    </>
}

export default function TraceConsole({ initialAuthorized }: { initialAuthorized: boolean }) {
    const [authorized, setAuthorized] = useState(initialAuthorized)
    const exit = useCallback(() => setAuthorized(false), [])
    return <main className={styles.shell}>
        <header className={styles.header}><div><Link href="/workspace" className={styles.brand}>CollabAI Studio</Link><h1>Agent 运行记录</h1><p>查看模型输入、工具执行与最终输出。</p></div><span className={styles.adminMark}><LockKeyhole size={15} aria-hidden />开发者后台</span></header>
        {authorized ? <Workspace onExit={exit} /> : <Login onSuccess={() => setAuthorized(true)} />}
    </main>
}
