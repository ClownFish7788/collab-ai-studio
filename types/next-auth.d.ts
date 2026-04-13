import NextAuth, { DefaultSession } from "next-auth"

// 告诉 TypeScript：我的 Session 的 user 对象里是包含 id 的！
declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
  }
}