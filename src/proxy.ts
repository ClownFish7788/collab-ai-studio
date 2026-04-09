import { NextRequest, NextResponse } from "next/server";



export function proxy (request: NextRequest) {
    let userId = request.cookies.get('userId')?.value
    const pathname = request.nextUrl.pathname
    const isAPIRequest = pathname.startsWith('/api')
    const response = NextResponse.next()
    // 拦截普通api请求，检查是否含有cookie
    if(isAPIRequest) {
        if(!userId) {
            return NextResponse.json({ error: 'Authentication required' }, {status: 401})
        }
        console.log(1)
    }
    if(!userId) {
        userId = crypto.randomUUID()
        response.cookies.set('userId',userId, {
            path: '/',
            maxAge: 60 * 60 * 24 * 365,
            httpOnly: true
        })
    }
    // 🌟 关键魔法：为了让接下来的 page.tsx 能立刻拿到刚生成的 ID
    // 我们把它塞进一个自定义的请求头 (x-user-id) 里传给页面
    response.headers.set('x-user-id', userId)
    return response
}

export const config = {
    matcher: [
        '/',
        '/api/:path*',
        '/workspace/:path*'
    ]
}