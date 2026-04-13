import NextAuth, { NextAuthOptions } from "next-auth"
import GithubProvider from "next-auth/providers/github"
import { PrismaAdapter } from "@auth/prisma-adapter"
import prisma from "@/lib/prisma"

// 🌟 1. 导出配置对象（极其重要，别的地方要用）
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GithubProvider({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
      authorization: {
        params: {
          scope: 'read:user user:email'
        }
      }
    }),
  ],
  // v4 默认使用 JWT 策略保存 session
  session: {
    strategy: "jwt",
  },
  callbacks: {
    // 把 Prisma 数据库里的真实用户 ID 塞进 token 里
    async jwt({token, user}) {
      if(user) {
        token.id = user.id
      }
      return token
    },
    async session ({session, token}) {
      if(session.user) {
        session.user.id = token.id as string
      }
      return session
    }
  },
  debug: process.env.NODE_ENV === 'development'
}

// 🌟 2. 导出 GET 和 POST 处理函数（Next.js App Router 的标准写法）
const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }