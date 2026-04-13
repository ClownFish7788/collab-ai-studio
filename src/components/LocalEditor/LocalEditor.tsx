'use client'
import AddButton from '../AddButton/AddButton'
import styles from './LocalEditor.module.scss'
import classNames from 'classnames'
import { NetworkStatus } from '../NetworkStatus/NetworkStatus'
import { InviteModal } from '../Modal/InviteModal/InviteModal'
import { RoleModal } from '../Modal/RoleModal/RoleModal'
import Editor from '../Editor/Editor'
import DrawEditor from '../DrawEditor/DrawEditor'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import useEditorStore from '@/app/store/useEditorStore'
import { checkAndClearStorageLRU, updateDocumentAccessTime } from '@/utils/storageManager'
import { useUserStore } from '@/app/store/useUserStore'

export const LocalEditor = () => {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false)
    const [hasTldrawInitialized, setHasTldrawInitialized] = useState(false)
    const params = useParams<{workId: string}>()
    const role = useEditorStore(state => state.role)
    const searchParams = useSearchParams()
    const mode = searchParams.get('mode')
    // 根据 mode 切换文档模式
    useEffect(() => {
        if(mode === 'edgeless') {
            setHasTldrawInitialized(true)
        }
    }, [mode])
    // 切换zustand的数据
    const toggleId = useEditorStore(state => state.toggleId)
    useEffect(() => {
        if(params.workId) {
            toggleId(params.workId)
        }
    }, [params.workId, toggleId])
    // 检查indexedDB内存
    useEffect(() => {
        updateDocumentAccessTime(params.workId)
        checkAndClearStorageLRU(params.workId)
    }, [params.workId])
    // 检查是否登录
    const isLogin = useUserStore(state => state.isLogin)
    return (
            <div className={styles.wrapper}>
                <div className={styles.status}>
                    <div className={styles.statusLeft}>
                        <AddButton msg="邀请好友" handleClick={() => setIsModalOpen(true)} />
                    </div>
                    <div className={styles.statusCenter}>
                        <div 
                            className={classNames(styles.roleBadge, styles[`role${role?.charAt(0).toUpperCase() + role?.slice(1)}`])}
                            onClick={() => setIsRoleModalOpen(true)}
                        >
                            {role === 'owner' ? '拥有者' : role === 'collaborator' ? '合作者' : role === 'viewer' ? '观众' : '未知'}
                        </div>
                    </div>
                    <div className={styles.statusRight}>
                        {isLogin && <NetworkStatus />}
                    </div>
                    <InviteModal workId={params.workId} isOpen={isModalOpen} closeFn={() => setIsModalOpen(false)} />
                    <RoleModal 
                        isOpen={isRoleModalOpen} 
                        closeFn={() => setIsRoleModalOpen(false)}
                        role={role}
                        onInviteClick={() => {
                            setIsRoleModalOpen(false)
                            setIsModalOpen(true)
                        }}
                    />
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
    )
}