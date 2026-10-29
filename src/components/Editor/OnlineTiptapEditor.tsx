'use client'
import CustomBoradcastChannel from "@/utils/collaboration/BoradcastChannelProvider"
import { useRoom, useStatus } from "@liveblocks/react"
import { LiveblocksYjsProvider } from "@liveblocks/yjs"
import { useCallback, useEffect, useRef, useState } from "react"
import * as Y from "yjs"
import TiptapEditor from "./TiptapEditor"
import useNetworkStore from "@/app/store/useNetworkStore"
import { EditorLoading } from "./EditorLoading"

export const OnlineTiptapEditor = ({doc, isLocalloaded}: {
    doc: Y.Doc
    isLocalloaded: boolean
}) => {
    // 初始化编辑
    const room = useRoom()
    // 网络状况
    const status = useStatus()
    const [provider, setProvider] = useState<LiveblocksYjsProvider>()
    const providerRef = useRef<{
        doc: Y.Doc
        provider: LiveblocksYjsProvider
        customProvider: CustomBoradcastChannel
        destroyTimer: ReturnType<typeof setTimeout> | null
    } | null>(null)
    const scheduleDestroy = useCallback((entry: NonNullable<typeof providerRef.current>) => {
        if (entry.destroyTimer) return
        // Liveblocks destroy() also destroys the shared Y.Doc; defer so StrictMode cleanup can be canceled.
        entry.destroyTimer = setTimeout(() => {
            if (providerRef.current === entry) {
                providerRef.current = null
            }
            entry.provider.destroy()
            entry.customProvider.destroy()
            entry.destroyTimer = null
        }, 0)
    }, [])

    useEffect(() => {
        if(!isLocalloaded) return

        const current = providerRef.current
        if (current?.doc === doc) {
            if (current.destroyTimer) {
                clearTimeout(current.destroyTimer)
                current.destroyTimer = null
            }
            setProvider(current.provider)
            return () => scheduleDestroy(current)
        }

        const yProvider = new LiveblocksYjsProvider(room, doc)
        const customProvider = new CustomBoradcastChannel(room.id, doc)
        const entry = { doc, provider: yProvider, customProvider, destroyTimer: null }
        providerRef.current = entry
        setProvider(yProvider)
        yProvider.on('synced', (isSynced: boolean) => {
            if(isSynced) {
                console.log("☁️ 云端 Liveblocks 同步完成！")
            }
        })

        return () => {
            scheduleDestroy(entry)
        }
    }, [isLocalloaded, room, doc, scheduleDestroy])
    // 更改 status 视图
    const toggleNetworkStatus = useNetworkStore(state => state.toggleNetworkStatus)
    useEffect(() => {
        toggleNetworkStatus(status)
    }, [status, toggleNetworkStatus])
    if(!doc || !provider) {
        return (
            <EditorLoading
                title="正在连接协同"
                description="正在初始化实时协作与云端同步，请稍候…"
            />
        )
    }
    return <TiptapEditor doc={doc} provider={provider} />
}
