'use client'

import classNames from "classnames"
import styles from './FontBar.module.scss'
import { useEditorState, type Editor } from "@tiptap/react"


const FontBar = ({editor}: {
    editor: Editor | null
}) => {
    const isActive = useEditorState({
        editor,
        selector: (ctx) => ({
            isBold: ctx.editor?.isActive('bold'),
            isItalic: ctx.editor?.isActive('italic'),
            isStrike: ctx.editor?.isActive('strike'),
            isCode: ctx.editor?.isActive('code'),
            isUnderline: ctx.editor?.isActive('underline'),
        })
    })
    const handleClick = (fn: () => unknown) => {
        if(!editor) return
        fn()
    }
    return (
        <div className={classNames(styles.container)}>
            <div 
                onClick={() => handleClick(() => editor?.chain().focus().toggleBold().run())}
                className={classNames(styles.item, isActive?.isBold && styles.active)}>
                加粗
            </div>
            <div 
                onClick={() => handleClick(() => editor?.chain().focus().toggleItalic().run())}
                className={classNames(styles.item, isActive?.isItalic && styles.active)}>
                斜体
            </div>
            <div 
                onClick={() => handleClick(() => editor?.chain().focus().toggleStrike().run())}
                className={classNames(styles.item, isActive?.isStrike && styles.active)}>
                删除线
            </div>
            <div 
                onClick={() => handleClick(() => editor?.chain().focus().toggleCode().run())}
                className={classNames(styles.item, isActive?.isCode && styles.active)}>
                代码
            </div>
            <div 
                onClick={() => handleClick(() => editor?.chain().focus().toggleUnderline().run())}
                className={classNames(styles.item, isActive?.isUnderline && styles.active)}>
                下划线
            </div>
        </div>
    )
}


export default FontBar