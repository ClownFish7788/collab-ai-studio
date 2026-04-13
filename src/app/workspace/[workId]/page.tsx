'use client'

import React, { useCallback, useEffect, useState } from "react"
import useEditorStore from "@/app/store/useEditorStore"
import { redirect } from "next/navigation"
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react"
import { LocalEditor } from "@/components/LocalEditor/LocalEditor"
import { useUserStore } from "@/app/store/useUserStore"
import { checkLocalDoc } from "@/utils/db"
import NotFound from "@/components/NotFound/NotFound"

const EditorPage = ({
    params
}: {
    params: Promise<{ workId: string }>
}) => {
    const resolvedParams = React.use(params)
    const setRole = useEditorStore(state => state.setRole)
    const [isMounted, setIsMounted] = useState(false)
    const isLogin = useUserStore(state => state.isLogin)
    // useCallback缓存authEndpoint函数
    const authEndpointFn = useCallback(async (room:string | undefined) => {
        const response = await fetch('/api/liveblocks-auth', {
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                room
            })
        })
        const data = await response.json()
        return data
    }, [])

    // 检查该用户是否有资格进入
    const [isNotFound, setIsNotFound] = useState(false)
    useEffect(() => {
        const checkCookie = async () => {
            // 还需要加上一个查找本地是否存在该文件的逻辑
            try {
                const localDoc = await checkLocalDoc(resolvedParams.workId)
                if(isLogin) {
                    const response = await fetch('/api/entry-validations', {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            roomId: resolvedParams.workId
                        })
                    })
                    const result = await response.json()
                    if(!result.success && !localDoc) {
                        setIsNotFound(true)
                    }
                    const { role } = result.message
                    setRole(role)
                    return
                }
                if(!localDoc) {
                    setIsNotFound(true)
                }
            }catch (err) {
                console.error(err)
                setIsNotFound(true)
            }
        }
        checkCookie()
    }, [resolvedParams.workId, setRole, isLogin])

    useEffect(() => {
        setIsMounted(true)
    }, [])
    // 检查登录session
    if(!isMounted) return null
    if(isNotFound) return <NotFound />
    if(!isLogin) return <LocalEditor />
    return (
        <LiveblocksProvider
            authEndpoint={authEndpointFn}
        >
            <RoomProvider id={resolvedParams.workId}>
                <LocalEditor />
            </RoomProvider>
        </LiveblocksProvider>
    )
}

export default EditorPage