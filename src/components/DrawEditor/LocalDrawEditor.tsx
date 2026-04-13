'use client'

import { createDocShape } from '@/utils/drawEditor'
import styles from './DrawEditor.module.scss'
import { Editor, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { useEffect, useState, useMemo } from 'react'
import { useLocalYjsStore } from '@/hooks/useLocalYjsStore' // 🌟 专为本地写的 Hook
import { usePasteImageToTldraw } from '@/hooks/usePasteImageToTldraw'
import useStyleStore from '@/app/store/useStyleStore'
import * as Y from 'yjs'
import { useParams } from 'next/navigation'

const LocalDrawEditor = () => {
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

    return (
        <div className={styles.container}>
            <Tldraw
                store={storeWithStatus.store}
                onMount={(editor) => {
                    editor.user.updateUserPreferences({ locale: 'zh-cn' })
                    editor.updateInstanceState({isReadonly: false}) // 游客自己玩，肯定是可编辑的
                    createDocShape(editor, () => {})
                    setTldrawRef(editor)
                }}
            />
        </div>
    )
}

export default LocalDrawEditor