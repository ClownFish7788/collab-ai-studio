'use client'
import { useUserStore } from "@/app/store/useUserStore"
import CustomBoradcastChannel from "@/utils/BoradcastChannelProvider"
import { useRoom, useStatus } from "@liveblocks/react"
import { LiveblocksYjsProvider } from "@liveblocks/yjs"
import { useEffect, useState } from "react"
import * as Y from "yjs"
import TiptapEditor from "./TiptapEditor"
import useNetworkStore from "@/app/store/useNetworkStore"

export const OnlineTiptapEditor = ({doc, isLocalloaded}: {
    doc: Y.Doc
    isLocalloaded: boolean
}) => {
    // 初始化编辑
    const room = useRoom()
    // 网络状况
    const status = useStatus()
    const [provider, setProvider] = useState<LiveblocksYjsProvider>()
    const id = useUserStore(state => state.id)
    useEffect(() => {
        if(!isLocalloaded) return
        const yProvider = new LiveblocksYjsProvider(room, doc)
        const customProvider = new CustomBoradcastChannel(id, doc)
        setProvider(yProvider)
        yProvider.on('synced', (isSynced: boolean) => {
        if(isSynced) {
            console.log("☁️ 云端 Liveblocks 同步完成！")
        }
        })

        return () => {
        yProvider.destroy()
        customProvider.destroy()
        }
    }, [isLocalloaded, room, doc, id])
    // 更改 status 视图
    const toggleNetworkStatus = useNetworkStore(state => state.toggleNetworkStatus)
    useEffect(() => {
        toggleNetworkStatus(status)
    }, [status, toggleNetworkStatus])
    if(!doc || !provider) {
        return <div>wait</div>
    }
    return <TiptapEditor doc={doc} provider={provider} />
}