'use client'

import React from 'react'
import Modal from '../Modal'
import styles from './LoginModal.module.scss'
import { LoginButton } from '@/components/AuthButton/AuthButton'

interface LoginModalProps {
    isOpen: boolean
    closeFn: () => void
}

const LoginModal = ({ isOpen, closeFn }: LoginModalProps) => {
    return (
        <Modal isOpen={isOpen} closeFn={closeFn} shadow>
            <div className={styles.container}>
                <div className={styles.header}>
                    <h2 className={styles.title}>登录</h2>
                    <p className={styles.subtitle}>登录后可体验实时多人编辑功能</p>
                </div>
                <div className={styles.content}>
                    <div className={styles.icon}>🔐</div>
                    <p className={styles.description}>
                        登录以访问您的文档和协作功能
                    </p>
                    <div className={styles.authButton}>
                        <LoginButton />
                    </div>
                </div>
            </div>
        </Modal>
    )
}

export default LoginModal
