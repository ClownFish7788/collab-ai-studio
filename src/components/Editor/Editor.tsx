'use client'

import { useEffect, useState } from "react"
import * as Y from "yjs"
import { useRoom, useStatus } from "@liveblocks/react";
import { LiveblocksYjsProvider } from "@liveblocks/yjs"
import TiptapEditor from "./TiptapEditor"
import useEditorStore from "@/app/store/useEditorStore";
import { IndexeddbPersistence, storeState } from "y-indexeddb"
import useNetworkStore from "@/app/store/useNetworkStore";
import CustomBoradcastChannel from "@/utils/BoradcastChannelProvider";

const Editor = () => {
  // 初始化实时编辑
  const room = useRoom()
  // 查看 liveblocks 连接情况
  const status = useStatus()
  const [doc] = useState<Y.Doc>(() => new Y.Doc())
  const [provider, setProvider] = useState<LiveblocksYjsProvider>()
  const id = useEditorStore(state => state.id)
  const [isLocalloaded, setIsLocalloaded] = useState(false)

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

  useEffect(() => {
    if(!isLocalloaded) return
    const yProvider = new LiveblocksYjsProvider(room, doc)
    const customProvider = new CustomBoradcastChannel(id, doc)
    setProvider(yProvider)
    yProvider.on('synced', (isSynced: boolean) => {
      if(isSynced) {
        console.log("☁️ 云端 Liveblocks 同步完成！")
      }
    })

    return () => {
      yProvider.destroy()
      customProvider.destroy()
    }
  }, [isLocalloaded, room, doc, id])

  // 更改 status 视图
  const toggleNetworkStatus = useNetworkStore(state => state.toggleNetworkStatus)
  useEffect(() => {
    toggleNetworkStatus(status)
  }, [status, toggleNetworkStatus])
  if(!doc || !provider) {
    return <div>wait</div>
  }
  return <TiptapEditor doc={doc} provider={provider} />
}

export default Editor
