'use client'

import React, { useCallback, useEffect, useState } from "react"
import useEditorStore from "@/app/store/useEditorStore"
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react"
import { LocalEditor } from "@/components/LocalEditor/LocalEditor"
import { checkLocalDoc } from "@/utils/storage/db"
import NotFound from "@/components/NotFound/NotFound"
import { toast } from "@/components/Toast"
import { useSession } from "next-auth/react"
import { matchesRoomAccess, resolveRoomAccess, type RoomAccessScope } from "@/utils/collaboration/roomAccess"

const EditorPage = ({
    params
}: {
    params: Promise<{ workId: string }>
}) => {
    const resolvedParams = React.use(params)
    const setRole = useEditorStore(state => state.setRole)
    const toggleId = useEditorStore(state => state.toggleId)
    const { status, data: session } = useSession()
    const isAuthenticated = status === 'authenticated'
    const principal = isAuthenticated ? session?.user?.id ?? '' : 'local'
    // useCallback缓存authEndpoint函数
    const authEndpointFn = useCallback(async (room:string | undefined) => {
        const response = await fetch('/api/liveblocks-auth', {
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                room, boardProtocol: 2
            })
        })
        if (!response.ok) throw new Error(await response.text())
        const data = await response.json()
        return data
    }, [])

    // 检查该用户是否有资格进入
    const [accessScope, setAccessScope] = useState<RoomAccessScope | null>(null)
    useEffect(() => {
        if (status === 'loading') return
        let cancelled = false
        const controller = new AbortController()
        const finish = (notFound: boolean, role: Parameters<typeof setRole>[0] = null) => {
            if (cancelled) return
            toggleId(resolvedParams.workId)
            setRole(role)
            setAccessScope({ roomId: resolvedParams.workId, principal, notFound })
        }

        const checkCookie = async () => {
            try {
                if (!isAuthenticated) {
                    const localDoc = await checkLocalDoc(resolvedParams.workId)
                    finish(resolveRoomAccess(false, localDoc).notFound)
                    return
                }

                const response = await fetch('/api/entry-validations', {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        roomId: resolvedParams.workId
                    })
                })
                if (!response.ok) { finish(true); return }
                const result = await response.json()
                const access = resolveRoomAccess(true, false, result)
                if (access.notFound || !access.role) {
                    finish(true)
                    return
                }

                finish(false, access.role)
            }catch (err) {
                if (cancelled) return
                console.error(err)
                toast.show('校验文档访问失败，请稍后重试')
                finish(true)
            }
        }
        void checkCookie()
        return () => { cancelled = true; controller.abort() }
    }, [resolvedParams.workId, principal, setRole, toggleId, isAuthenticated, status])

    // 检查登录session
    if(status === 'loading') return null
    if (!matchesRoomAccess(accessScope, resolvedParams.workId, principal)) return null
    if(accessScope?.notFound) return <NotFound />
    if(!isAuthenticated) return <LocalEditor />
    return (
        <LiveblocksProvider
            authEndpoint={authEndpointFn}
        >
            <RoomProvider key={`${principal}:${resolvedParams.workId}`} id={resolvedParams.workId}>
                <LocalEditor />
            </RoomProvider>
        </LiveblocksProvider>
    )
}

export default EditorPage
