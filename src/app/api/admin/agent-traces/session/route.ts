import { NextResponse } from 'next/server'
import { readCreatePayload } from '@/agent/adapters/server/access'
import { consumeAdminLoginAttempt } from '@/lib/agentTrace'
import {
    ADMIN_TRACE_COOKIE, ADMIN_TRACE_SESSION_SECONDS, adminPasswordConfigured,
    createAdminSession, hasTraceAdminSession, matchesAdminPassword, sameOrigin, traceJson,
} from '@/lib/traceAdminSession'

export async function POST(request: Request) {
    if (!sameOrigin(request)) return traceJson({ error: '仅允许从本站登录后台' }, 403)
    const password = process.env.ADMIN_TRACE_PASSWORD
    if (!adminPasswordConfigured(password)) return traceJson({ error: '请在服务端配置至少 16 字符的 ADMIN_TRACE_PASSWORD' }, 503)
    let input: unknown
    try { input = await readCreatePayload(request, 2048) } catch { return traceJson({ error: '登录请求格式错误' }, 400) }
    if (!input || typeof input !== 'object' || !('password' in input) || typeof input.password !== 'string' || input.password.length > 1024) {
        return traceJson({ error: '请提供后台密码' }, 400)
    }
    try {
        if (!await consumeAdminLoginAttempt()) {
            const response = traceJson({ error: '尝试次数过多，请稍后再试' }, 429)
            response.headers.set('Retry-After', String(Math.ceil((600000 - Date.now() % 600000) / 1000)))
            return response
        }
    } catch { return traceJson({ error: '后台登录暂不可用，请检查数据库初始化' }, 503) }
    if (!matchesAdminPassword(input.password, password)) return traceJson({ error: '后台密码不正确' }, 401)
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    response.cookies.set(ADMIN_TRACE_COOKIE, createAdminSession(password)!, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: ADMIN_TRACE_SESSION_SECONDS,
    })
    return response
}

export async function DELETE(request: Request) {
    if (!sameOrigin(request)) return traceJson({ error: '仅允许从本站退出后台' }, 403)
    if (!hasTraceAdminSession(request)) return traceJson({ error: '后台会话已失效，请重新登录' }, 401)
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
    response.cookies.set(ADMIN_TRACE_COOKIE, '', {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0,
    })
    return response
}
