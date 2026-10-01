'use client'

import { useEffect, useMemo, useState } from "react"
import * as Y from "yjs"
import TiptapEditor from "./TiptapEditor"
import useEditorStore from "@/app/store/useEditorStore"
import { IndexeddbPersistence, storeState } from "y-indexeddb"
import { useUserStore } from "@/app/store/useUserStore"
import { OnlineTiptapEditor } from "./OnlineTiptapEditor"
import { EditorLoading } from "./EditorLoading"

const Editor = () => {
  const id = useEditorStore(state => state.id)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const isLogin = useUserStore(state => state.isLogin)
  const doc = useMemo<Y.Doc | null>(
    () => id.trim() ? new Y.Doc() : null,
    [id]
  )

  useEffect(() => {
    if (!doc) return

    const indexeddbProvider = new IndexeddbPersistence(id, doc)
    let isActive = true

    const handleSynced = () => {
      if (isActive) setLoadedId(id)
    }

    const handleBeforeUnload = () => {
      if (indexeddbProvider.db && !indexeddbProvider._destroyed) {
        storeState(indexeddbProvider)
      }
    }

    indexeddbProvider.on('synced', handleSynced)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      isActive = false
      indexeddbProvider.off('synced', handleSynced)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      indexeddbProvider.destroy()
    }
  }, [id, doc])

  const isLocalloaded = doc !== null && loadedId === id
  if (!doc || !isLocalloaded) {
    return (
      <EditorLoading
        title="正在加载编辑器"
        description="正在从本地 IndexedDB 恢复文档，请稍候…"
      />
    )
  }

  if (isLogin) {
    return <OnlineTiptapEditor key={id} doc={doc} isLocalloaded={isLocalloaded} />
  }

  return <TiptapEditor key={id} doc={doc} provider={null} />
}

export default Editor
