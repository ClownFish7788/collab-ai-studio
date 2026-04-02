import { Extension } from '@tiptap/core'
import { yCursorPlugin } from '@tiptap/y-tiptap'

//  扩展 Tiptap 全局的 Commands 接口，解决 TS 报错
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customCursor: {
      /**
       * 更新当前用户的光标状态（如名字、颜色等）
       */
      updateUser: (attributes: Record<string, any>) => ReturnType
    }
  }
}


interface CustomCursorOptions {
    awareness: any
    user?: Record<string, any>
}

export const CustomCursor = Extension.create<CustomCursorOptions>({
    name: "custom-cursor",
    addOptions () {
        return {
            awareness: null,
            user: {
                name: "custom",
                color: "#feca57"
            }
        }
    },
    // 在 TipTap 中注册 y-prosemirror
    addProseMirrorPlugins () {
        if(!this.options.awareness) {
            console.warn("CustomCursor 扩展需要传入 awareness 对象")
            return []
        }
        return [
            yCursorPlugin(this.options.awareness, {
                // 自定义光标DOM结构
                cursorBuilder (user: any) {
                    const cursor = document.createElement('span')
                    cursor.classList.add('custom-yjs-cursor')
                    cursor.setAttribute('style', `border-color: ${user.color}`)

                    // 光标上方用户提示
                    const customDiv = document.createElement('div')
                    customDiv.classList.add('custom-yjs-cursor-name')
                    customDiv.setAttribute('style', `background-color: ${user.color}`)
                    customDiv.insertBefore(document.createTextNode(user.name), null)
                    
                    cursor.insertBefore(customDiv, null)
                    return cursor
                }
            })
        ]
    },
    addCommands () {
        return {
            updateUser: (attributes: Record<string, any>) => ({ editor }) => {
                // 更新内部状态
                this.options.user = { ...this.options.user, ...attributes }
                // 同步到 yjs/liveblocks 的 awareness 中，向其他用户广播
                if (this.options.awareness) {
                    this.options.awareness.setLocalStateField('user', this.options.user)
                }
                return true // Tiptap 的 Command 必须返回 true 才能继续执行
            }
        }
    },
    // 初始化时，注册当前用户的信息到 awareness 中
    onCreate() {
        if (this.options.awareness) {
            this.options.awareness.setLocalStateField('user', this.options.user)
        }
    }
})