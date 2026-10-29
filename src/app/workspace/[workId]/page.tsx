'use client'

import React, { useCallback, useEffect, useState } from "react"
import useEditorStore from "@/app/store/useEditorStore"
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react"
import { LocalEditor } from "@/components/LocalEditor/LocalEditor"
import { checkLocalDoc } from "@/utils/storage/db"
import NotFound from "@/components/NotFound/NotFound"
import { toast } from "@/components/Toast"
import { useSession } from "next-auth/react"
import { resolveRoomAccess } from "@/utils/collaboration/roomAccess"

const EditorPage = ({
    params
}: {
    params: Promise<{ workId: string }>
}) => {
    const resolvedParams = React.use(params)
    const setRole = useEditorStore(state => state.setRole)
    const { status } = useSession()
    const isAuthenticated = status === 'authenticated'
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
        if (status === 'loading') return

        const checkCookie = async () => {
            try {
                if (!isAuthenticated) {
                    const localDoc = await checkLocalDoc(resolvedParams.workId)
                    setIsNotFound(resolveRoomAccess(false, localDoc).notFound)
                    return
                }

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
                const access = resolveRoomAccess(true, false, result)
                if (access.notFound || !access.role) {
                    setIsNotFound(true)
                    return
                }

                setIsNotFound(false)
                setRole(access.role)
            }catch (err) {
                console.error(err)
                toast.show('校验文档访问失败，请稍后重试')
                setIsNotFound(true)
            }
        }
        checkCookie()
    }, [resolvedParams.workId, setRole, isAuthenticated, status])

    // 检查登录session
    if(status === 'loading') return null
    if(isNotFound) return <NotFound />
    if(!isAuthenticated) return <LocalEditor />
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
