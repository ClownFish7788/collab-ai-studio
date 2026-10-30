import type { NextAuthOptions } from 'next-auth'
import GithubProvider from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import prisma from './prisma'

// 共享配置放在普通模块；Next 路由只允许导出 HTTP 处理函数及框架支持的配置。
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GithubProvider({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
      issuer: 'https://github.com/login/oauth',
      // GitHub token/userinfo 请求可能受本地网络延迟影响；openid-client 默认仅等待 3.5 秒。
      httpOptions: { timeout: 60000 },
      authorization: { params: { scope: 'read:user user:email' } },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.id as string
      return session
    },
  },
  debug: process.env.NODE_ENV === 'development',
}
