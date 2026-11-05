'use client'

import { useUserStore } from "@/app/store/useUserStore"
import { useEffect, useState } from "react"
import LocalDrawEditor from "./LocalDrawEditor"
import OnlineDrawEditor from "./OnlineDrawEdit"
import { getTldrawLicense } from "@/actions/getTldrawLicense"
import { useParams } from 'next/navigation'

const DrawEditor = () => {
    const isLogin = useUserStore(state => state.isLogin)
    const { workId } = useParams<{ workId: string }>()
    const [licenseKey, setLicenseKey] = useState<string | null>(null)
    useEffect(() => {
        getTldrawLicense().then(key => {
            setLicenseKey(key.trim() || "")
        })
    }, [])
    // 避免服务器与客户端渲染不一致（水合报错）
    if (!licenseKey) return null

    // 🌟 登录了走云端，没登录走本地
    if (isLogin) {
        return <OnlineDrawEditor key={workId} licenseKey={licenseKey} />
    }
    
    return <LocalDrawEditor key={workId} licenseKey={licenseKey} />
}

export default DrawEditor
