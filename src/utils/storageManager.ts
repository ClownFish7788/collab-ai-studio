const REGISTRY_KEY = 'yjs-lru-registry'

// 更新数据时间
const updateDocumentAccessTime = (id: string) => {
    try {
        const registry = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}')
        registry[id] = new Date()
        localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry))
    }catch(err) {
        console.error("LRU Registry 更新失败", err)
    }
}

// 数据超过时进行LRU数据清洗
const checkAndClearStorageLRU = async (currentId: string, threshold = 0.9) => {
    if(!navigator.storage || !navigator.storage.estimate) return
    try {
        const estimate = await navigator.storage.estimate()
        if(!estimate.usage || !estimate.quota || estimate.quota === 0) return
        const percentage = estimate.usage / estimate.quota
        console.log('LRU开始检查🗑️')
        if(percentage > threshold) {
            const registry: Record<string, number> = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}')
            const sortDocs = Object.entries(registry).filter(([id]) => id !== currentId).sort((a,b) => a[1] - b[1])
            const docsToDetele = sortDocs.slice(0, 3)
            for(const [docId] of docsToDetele) {
                indexedDB.deleteDatabase(`room-${docId}`)
                delete registry[docId]
                console.log(`🗑️ LRU 淘汰：已清理沉睡文档 [${docId}] 的本地缓存`)
            }
            localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry))
        }
    }catch (err) {
        console.error("执行 LRU 清理失败", err)
    }
}

export {updateDocumentAccessTime, checkAndClearStorageLRU}