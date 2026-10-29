'use client'

import classNames from "classnames"
import styles from './page.module.scss'
import DocItem from "@/components/DocItem/DocItem"
import { addData } from "@/utils/storage/db"
import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import useListStore from "@/app/store/useListStore"
import { Search, FolderOpen, Loader2, Plus, X } from "lucide-react"
import { nanoid } from "nanoid"
import Modal from "@/components/Modal/Modal"
import { useUserStore } from "@/app/store/useUserStore"
import dynamic from "next/dynamic"
import { toast } from "@/components/Toast"
const DynamicLoginModal = dynamic(() => import("@/components/Modal/LoginModal/LoginModal"), {
    ssr: false
})

const AllPage = () => {
    const { dataList } = useListStore(state => state)
    const isLoading = useListStore(state => state.isLoading)
    const [searchQuery, setSearchQuery] = useState('')
    const router = useRouter()
    const [isOpenModal, setIsModalOpen] = useState(false)
    const [roomId, setRoomId] = useState('')
    const [isJoining, setIsJoining] = useState(false)
    const [joinError, setJoinError] = useState('')
    const joinFormRef = useRef<HTMLFormElement>(null)
    const joinRequestRef = useRef<AbortController | null>(null)
    const closeJoinModal = useCallback(() => {
        joinRequestRef.current?.abort()
        joinRequestRef.current = null
        setIsJoining(false)
        setIsModalOpen(false)
    }, [])
    useEffect(() => () => {
        joinRequestRef.current?.abort()
        joinRequestRef.current = null
    }, [])
    useEffect(() => {
        if (!isOpenModal) return
        const previousFocus = document.activeElement
        return () => {
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
        }
    }, [isOpenModal])
    useEffect(() => {
        if (!isOpenModal) return
        joinFormRef.current?.querySelector<HTMLElement>(isJoining ? 'button:not(:disabled)' : 'input')?.focus()
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                closeJoinModal()
            }
            if (event.key !== 'Tab') return
            const elements = joinFormRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')
            if (!elements?.length) { event.preventDefault(); return }
            const first = elements[0]
            const last = elements[elements.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isOpenModal, isJoining, closeJoinModal])
    const isLogin = useUserStore(state => state.isLogin)
    // 新建文档
    const [isCreating, setIsCreating] = useState(false)
    const handleAdd = async () => {
        if (isCreating) return
        setIsCreating(true)
        try {
            const id = nanoid()
            if(isLogin) {
                const response = await fetch('/api/documents', {
                    method: "POST",
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        roomId: id
                    })
                })
                const result = await response.json()
                if (!response.ok || !result.success) {
                    throw new Error(result.error || '创建文档失败')
                }
            }
            await addData('未命名新文档', id)
            router.push(`/workspace/${id}`)
        }catch (err) {
            console.error("创建文档失败:", err)
            toast.show('创建文档失败，请稍后重试')
        }finally {
            setIsCreating(false)
        }
    }
    
    // 加入房间
    const [isLoginModal, setIsLoginModal] = useState(false)
    const handleJoinRoom = async () => {
        if (isJoining) return
        if(!isLogin) {
            setIsModalOpen(false)
            setIsLoginModal(true)
            return
        }
        const normalizedRoomId = roomId.trim()
        if (!normalizedRoomId) {
            setJoinError('请输入房间ID')
            return
        }
        
        setIsJoining(true)
        setJoinError('')
        const controller = new AbortController()
        joinRequestRef.current = controller
        
        try {
            // 检查房间是否存在
            const response = await fetch('/api/documents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ roomId: normalizedRoomId, checkRoom: true }),
                signal: controller.signal,
            })
            
            const result = await response.json()
            if (controller.signal.aborted) return
            
            if (response.ok && result.success) {
                // 房间存在，跳转到该房间
                await addData(result.data?.title || '未命名文档', normalizedRoomId)
                if (controller.signal.aborted) return
                setIsModalOpen(false)
                setRoomId('')
                router.push(`/workspace/${encodeURIComponent(normalizedRoomId)}`)
            } else {
                setJoinError(result.error || '房间不存在或无法访问')
            }
        } catch (err) {
            if (controller.signal.aborted) return
            console.error('加入房间失败:', err)
            toast.show('加入房间失败，请检查网络连接')
            setJoinError('加入房间失败，请检查网络连接')
        } finally {
            if (joinRequestRef.current === controller) {
                joinRequestRef.current = null
                setIsJoining(false)
            }
        }
    }
    
    // Filter list based on search query
    const filteredDataList = useMemo(() => {
        if (!searchQuery.trim()) return dataList
        return dataList.map(group => ({
            ...group,
            dataList: group.dataList.filter(item => 
                (item.title || '未命名文档').toLowerCase().includes(searchQuery.trim().toLowerCase())
            )
        })).filter(group => group.dataList.length > 0)
    }, [dataList, searchQuery])

    const isEmpty = filteredDataList.length === 0
    const totalCount = dataList.reduce((acc, curr) => acc + curr.dataList.length, 0)
    const resultCount = filteredDataList.reduce((acc, curr) => acc + curr.dataList.length, 0)

    return (
        <div className={classNames(styles.container)}>
            {/* 顶栏控制区 */}
            <header className={classNames(styles.header)}>
                <div className={styles.headerTitle}>
                    <h1>全部文档</h1>
                    <span className={styles.count}>{isLoading ? '正在读取…' : searchQuery.trim() ? `找到 ${resultCount} / ${totalCount} 份` : `共 ${totalCount} 份`}</span>
                </div>
                
                <div className={styles.controls}>
                    {/* 搜索框 */}
                    <div className={styles.searchBar}>
                        <Search className={styles.searchIcon} size={16} />
                        <input 
                            type="search"
                            aria-label="搜索工作区文档"
                            placeholder="搜索工作区文档..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && <button type="button" className={styles.clearSearch} aria-label="清空搜索" onClick={() => setSearchQuery('')}><X size={16} aria-hidden /></button>}
                    </div>

                    {/* 新建按钮组 */}
                    <button type="button" className={styles.primaryButton} onClick={handleAdd} disabled={isCreating}>
                        {isCreating ? <Loader2 size={16} className={styles.spinner} aria-hidden /> : <Plus size={16} aria-hidden />}
                        {isCreating ? '创建中…' : '新建文档'}
                    </button>
                    <button type="button" className={styles.secondaryButton} onClick={() => {
                        setJoinError('')
                        if (!isLogin) { setIsLoginModal(true); return }
                        setIsModalOpen(true)
                    }}>加入房间</button>
                    <Modal isOpen={isOpenModal} closeFn={closeJoinModal} shadow={true}>
                        <form ref={joinFormRef} role="dialog" aria-modal="true" aria-labelledby="join-room-heading" className={styles.joinRoomModal} onSubmit={event => { event.preventDefault(); void handleJoinRoom() }}>
                            <div className={styles.joinRoomModalHeader}>
                                <h3 id="join-room-heading">加入协作房间</h3>
                                <p>输入协作者分享给你的房间 ID。</p>
                            </div>
                            <div className={styles.joinRoomModalBody}>
                                <div className={styles.inputGroup}>
                                    <label htmlFor="roomId">房间ID</label>
                                    <input
                                        type="text"
                                        id="roomId"
                                        disabled={isJoining}
                                        aria-invalid={Boolean(joinError)}
                                        aria-describedby={joinError ? 'join-error' : undefined}
                                        value={roomId}
                                        onChange={(e) => { setRoomId(e.target.value); setJoinError('') }}
                                        placeholder="请输入房间ID"
                                        className={styles.input}
                                    />
                                    {joinError && (
                                        <span id="join-error" role="alert" className={styles.errorMessage}>{joinError}</span>
                                    )}
                                </div>
                            </div>
                            <div className={styles.joinRoomModalFooter}>
                                <button 
                                    type="button"
                                    className={styles.cancelButton}
                                    onClick={closeJoinModal}
                                >
                                    取消
                                </button>
                                <button 
                                    type="submit"
                                    className={styles.joinButton}
                                    disabled={isJoining}
                                >
                                    {isJoining ? '加入中...' : '加入'}
                                </button>
                            </div>
                        </form>
                    </Modal>
                    <DynamicLoginModal isOpen={isLoginModal} closeFn={() => setIsLoginModal(false)} />
                </div>
            </header>

            {/* 内容区 */}
            <main className={classNames(styles.main)} aria-busy={isLoading}>
                {isLoading && totalCount === 0 ? <div className={styles.emptyState} role="status"><Loader2 size={28} className={styles.spinner} aria-hidden /><p>正在读取你的文档…</p></div> : isEmpty ? (
                    <div className={styles.emptyState}>
                        <FolderOpen size={40} className={styles.emptyIcon} aria-hidden />
                        <h3>{searchQuery.trim() ? '没有找到匹配的文档' : '这里将收纳你的所有文档'}</h3>
                        <p>{searchQuery.trim() ? '试试更短的关键词，或清空搜索查看全部文档。' : '创建一份文档，也可以加入已有的协作房间。'}</p>
                        {searchQuery.trim() ? <button type="button" className={styles.secondaryButton} onClick={() => setSearchQuery('')}>清空搜索</button> : (
                            <button
                                type="button"
                                className={styles.createNowBtn}
                                onClick={handleAdd}
                                disabled={isCreating}
                            >
                                {isCreating ? '创建中…' : '立即创建'}
                            </button>
                        )}
                    </div>
                ) : (
                    filteredDataList.map(group => 
                        <div key={group.date} className={styles.group}>
                            <div className={classNames(styles.date)}>{group.date}</div>
                            <div className={styles.grid}>
                                {group.dataList.map(item => 
                                    <DocItem id={item.id} title={item.title} createDate={item.createAt} key={item.id}/>
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
