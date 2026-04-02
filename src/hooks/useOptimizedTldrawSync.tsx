import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import { useEffect, useRef } from "react";
import { Editor, TLRecord } from "tldraw";
import { YKeyValue } from "y-utility/y-keyvalue";
import * as Y from 'yjs'


export const useOptimizedTldrawSync = (
    editor: Editor | null,
    yDoc: Y.Doc,
    provider: LiveblocksYjsProvider
) => {
    const pendingChangesRef = useRef<Map<string, TLRecord>>(new Map())

    useEffect(() => {
        if(!editor || !provider) return 

        // 获取 Yjs 中存放 tldraw 数据的 Map（假设你的 map 命名为 'shapes' 或 'store'）
        const yArr = yDoc.getArray<{ key: string; val: TLRecord }>("tl_records")
        const yStore = new YKeyValue(yArr)
        const unsubscribe = editor.store.listen((update) => {
            if(update.source !== 'user') return

            // 获取当前的交互状态和选中的元素数量
            const isInteracting = editor.inputs.isDragging
            const selectedCount = editor.getSelectedShapeIds().length
            const isMasiveDrag = selectedCount > 10

            if(isInteracting && isMasiveDrag) {
                Object.values(update.changes.updated).forEach(([_, record]) => {
                    // 只把最新的坐标存在本地内存里，绝对不调 yStore.set()！
                    pendingChangesRef.current.set(record.id, record)
                })
                // 此时浏览器本地的 tldraw Canvas 会极其流畅地渲染这 5000 个元素的移动
                // 但 WebSocket 一条消息都不会发出去，彻底保护了网络和服务器。
                return
            }

            yDoc.transact(() => {
                // 1. 如果暂存池里有海量数据（说明刚松开鼠标），优先清空暂存池！
                if (pendingChangesRef.current.size > 0) {
                    pendingChangesRef.current.forEach((record, id) => {
                        yStore.set(id, record);
                    });
                    pendingChangesRef.current.clear(); // 结算完毕，清空暂存池
                }

                // 2. 正常处理本次的增删改
                Object.values(update.changes.added).forEach((record) => {
                    yStore.set(record.id, record);
                });
                Object.values(update.changes.updated).forEach(([_, record]) => {
                    yStore.set(record.id, record);
                });
                Object.values(update.changes.removed).forEach((record) => {
                    yStore.delete(record.id);
                });
                
            }, 'user-sync'); // 'user-sync' 是 Origin 标记，防止回音壁效应
        }, 
        {scope: 'document'})

        return () => unsubscribe()
    }, [editor, provider, yDoc])
}