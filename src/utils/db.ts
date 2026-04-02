import { openDB } from "idb"

const DB_NAME = 'editor-data'
const DB_VERSION = 2
const LIST_STORE_NAME = 'list-data'

// 初始化或打开数据库
export const initDB = async () => {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if(!db.objectStoreNames.contains(LIST_STORE_NAME)) {
                db.createObjectStore(LIST_STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true
                })
            }
        }
    })
}

export const addData = async (
    title: string,
    id: string
) => {
    const db = await initDB()
    
    // 检查是否已存在相同ID的文档
    const tx1 = db.transaction([LIST_STORE_NAME], 'readonly')
    const existingDoc = await tx1.objectStore(LIST_STORE_NAME).get(id)
    await tx1.done
    
    if (existingDoc) {
        // 文档已存在，直接返回ID
        return id
    }
    
    // 文档不存在，创建新文档
    const tx2 = db.transaction([LIST_STORE_NAME], 'readwrite')
    const newItem = {
        title,
        createAt: new Date(),
        id: id
    }
    await tx2.objectStore(LIST_STORE_NAME).add(newItem)
    await tx2.done
    return id
}

export const getList = async (limit?:number) => {
    const db = await initDB()
    return db.getAll(LIST_STORE_NAME, null, limit)
}

export const getTitle = async (id: string) => {
    const db = await initDB()
    const tx = db.transaction(LIST_STORE_NAME, 'readonly')
    const store = tx.objectStore(LIST_STORE_NAME)
    const doc = await store.get(id)
    await tx.done
    return doc?.title || '未命名新文档'
}

export const updateTitle = async (
    title: string,
    id: string
) => {
    const db = await initDB()
    const tx = db.transaction(LIST_STORE_NAME, 'readwrite')
    const store = tx.objectStore(LIST_STORE_NAME)
    const doc = await store.get(id)
    if(doc) {
        doc.title = title
        await store.put(doc)
    }
    await tx.done
}