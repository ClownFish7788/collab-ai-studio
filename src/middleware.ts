import { NextRequest, NextResponse } from "next/server";



export function middleware (request: NextRequest) {
    let userId = request.cookies.get('userId')?.value
    const response = NextResponse.next()
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
    matcher: ['/']
}