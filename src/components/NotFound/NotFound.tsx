'use client'

import { useState } from 'react'
import styles from './NotFound.module.scss'
import { useRouter } from 'next/navigation'
import LoginModal from '../Modal/LoginModal/LoginModal'

const NotFound = () => {
    const router = useRouter()

    const handleGoHome = () => {
        router.push('/')
    }

    const handleCreateNew = () => {
        router.push('/workspace')
    }
    const [isLoginModal, setIsLoginModal] = useState(false)

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <div className={styles.icon}>📄</div>
                <h1 className={styles.title}>文档未找到</h1>
                <p className={styles.description}>
                    本地未找到该文档，这可能是一个云端协作链接，或者文档已被删除。
                </p>
                <div className={styles.actions}>
                    <button 
                        className={styles.button}
                        onClick={handleGoHome}
                    >
                        返回首页
                    </button>
                    <button 
                        className={styles.button}
                        onClick={handleCreateNew}
                    >
                        创建新文档
                    </button>
                    <button
                        className={styles.button}
                        onClick={() => setIsLoginModal(true)}
                    >
                        登录以查看云端文档
                    </button>
                    <LoginModal isOpen={isLoginModal} closeFn={() => setIsLoginModal(false)} />
                </div>
            </div>
        </div>
    )
}

export default NotFound
