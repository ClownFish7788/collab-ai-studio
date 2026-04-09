'use client'

import { createDocShape } from '@/utils/drawEditor'
import styles from './DrawEditor.module.scss'
import { Editor, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { useEffect, useState } from 'react'
import { useYjsStore } from '@/hooks/useYjsStore'
import { usePasteImageToTldraw } from '@/hooks/usePasteImageToTldraw'
import { getYjsProviderForRoom } from '@liveblocks/yjs'
import { useRoom } from '@liveblocks/react'
import { useOptimizedTldrawSync } from '@/hooks/useOptimizedTldrawSync'
import useStyleStore from '@/app/store/useStyleStore'
import { nanoid } from 'nanoid'
import { randomHexColor } from '@/utils/randomColor'
import useEditorStore from '@/app/store/useEditorStore'

const DrawEditor = () => {
    const [tldrawRef, setTldrawRef] = useState<null | Editor>(null)
    const room = useRoom()
    const yProvider = getYjsProviderForRoom(room)
    const yDoc = yProvider.getYDoc()
    const storeWithStatus = useYjsStore(yDoc, yProvider, {
        user: {
            id: localStorage.getItem('userId') || nanoid(),
            name: localStorage.getItem('userName') || '用户-a',
            color: randomHexColor()
        }
    })
    const role = useEditorStore(state => state.role)

    // 同时拖动多组件
    useOptimizedTldrawSync(tldrawRef, yDoc, yProvider)

    // 复制图片功能
    usePasteImageToTldraw(tldrawRef)

    // 根据theme改变tldraw主题
    const theme = useStyleStore((state) => state.theme)
    useEffect(() => {
        if(!tldrawRef) return
        tldrawRef.user.updateUserPreferences({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
    }, [theme, tldrawRef])

    if(storeWithStatus.status === 'loading') return null
    return (
        <div className={styles.container}>
            <Tldraw
                store={storeWithStatus.store}
                onMount={(editor) => {
                    editor.user.updateUserPreferences({ locale: 'zh-cn' })
                    editor.updateInstanceState({isReadonly: role === 'viewer'})
                    createDocShape(editor, () => {})
                    setTldrawRef(editor)
                    // const cleanup = editor.store.listen(() => {
                    //     updateEditor(editor.store.getStoreSnapshot())
                    // })
                    // 手动加载快照
                    // editor.store.loadStoreSnapshot(mydata)
                    // return cleanup
                }}
                
                // snapshot={mydata}
            ></Tldraw>
        </div>
    )
}

export default DrawEditor