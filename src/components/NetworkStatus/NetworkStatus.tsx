'use client'

import { useState } from 'react'
import styles from './NetworkStatus.module.scss'
import AddButton from '../AddButton/AddButton'
import useNetworkStore from '@/app/store/useNetworkStore'
import { NetworkStatusModal } from '../Modal/NetworkStatusModal/NetworkStatusModal'

const statusObj = {
    'initial': {
        class: styles.init,
        content: '初始中...'
    },
    "connecting": {
        class: styles.connecting,
        content: '连接中...'
    },
    "connected": {
        class: styles.connected,
        content: "已连接"
    },
    "reconnecting": {
        class: styles.connecting,
        content: '重连中...'
    },
    "disconnected": {
        class: styles.disconnected,
        content: '离线模式'
    }
}

export const NetworkStatus = () => {
    const status = useNetworkStore(state => state.networkStatus)
    const {isOpenNetwork, toggleIsOpenNetwork} = useNetworkStore(state => state)
    const [isOpenModal, setIsOpenModal] = useState(false)
    const handleClick = () => {
        setIsOpenModal(pre => !pre)
    }
    const closeFn = () => {
        setIsOpenModal(false)
    }
    const handleToggleNetwork = () => {
        toggleIsOpenNetwork(!isOpenNetwork)
    }
    return (
        <div className={styles.container} onClick={handleClick}>
            <span className={statusObj[status].class}>●</span>
            <span>{statusObj[status].content}</span>
            <NetworkStatusModal 
                isOpen={isOpenModal} 
                closeFn={closeFn}
                isOpenNetwork={isOpenNetwork}
                onToggleNetwork={handleToggleNetwork}
            />
        </div>
    )
}