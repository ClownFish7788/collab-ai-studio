const REGISTRY_KEY = 'yjs-lru-registry'

// 更新数据时间
export const updateDocumentAccessTime = (id: string) => {
    try {
        const registry = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}')
        registry[id] = new Date()
        localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry))
    }catch(err) {
        console.error("LRU Registry 更新失败", err)
    }
}

// 数据超过时进行LRU数据清洗
export const checkAndClearStorageLRU = async (currentId: string, threshold = 0.9) => {
    if(!navigator.storage || !navigator.storage.estimate) return
    try {
        const estimate = await navigator.storage.estimate()
        if(!estimate.usage || !estimate.quota || estimate.quota === 0) return
        const percentage = estimate.usage / estimate.quota
        if(percentage > threshold) {
            const registry: Record<string, number> = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}')
            const sortDocs = Object.entries(registry).filter(([id]) => id !== currentId).sort((a,b) => a[1] - b[1])
            const docsToDelete = sortDocs.slice(0, 3)
            for(const [docId] of docsToDelete) {
                indexedDB.deleteDatabase(`room-${docId}`)
                delete registry[docId]
            }
            localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry))
        }
    }catch (err) {
        console.error("执行 LRU 清理失败", err)
    }
}

// 展示已用内存和所有内存空间
export const showStorage = async () => {
    try {
        const estimate = await navigator.storage.estimate()
        const usage = estimate.usage ? estimate.usage / (1024 ** 3) : null
        const quota = estimate.quota ? estimate.quota / (1024 ** 3) : null
        return [usage, quota]
    }catch (err) {
        console.error(err)
    }
    return [null, null]
}