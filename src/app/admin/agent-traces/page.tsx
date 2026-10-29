import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { ADMIN_TRACE_COOKIE, verifyAdminSession } from '@/lib/traceAdminSession'
import TraceConsole from './TraceConsole'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Agent 运行记录 · CollabAI', robots: { index: false, follow: false } }

export default async function AgentTracesPage() {
    const jar = await cookies()
    const authorized = verifyAdminSession(jar.get(ADMIN_TRACE_COOKIE)?.value, process.env.ADMIN_TRACE_PASSWORD)
    return <TraceConsole initialAuthorized={authorized} />
}
