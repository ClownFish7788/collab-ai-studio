'use client'

import { createDocShape } from '@/utils/drawEditor'
import styles from './DrawEditor.module.scss'
import { Editor, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { useEffect, useState } from 'react'
import { useOnlineYjsStore } from '@/hooks/useOnlineYjsStore' // 🌟 注意名字换了
import { usePasteImageToTldraw } from '@/hooks/usePasteImageToTldraw'
import { getYjsProviderForRoom } from '@liveblocks/yjs'
import { useRoom } from '@liveblocks/react'
import { useOptimizedTldrawSync } from '@/hooks/useOptimizedTldrawSync'
import useStyleStore from '@/app/store/useStyleStore'
import { randomHexColor } from '@/utils/randomColor'
import useEditorStore from '@/app/store/useEditorStore'
import { useUserStore } from '@/app/store/useUserStore'

const OnlineDrawEditor = () => {
    const [tldrawRef, setTldrawRef] = useState<null | Editor>(null)
    const room = useRoom() // 这里绝对安全！
    const yProvider = getYjsProviderForRoom(room)
    const yDoc = yProvider.getYDoc()
    const userId = useUserStore(state => state.id)
    const username = useUserStore(state => state.name)
    // 连网版的 Store
    const storeWithStatus = useOnlineYjsStore(yDoc, yProvider, {
        user: {
            id: userId,
            name: username,
            color: randomHexColor()
        }
    })
    
    const role = useEditorStore(state => state.role)
    useOptimizedTldrawSync(tldrawRef, yDoc, yProvider)
    usePasteImageToTldraw(tldrawRef)

    const theme = useStyleStore((state) => state.theme)
    useEffect(() => {
        if(!tldrawRef) return
        tldrawRef.user.updateUserPreferences({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
    }, [theme, tldrawRef])

    if(storeWithStatus.status === 'loading') return <div className={styles.container}>加载云端协同画板中...</div>

    return (
        <div className={styles.container}>
            <Tldraw
                store={storeWithStatus.store}
                onMount={(editor) => {
                    editor.user.updateUserPreferences({ locale: 'zh-cn' })
                    editor.updateInstanceState({isReadonly: role === 'viewer'})
                    createDocShape(editor, () => {})
                    setTldrawRef(editor)
                }}
            />
        </div>
    )
}

export default OnlineDrawEditor