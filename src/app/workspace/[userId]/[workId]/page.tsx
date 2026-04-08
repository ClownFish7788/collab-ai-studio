'use client'

import Editor from "@/components/Editor/Editor"
import classNames from "classnames"
import React, { useCallback, useEffect, useState } from "react"
import styles from './page.module.scss'
import useEditorStore from "@/app/store/useEditorStore"
import { useSearchParams } from "next/navigation"
import DrawEditor from "@/components/DrawEditor/DrawEditor"
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react"
import { NetworkStatus } from "@/components/NetworkStatus/NetworkStatus"
import { checkAndClearStorageLRU, updateDocumentAccessTime } from "@/utils/storageManager"
import AddButton from "@/components/AddButton/AddButton"
import { InviteModal } from "@/components/Modal/InviteModal/InviteModal"

const EditorPage = ({
    params
}: {
    params: Promise<{ workId: string }>
}) => {
    const resolvedParams = React.use(params)
    const searchParams = useSearchParams()
    const mode = searchParams.get('mode')
    const [hasTldrawInitialized, setHasTldrawInitialized] = useState(false)
    const [isModalOpen, setIsModalOpen] = useState(false)
    
    useEffect(() => {
        if(mode === 'edgeless' && !hasTldrawInitialized) {
            setHasTldrawInitialized(true)
        }
    }, [mode, hasTldrawInitialized])
    
    const { toggleId } = useEditorStore(state => state)
    
    useEffect(() => {
        if(resolvedParams.workId) {
            toggleId(resolvedParams.workId)
        }
    }, [resolvedParams, toggleId])
    
    // 检查indexeddb是否还存在内存
    useEffect(() => {
        // LRU检查是否剩余内存过小
        updateDocumentAccessTime(resolvedParams.workId)
        checkAndClearStorageLRU(resolvedParams.workId)
    }, [resolvedParams.workId])

    // useCallback缓存authEndpoint函数
    const authEndpointFn = useCallback(async (room:string | undefined) => {
        const userId = localStorage.getItem('userId') || 'test-user'
        const userName = localStorage.getItem('userName') || '测试用户'
        const response = await fetch('/api/liveblocks-auth', {
            method: "POST",
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                user: {
                    id: userId,
                    name: userName
                },
                room
            })
        })
        const data = await response.json()
        return data
    }, [])
    
    return (
        <LiveblocksProvider
            authEndpoint={authEndpointFn}
            // publicApiKey={publicApiKey}
        >
            <RoomProvider id={resolvedParams.workId}>
                <div className={styles.wrapper}>
                    <div className={styles.status}>
                        <AddButton msg="邀请好友" handleClick={() => setIsModalOpen(true)} />
                        <NetworkStatus />
                        <InviteModal workId={resolvedParams.workId} isOpen={isModalOpen} closeFn={() => setIsModalOpen(false)} />
                    </div>
                    <div className={classNames(styles.container)}>
                        <div className={classNames(styles.tiptap, styles.editor, mode !== 'edgeless' && styles.active)}>
                            <Editor />
                        </div>
                        {
                            hasTldrawInitialized &&
                            <div className={classNames(styles.tldraw, styles.editor, mode === 'edgeless' && styles.active)}>
                                <DrawEditor />
                            </div>
                        }
                    </div>
                </div>
            </RoomProvider>
        </LiveblocksProvider>
    )
}

export default EditorPage