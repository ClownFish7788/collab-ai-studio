import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";



export async function proxy (request: NextRequest) {
    try {
        const pathname = request.nextUrl.pathname
        const isAPIRequest = pathname.startsWith('/api')
        const response = NextResponse.next()
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
                return NextResponse.json({ error: 'Authentication required' }, {status: 401})
            }
        }
        return response
    } catch (err) {
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