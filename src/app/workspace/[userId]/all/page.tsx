'use client'

import classNames from "classnames"
import styles from './page.module.scss'
import DocItem from "@/components/DocItem/DocItem"
import AddButton from "@/components/AddButton/AddButton"
import { addData, getList } from "@/utils/db"
import { useEffect, useState, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import useListStore from "@/app/store/useListStore"
import { Search } from "lucide-react"
import { nanoid } from "nanoid"
import Modal from "@/components/Modal/Modal"

const AllPage = () => {
    const { dataList, addItem, initData } = useListStore(state => state)
    const [searchQuery, setSearchQuery] = useState('')
    const pathname = usePathname()
    const router = useRouter()
    const [isOpenModal, setIsModalOpen] = useState(false)
    const [roomId, setRoomId] = useState('')
    const [isJoining, setIsJoining] = useState(false)
    const [joinError, setJoinError] = useState('')

    // 新建文档
    const [isCreating, setIsCreating] = useState(false)
    const handleAdd = async () => {
        setIsCreating(true)
        try {
            const id = nanoid()
            await addData('未命名新文档', id)
            const response = await fetch('/api/documents', {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: localStorage.getItem('userId') || 'test-user',
                    roomId: id
                })
            })
            const result = await response.json()
            if(result.success) {
                router.push(pathname.slice(0, -3) + id)
            }else {
                alert("创建文档失败")
            }
        }catch (err) {
            console.error("创建文档失败:", err)
        }finally {
            setIsCreating(false)
        }
    }
    
    // 加入房间
    const handleJoinRoom = async () => {
        if (!roomId.trim()) {
            setJoinError('请输入房间ID')
            return
        }
        
        setIsJoining(true)
        setJoinError('')
        
        try {
            // 检查房间是否存在
            const response = await fetch('/api/documents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ roomId, checkRoom: true })
            })
            
            const result = await response.json()
            
            if (result.success) {
                // 房间存在，跳转到该房间
                setIsModalOpen(false)
                setRoomId('')
                const response = await fetch(`/api/title?id=${roomId}`)
                const {title} = await response.json()
                addData(title, roomId)
                router.push(pathname.slice(0, -3) + roomId)
            } else {
                setJoinError(result.error || '房间不存在或无法访问')
            }
        } catch (err) {
            console.error('加入房间失败:', err)
            setJoinError('加入房间失败，请检查网络连接')
        } finally {
            setIsJoining(false)
        }
    }

    useEffect(() => {
        const getListData = async () => {
            const data = await getList()
            if (!data) return
            
            // 排序 (最新的在前面)
            const sortedData = [...data].sort((a, b) => {
                const dateA = new Date(a.createAt).getTime()
                const dateB = new Date(b.createAt).getTime()
                return dateB - dateA
            })

            const newData = sortedData.reduce((res: any[], curr: any) => {
                const date = curr.createAt as Date
                // 确保 date 是 Date 类型
                const validDate = new Date(date)
                const dateStr = `${validDate.getFullYear()}年${validDate.getMonth() + 1}月${validDate.getDate()}日`
                
                // Fix bug: indexOf was used with callback, now using findIndex
                const index = res.findIndex(item => item.date === dateStr)
                if(index === -1) {
                    res.push({
                        date: dateStr,
                        dataList: [curr]
                    })
                }else {
                    res[index].dataList.push(curr)
                }
                return res
            }, [])
            initData(newData)
        }
        getListData()
    }, [initData])
    
    const handleNavigate = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement
        const el = target.closest("[data-id]") as HTMLElement | null
        const id = el?.dataset.id
        if (id) {
            router.push(pathname.slice(0, -3) + id)
        }
    }

    // Filter list based on search query
    const filteredDataList = useMemo(() => {
        if (!searchQuery.trim()) return dataList
        return dataList.map(group => ({
            ...group,
            dataList: group.dataList.filter(item => 
                (item.title || 'untitled').toLowerCase().includes(searchQuery.toLowerCase())
            )
        })).filter(group => group.dataList.length > 0)
    }, [dataList, searchQuery])

    const isEmpty = filteredDataList.length === 0
    const totalCount = dataList.reduce((acc, curr) => acc + curr.dataList.length, 0)

    return (
        <div className={classNames(styles.container)}>
            {/* 顶栏控制区 */}
            <header className={classNames(styles.header)}>
                <div className={styles.headerTitle}>
                    <h1>全部</h1>
                    <span className={styles.count}>共 {totalCount} 项</span>
                </div>
                
                <div className={styles.controls}>
                    {/* 搜索框 */}
                    <div className={styles.searchBar}>
                        <Search className={styles.searchIcon} size={16} />
                        <input 
                            type="text" 
                            placeholder="搜索工作区文档..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* 新建按钮组 */}
                    <AddButton msg="新建" handleClick={handleAdd} />
                    <AddButton msg="加入房间" handleClick={() => setIsModalOpen(true)} />
                    <Modal isOpen={isOpenModal} closeFn={() => setIsModalOpen(false)} shadow={true}>
                        <div className={styles.joinRoomModal}>
                            <div className={styles.joinRoomModalHeader}>
                                <h3>加入房间</h3>
                            </div>
                            <div className={styles.joinRoomModalBody}>
                                <div className={styles.inputGroup}>
                                    <label htmlFor="roomId">房间ID</label>
                                    <input
                                        type="text"
                                        id="roomId"
                                        value={roomId}
                                        onChange={(e) => setRoomId(e.target.value)}
                                        placeholder="请输入房间ID"
                                        className={styles.input}
                                    />
                                    {joinError && (
                                        <span className={styles.errorMessage}>{joinError}</span>
                                    )}
                                </div>
                            </div>
                            <div className={styles.joinRoomModalFooter}>
                                <button 
                                    className={styles.cancelButton}
                                    onClick={() => setIsModalOpen(false)}
                                >
                                    取消
                                </button>
                                <button 
                                    className={styles.joinButton}
                                    onClick={handleJoinRoom}
                                    disabled={isJoining}
                                >
                                    {isJoining ? '加入中...' : '加入'}
                                </button>
                            </div>
                        </div>
                    </Modal>
                </div>
            </header>

            {/* 内容区 */}
            <main className={classNames(styles.main)} onClick={handleNavigate}>
                {isEmpty ? (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>📂</div>
                        <h3>这里空空如也</h3>
                        <p>{searchQuery ? '没有找到符合条件的文档' : '开始创建你的第一个文档或白板吧'}</p>
                        {!searchQuery && (
                            <button className={styles.createNowBtn} onClick={handleAdd}>
                                立即创建
                            </button>
                        )}
                    </div>
                ) : (
                    filteredDataList.map(group => 
                        <div key={group.date} className={styles.group}>
                            <div className={classNames(styles.date)}>{group.date}</div>
                            <div className={styles.grid}>
                                {group.dataList.map(item => 
                                    <DocItem id={item.id} title={item.title} key={item.id}/>
                                )}
                            </div>
                        </div>
                    )
                )}
            </main>
        </div>
    )
}

export default AllPage