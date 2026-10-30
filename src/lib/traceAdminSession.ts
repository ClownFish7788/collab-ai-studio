import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const ADMIN_TRACE_COOKIE = 'agent-trace-admin'
export const ADMIN_TRACE_SESSION_SECONDS = 8 * 60 * 60

export function adminPasswordConfigured(password: string | undefined): password is string {
    return typeof password === 'string' && password.length >= 16 && password.length <= 1024
}

export function matchesAdminPassword(candidate: string, password: string | undefined) {
    return adminPasswordConfigured(password) && timingSafeEqual(
        createHash('sha256').update(candidate).digest(), createHash('sha256').update(password).digest(),
    )
}

function signature(expires: string, password: string) {
    return createHmac('sha256', password).update(`agent-trace-admin:${expires}`).digest('hex')
}

/** The password signs a short-lived cookie; rotating it invalidates all existing admin sessions. */
export function createAdminSession(password: string | undefined, now = Date.now()) {
    if (!adminPasswordConfigured(password)) return null
    const expires = String(now + ADMIN_TRACE_SESSION_SECONDS * 1000)
    return `${expires}.${signature(expires, password)}`
}

export function verifyAdminSession(token: string | undefined, password: string | undefined, now = Date.now()) {
    if (!adminPasswordConfigured(password) || !token || !/^\d+\.[a-f0-9]{64}$/.test(token)) return false
    const [expires, mac] = token.split('.')
    if (!Number.isSafeInteger(Number(expires)) || Number(expires) <= now
        || Number(expires) > now + ADMIN_TRACE_SESSION_SECONDS * 1000) return false
    return timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(expires, password), 'hex'))
}

export function hasTraceAdminSession(request: Request) {
    const entry = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(ADMIN_TRACE_COOKIE + '='))
    return verifyAdminSession(entry?.slice(ADMIN_TRACE_COOKIE.length + 1), process.env.ADMIN_TRACE_PASSWORD)
}

export function traceJson(data: unknown, status = 200) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
}

export function sameOrigin(request: Request) {
    const origin = request.headers.get('origin')
    if (!origin) return false
    try {
        const parsed = new URL(origin)
        const internal = new URL(request.url)
        // Next 可规范化内部 URL 的主机名；使用实际 Host，不信任客户端传入的 X-Forwarded-Host。
        const host = request.headers.get('host') ?? internal.host
        const protocol = process.env.NODE_ENV === 'production' ? 'https:' : internal.protocol
        return parsed.origin === origin && parsed.host === host.toLowerCase() && parsed.protocol === protocol
    } catch { return false }
}
