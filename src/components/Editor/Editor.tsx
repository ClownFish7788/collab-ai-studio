'use client'

import { useEffect, useState } from "react"
import * as Y from "yjs"
import TiptapEditor from "./TiptapEditor"
import useEditorStore from "@/app/store/useEditorStore";
import { IndexeddbPersistence, storeState } from "y-indexeddb"
import { useUserStore } from "@/app/store/useUserStore";
import { OnlineTiptapEditor } from "./OnlineTiptapEditor";

const Editor = () => {
  const [doc] = useState<Y.Doc>(() => new Y.Doc())
  const id = useEditorStore(state => state.id)
  const [isLocalloaded, setIsLocalloaded] = useState(false)
  // 是否登录
  const isLogin = useUserStore(state => state.isLogin)
  // 避免indexedDB正在保存时，用户删除标签页导致数据保存失败
  useEffect(() => {
    const indexeddbProvider = new IndexeddbPersistence(id, doc)
    indexeddbProvider.on('synced', () => {
      setIsLocalloaded(true)
    })
    // 为indexeddb增添beforeUnload功能
    let isSaving = false
    let timeout: ReturnType<typeof setTimeout>
    const handleUpdate = () => {
      isSaving = true
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        isSaving = false
        clearTimeout(timeout)
      }, 500)
    }
    doc.on('update', handleUpdate)
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if(isSaving) {
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
      if(!indexeddbProvider._destroyed) {
        // 离开前压缩indexedDB数据
        storeState(indexeddbProvider)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      doc.off('update', handleUpdate)
      clearTimeout(timeout)
      doc.destroy()
      indexeddbProvider.destroy()
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [id, doc])
  if(!doc) {
    return <div>wait</div>
  }
  if(isLogin) return <OnlineTiptapEditor doc={doc} isLocalloaded={isLocalloaded} />
  return <TiptapEditor doc={doc} provider={null} />
}

export default Editor
