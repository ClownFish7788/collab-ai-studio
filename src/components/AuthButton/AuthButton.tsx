'use client'
import { signIn, signOut } from "next-auth/react"

export const LoginButton = () => {

    return (
        <button
            onClick={() => signIn('github', {callbackUrl: "/"})}
        >
            使用Github登录
        </button>
    )
}

export const LogoutButton = () => {

    return (
        <button
            onClick={() => signOut({callbackUrl: "/"})}
        >
            退出登录
        </button>
    )
}