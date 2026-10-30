import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { traceAgentRequest } from './lib/agentTraceRequest'

const agentKind = (path: string) => path === '/api/chat' ? 'chat' as const : path === '/api/board-create' || path.startsWith('/api/board-create/') ? 'board' as const : undefined



export async function proxy (request: NextRequest) {
    try {
        const pathname = request.nextUrl.pathname
        const isAPIRequest = pathname.startsWith('/api')
        const response = NextResponse.next()
        // 后台记录 API 使用独立密码会话，每条路由自行校验；不能要求普通用户的 NextAuth 登录。
        if (pathname === '/api/admin/agent-traces' || pathname.startsWith('/api/admin/agent-traces/')) return response
        // 登录api放行
        if(pathname.startsWith('/api/auth')) {
            return response
        }
        // 拦截普通api请求，检查是否含有cookie
        if(isAPIRequest) {
            const token = await getToken({
                req: request,
                secret: process.env.NEXTAUTH_SECRET
            })
            if(!token) {
                const kind = agentKind(pathname)
                if (kind) return traceAgentRequest(request, kind, async () => NextResponse.json({ error: 'Authentication required' }, { status: 401 }))
                return NextResponse.json({ error: 'Authentication required' }, {status: 401})
            }
        }
        return response
    } catch (err) {
        const kind = agentKind(request.nextUrl.pathname)
        if (kind) return traceAgentRequest(request, kind, async () => { throw err })
        return NextResponse.json({ err }, {status: 500})
    }
}

export const config = {
    matcher: [
        '/',
        '/api/:path*',
        '/workspace/:path*'
    ]
}
