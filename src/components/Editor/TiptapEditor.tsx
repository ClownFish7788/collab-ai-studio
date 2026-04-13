'use client'

import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import styles from './Editor.module.scss'
import FontBar from "../FontBar/FontBar"
import classNames from "classnames"
import { useEffect, useRef, useCallback, useState } from "react"
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
import { useUserStore } from "@/app/store/useUserStore"
import { randomHexColor } from "@/utils/randomColor"

const TiptapEditor = ({doc, provider}: {
    doc:Y.Doc,
    provider: LiveblocksYjsProvider | null
}) => {
    const { id, updateTitle } = useEditorStore(state => state)
    const title = useEditorStore(state => state.title)
    const role = useEditorStore(state => state.role) //用户身份
    const isOpenNetwork = useNetworkStore(state => state.isOpenNetwork)
    const inpRef = useRef<HTMLInputElement | null>(null)
    const isLogin = useUserStore(state => state.isLogin) // 是否登录
    const username = useUserStore(state => state.name)
    const [isMounted, setIsMounted] = useState(false)
    const [localTitle, setLocalTitle] = useState('')
    const editor = useEditor({
        editable: role !== 'viewer',
        extensions: [
            StarterKit.configure({
                history: false
            } as any), // 包含段落、加粗、斜体、标题、列表等基础功能
            TextStyle,
            FontFamily,
            ...(isLogin && isMounted && provider ? [
                Collaboration.configure({
                    document: doc,
                    field: 'tiptap-content'
                }),
                CustomCursor.configure({
                    awareness: provider.awareness,
                    user: {
                        name: username,
                        color: randomHexColor()
                    }
                })
            ]: [])
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
        let title
        title = await getTitle(id)
        if(isLogin) {
            const response = await fetch(`/api/title?id=${id}`)
            const data = await response.json()
            title = data?.title
        }
        updateTitle(title)
        updateTitle_db(id, title)
    }, [updateTitle, isLogin])
    // 通过id获取数据
    useEffect(() => {
        initTitle(id as string)
    }, [id, initTitle]) 
    // 初始化title
    useEffect(() => {
        setLocalTitle(title)
    }, [title])
    // 上传更改title
    const handleChangeTitle = useDebounce((newTitle: string) => {
        try {
            updateTitle(newTitle)
            updateTitle_db(id, newTitle)
            if(isLogin) {
                fetch('/api/title', {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        id,
                        title: newTitle
                    })
                })
            }
        } catch(err) {
            console.error(err)
        }
    }, 500)
    const toggleNetworkStatus = useNetworkStore(state => state.toggleNetworkStatus)
    useEffect(() => {
        if(!provider || !isLogin) return
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
    }, [isOpenNetwork, provider, toggleNetworkStatus, isLogin])

    useEffect(() => {
        setIsMounted(true)
    }, [])

    if (!editor || !isMounted) {
        return null
    }
    return (
        <div className={styles.editorWrapper}>
            <input
                type="text"
                value={localTitle}
                onChange={e => {
                    setLocalTitle(e.target.value)
                    handleChangeTitle(e.target.value)
                }} 
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