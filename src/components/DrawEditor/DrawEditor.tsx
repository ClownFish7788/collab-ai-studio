'use client'

import { useUserStore } from "@/app/store/useUserStore"
import { useEffect, useState } from "react"
import LocalDrawEditor from "./LocalDrawEditor"
import OnlineDrawEditor from "./OnlineDrawEdit"

const DrawEditor = () => {
    const isLogin = useUserStore(state => state.isLogin)
    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
        setIsMounted(true)
    }, [])

    // 避免���务器与客户端渲染不一致（水合报错）
    if (!isMounted) return null

    // 🌟 登录了走云端，没登录走本地
    if (isLogin) {
        return <OnlineDrawEditor />
    }
    
    return <LocalDrawEditor />
}

export default DrawEditor