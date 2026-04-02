'use client'

import Editor from "@/components/Editor/Editor"
import classNames from "classnames"
import React, { useEffect, useState } from "react"
import styles from './page.module.scss'
import useEditorStore from "@/app/store/useEditorStore"
import { useSearchParams } from "next/navigation"
import DrawEditor from "@/components/DrawEditor/DrawEditor"
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react"
import { NetworkStatus } from "@/components/NetworkStatus/NetworkStatus"
import { checkAndClearStorageLRU, updateDocumentAccessTime } from "@/utils/storageManger"
import AddButton from "@/components/AddButton/AddButton"
import Modal from "@/components/Modal/Modal"

const EditorPage = ({
    params
}: {
    params: Promise<{ workId: string }>
}) => {
    const resolvedParams = React.use(params)
    const searchParams = useSearchParams()
    const mode = searchParams.get('mode')
    const [hasTldrawInitialized, setHasTldrawInitialized] = useState(false)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [inviteeId, setInviteeId] = useState('')
    const [showCopySuccess, setShowCopySuccess] = useState(false)
    const [showRoomCopySuccess, setShowRoomCopySuccess] = useState(false)
    const [isInviting, setIsInviting] = useState(false)
    const [inviteError, setInviteError] = useState('')
    
    useEffect(() => {
        if(mode === 'edgeless' && !hasTldrawInitialized) {
            setHasTldrawInitialized(true)
        }
    }, [mode, hasTldrawInitialized])
    
    const { toggleId } = useEditorStore(state => state)
    
    useEffect(() => {
        if(resolvedParams.workId) {
            toggleId(resolvedParams.workId)
        }
    }, [resolvedParams, toggleId])
    
    // 检查indexeddb是否还存在内存
    useEffect(() => {
        // LRU检查是否剩余内存过小
        updateDocumentAccessTime(resolvedParams.workId)
        checkAndClearStorageLRU(resolvedParams.workId)
    }, [resolvedParams.workId])
    
    // 复制自己的用户ID
    const handleCopyId = async () => {
        const userId = localStorage.getItem('userId') || 'test-user'
        try {
            await navigator.clipboard.writeText(userId)
            setShowCopySuccess(true)
            setTimeout(() => setShowCopySuccess(false), 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }
    
    // 复制房间ID
    const handleCopyRoomId = async () => {
        try {
            await navigator.clipboard.writeText(resolvedParams.workId)
            setShowRoomCopySuccess(true)
            setTimeout(() => setShowRoomCopySuccess(false), 2000)
        } catch (err) {
            console.error('复制房间ID失败:', err)
        }
    }
    
    // 邀请好友
    const handleInvite = async () => {
        if (!inviteeId.trim()) {
            setInviteError('请输入好友的用户ID')
            return
        }
        
        setIsInviting(true)
        setInviteError('')
        
        try {
            const response = await fetch('/api/collaborators', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    documentId: resolvedParams.workId,
                    userId: inviteeId
                })
            })
            
            const result = await response.json()
            
            if (result.success) {
                alert('邀请成功！')
                setIsModalOpen(false)
                setInviteeId('')
            } else {
                setInviteError(result.error || '邀请失败，请重试')
            }
        } catch (err) {
            console.error('邀请失败:', err)
            setInviteError('邀请失败，请检查网络连接')
        } finally {
            setIsInviting(false)
        }
    }
    
    return (
        <LiveblocksProvider
            authEndpoint={async (room) => {
                const userId = localStorage.getItem('userId') || 'test-user'
                const userName = localStorage.getItem('userName') || '测试用户'
                const response = await fetch('/api/liveblocks-auth', {
                    method: "POST",
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        user: {
                            id: userId,
                            name: userName
                        },
                        room
                    })
                })
                const data = await response.json()
                return data
            }}
            // publicApiKey={publicApiKey}
        >
            <RoomProvider id={resolvedParams.workId}>
                <div className={styles.wrapper}>
                    <div className={styles.status}>
                        <AddButton msg="邀请好友" handleClick={() => setIsModalOpen(true)} />
                        <NetworkStatus />
                        <Modal isOpen={isModalOpen} closeFn={() => setIsModalOpen(false)} shadow={true}>
                            <div className={styles.inviteModal}>
                                <div className={styles.inviteModalHeader}>
                                    <h3>邀请好友</h3>
                                    <div className={styles.copyIdSection}>
                                        <span className={styles.copyIdLabel}>我的ID:</span>
                                        <div className={styles.copyIdContainer}>
                                            <span className={styles.userId}>{localStorage.getItem('userId') || 'test-user'}</span>
                                            <button 
                                                className={styles.copyButton}
                                                onClick={handleCopyId}
                                                title="复制ID"
                                            >
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                </svg>
                                            </button>
                                            {showCopySuccess && (
                                                <span className={styles.copySuccess}>已复制！</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className={styles.copyIdSection}>
                                        <span className={styles.copyIdLabel}>房间ID:</span>
                                        <div className={styles.copyIdContainer}>
                                            <span className={styles.userId}>{resolvedParams.workId}</span>
                                            <button 
                                                className={styles.copyButton}
                                                onClick={handleCopyRoomId}
                                                title="复制房间ID"
                                            >
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                </svg>
                                            </button>
                                            {showRoomCopySuccess && (
                                                <span className={styles.copySuccess}>已复制！</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className={styles.inviteModalBody}>
                                    <div className={styles.inputGroup}>
                                        <label htmlFor="inviteeId">好友ID</label>
                                        <input
                                            type="text"
                                            id="inviteeId"
                                            value={inviteeId}
                                            onChange={(e) => setInviteeId(e.target.value)}
                                            placeholder="请输入好友的用户ID"
                                            className={styles.input}
                                        />
                                        {inviteError && (
                                            <span className={styles.errorMessage}>{inviteError}</span>
                                        )}
                                    </div>
                                </div>
                                <div className={styles.inviteModalFooter}>
                                    <button 
                                        className={styles.cancelButton}
                                        onClick={() => setIsModalOpen(false)}
                                    >
                                        取消
                                    </button>
                                    <button 
                                        className={styles.inviteButton}
                                        onClick={handleInvite}
                                        disabled={isInviting}
                                    >
                                        {isInviting ? '邀请中...' : '发送邀请'}
                                    </button>
                                </div>
                            </div>
                        </Modal>
                    </div>
                    <div className={classNames(styles.container)}>
                        <div className={classNames(styles.tiptap, styles.editor, mode !== 'edgeless' && styles.active)}>
                            <Editor />
                        </div>
                        {
                            hasTldrawInitialized &&
                            <div className={classNames(styles.tldraw, styles.editor, mode === 'edgeless' && styles.active)}>
                                <DrawEditor />
                            </div>
                        }
                    </div>
                </div>
            </RoomProvider>
        </LiveblocksProvider>
    )
}

export default EditorPage