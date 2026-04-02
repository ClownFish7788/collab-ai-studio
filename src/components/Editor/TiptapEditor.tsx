'use client'

import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import styles from './Editor.module.scss'
import FontBar from "../FontBar/FontBar"
import classNames from "classnames"
import { useEffect, useRef, useCallback } from "react"
import useDebounce from "@/hooks/useDebounce"
import useEditorStore from "@/app/store/useEditorStore"
import * as Y from "yjs"
import Collaboration from "@tiptap/extension-collaboration"
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import { CustomCursor } from "@/utils/CustomCursor/CustomCursor"
import { LiveblocksYjsProvider } from "@liveblocks/yjs"
import '@/utils/CustomCursor/CustomCursor.css'
import useNetworkStore from "@/app/store/useNetworkStore"
import { getTitle, updateTitle as updateTitle_db } from "@/utils/db"

const TiptapEditor = ({doc, provider}: {
    doc:Y.Doc,
    provider: LiveblocksYjsProvider
}) => {
    const { id, title, updateTitle } = useEditorStore(state => state)
    const isOpenNetwork = useNetworkStore(state => state.isOpenNetwork)
    const inpRef = useRef<HTMLInputElement | null>(null)
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                history: false
            } as any), // 包含段落、加粗、斜体、标题、列表等基础功能
            TextStyle,
            FontFamily,
            Collaboration.configure({
                document: doc,
                field: 'tiptap-content'
            }),
            CustomCursor.configure({
                awareness: provider.awareness,
                user: {
                    name: "CLownFish",
                    color: '#ff5252'
                }
            })
        ],
        editorProps: {
            attributes: {
                spellcheck: "false",
                autocapitalize: "off",
                autocomplete: "off",
                autocorrect: "off",
            },
        },
        immediatelyRender: false
    })
    // 初始化数据
    const initTitle = useCallback(async (id: string) => {
        const response = await fetch(`/api/title?id=${id}`)
        const data = await response.json()
        const dbTitle = await getTitle(id)
        const title = data?.title ?? dbTitle
        updateTitle(title)
        if(data.title && dbTitle !== data.title) {
            updateTitle_db(id, data.title)
        }
    }, [updateTitle])
    // 通过id获取数据
    useEffect(() => {
        initTitle(id as string)
    }, [id, initTitle]) 
    // 上传更改title
    const handleChangeTitle = useDebounce(async (newTitle: string) => {
        updateTitle(newTitle)
        await updateTitle_db(newTitle, id)
        const response = await fetch('/api/title', {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                userId: localStorage.getItem('userId') || 'test-user',
                id,
                title: newTitle
            })
        })
        console.log(response)
    }, 500)
    const toggleNetworkStatus = useNetworkStore(state => state.toggleNetworkStatus)
    useEffect(() => {
        if(!provider) return
        async function togglePauseNetwork () {
            if(!isOpenNetwork) {
                try {
                    provider?.awareness.setLocalState(null) // 关闭时清除本地 presence，停止广播光标位置
                    await provider?.pause()
                    toggleNetworkStatus('disconnected')
                }catch (err) {
                    console.error(err)
                }
            } else {
                provider?.unpause()
                toggleNetworkStatus('connected')
            }
        }
        togglePauseNetwork()
    }, [isOpenNetwork, provider, toggleNetworkStatus])
    if (!editor) {
        return null
    }
    return (
        <div className={styles.editorWrapper}>
            <input
                type="text" 
                value={title || ""}
                onChange={e => handleChangeTitle(e.target.value)} 
                className={classNames(styles.title)} 
                placeholder="Title"
                ref={inpRef}
            />
            {/* 2. 编辑器渲染区域 */}
            <div className={styles.content}>
                <EditorContent editor={editor} />
                <FontBar editor={editor} />
            </div>
        </div>
    )
}

export default TiptapEditor