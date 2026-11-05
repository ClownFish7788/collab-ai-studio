'use client'

import styles from './DrawEditor.module.scss'
import { Editor, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { useEffect, useMemo, useState } from 'react'
import { useOnlineYjsStore } from '@/hooks/useOnlineYjsStore' // 🌟 注意名字换了
import { usePasteImageToTldraw } from '@/hooks/usePasteImageToTldraw'
import { getYjsProviderForRoom } from '@liveblocks/yjs'
import { useRoom } from '@liveblocks/react'
import useStyleStore from '@/app/store/useStyleStore'
import { randomHexColor } from '@/utils/randomColor'
import useEditorStore from '@/app/store/useEditorStore'
import { useUserStore } from '@/app/store/useUserStore'
import AIChat from '../AIChat/AIChat'
import BoardDraftProvider, { BoardChatSlot } from './BoardDraftProvider'
import { attachTldrawYjsHistory } from '@/utils/collaboration/tldrawYjsHistory'
import { BoardSyncError } from './BoardSyncError'
import { toast } from '@/components/Toast'

const OnlineDrawEditor = ({licenseKey}: {
    licenseKey: string
}) => {
    const [tldrawRef, setTldrawRef] = useState<null | Editor>(null)
    const room = useRoom() // 这里绝对安全！
    const yProvider = getYjsProviderForRoom(room)
    const yDoc = yProvider.getYDoc()
    const userId = useUserStore(state => state.id)
    const username = useUserStore(state => state.name)
    const role = useEditorStore(state => state.role)
    const canEdit = role === 'owner' || role === 'collaborator'
    const user = useMemo(() => ({ id: userId, name: username, color: randomHexColor() }), [userId, username])
    // 连网版的 Store
    const storeWithStatus = useOnlineYjsStore(yDoc, yProvider, {
        user, canEdit,
    })
    
    usePasteImageToTldraw(tldrawRef)
    useEffect(() => {
        if (tldrawRef && !tldrawRef.isDisposed) tldrawRef.updateInstanceState({ isReadonly: !canEdit })
    }, [canEdit, tldrawRef])

    const theme = useStyleStore((state) => state.theme)
    useEffect(() => {
        if(!tldrawRef) return
        tldrawRef.user.updateUserPreferences({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
    }, [theme, tldrawRef])

    if(storeWithStatus.status === 'loading') return <div className={styles.container}>加载云端协同画板中...</div>
    if (storeWithStatus.status === 'error') return <div className={styles.container}>
        <BoardSyncError error={storeWithStatus.error} backup={storeWithStatus.backup} roomId={room.id} />
    </div>

    return (
        <div className={styles.container}>
            <BoardDraftProvider editor={tldrawRef} licenseKey={licenseKey} roomId={room.id} canEdit={canEdit} chat={<AIChat key={room.id} />}>
            <Tldraw
                components={{ SharePanel: BoardChatSlot }}
                licenseKey={licenseKey}
                store={storeWithStatus.store}
                onMount={(editor) => {
                    editor.user.updateUserPreferences({ locale: 'zh-cn' })
                    editor.updateInstanceState({isReadonly: !canEdit})
                    setTldrawRef(editor)
                    if (storeWithStatus.binding) return attachTldrawYjsHistory(editor, storeWithStatus.binding,
                        () => toast.show('相关内容已被协作者修改，本次撤销或重做未执行'))
                }}
            />
            </BoardDraftProvider>
        </div>
    )
}

export default OnlineDrawEditor
