'use client'

import styles from './DrawEditor.module.scss'
import { Editor, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { useEffect, useState, useMemo } from 'react'
import { useLocalYjsStore } from '@/hooks/useLocalYjsStore' // 🌟 专为本地写的 Hook
import { usePasteImageToTldraw } from '@/hooks/usePasteImageToTldraw'
import useStyleStore from '@/app/store/useStyleStore'
import * as Y from 'yjs'
import { useParams } from 'next/navigation'
import AIChat from '../AIChat/AIChat'
import BoardDraftProvider, { BoardChatSlot } from './BoardDraftProvider'
import { attachTldrawYjsHistory } from '@/utils/collaboration/tldrawYjsHistory'
import { BoardSyncError } from './BoardSyncError'
import { toast } from '@/components/Toast'
import { BoardRetainedNotice } from './BoardRetainedNotice'

const LocalDrawEditor = ({licenseKey}: {
    licenseKey:string
}) => {
    const [tldrawRef, setTldrawRef] = useState<null | Editor>(null)
    const params = useParams<{workId: string}>()
    const roomId = params.workId || 'local-room'

    // 🌟 自己在本地 new 一个 Y.Doc，不需要 Liveblocks 给
    const yDoc = useMemo(() => new Y.Doc(), [])
    
    // 🌟 本地版的 Store（只读写 IndexedDB）
    const storeWithStatus = useLocalYjsStore(yDoc, roomId)

    usePasteImageToTldraw(tldrawRef)

    const theme = useStyleStore((state) => state.theme)
    useEffect(() => {
        if(!tldrawRef) return
        tldrawRef.user.updateUserPreferences({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
    }, [theme, tldrawRef])
    if(storeWithStatus.status === 'loading') return <div className={styles.container}>加载本地私有画板中...</div>
    if (storeWithStatus.status === 'error') return <div className={styles.container}>
        <BoardSyncError error={storeWithStatus.error} backup={storeWithStatus.backup} roomId={roomId}
            onUpgrade={storeWithStatus.upgrade} />
    </div>
    return (
        <div className={`${styles.container} ${styles.boardLayout}`}>
            <BoardRetainedNotice binding={storeWithStatus.binding} />
            <div className={styles.canvas}>
            <BoardDraftProvider editor={tldrawRef} licenseKey={licenseKey} roomId={roomId} canEdit local chat={<AIChat key={roomId} />}>
            <Tldraw
                components={{ SharePanel: BoardChatSlot }}
                licenseKey={licenseKey}
                store={storeWithStatus.store}
                onMount={(editor) => {
                    editor.user.updateUserPreferences({ locale: 'zh-cn' })
                    editor.updateInstanceState({isReadonly: false}) // 游客自己玩，肯定是可编辑的
                    setTldrawRef(editor)
                    if (storeWithStatus.binding) return attachTldrawYjsHistory(editor, storeWithStatus.binding,
                        () => toast.show('相关内容已被协作者修改，本次撤销或重做未执行'))
                }}
            />
            </BoardDraftProvider>
            </div>
        </div>
    )
}

export default LocalDrawEditor
