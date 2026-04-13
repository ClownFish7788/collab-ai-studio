'use client'

import styles from './NotFound.module.scss'
import { useRouter } from 'next/navigation'

const NotFound = () => {
    const router = useRouter()

    const handleGoHome = () => {
        router.push('/')
    }

    const handleCreateNew = () => {
        router.push('/workspace')
    }

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
                </div>
            </div>
        </div>
    )
}

export default NotFound
