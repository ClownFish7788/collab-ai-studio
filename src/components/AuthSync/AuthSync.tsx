'use client'

import { UserInfo, useUserStore } from "@/app/store/useUserStore"
import { useSession } from "next-auth/react"
import { useEffect } from "react"

// 检测是否登录
export const AuthSync = () => {
    const session = useSession()
    const setUser = useUserStore(state => state.setUserInformation)
    const setIsLogin = useUserStore(state => state.setIsLogin)
    useEffect(() => {
        console.log(session)
        const userInfo = session.data?.user
        if(!userInfo) {
            setIsLogin(false)
        } else {
            setUser(userInfo as UserInfo)
            setIsLogin(true)
        }
    }, [session, setIsLogin, setUser])
    return <></>
}