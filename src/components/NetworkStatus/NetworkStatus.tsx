'use client'

import { useState } from 'react'
import styles from './NetworkStatus.module.scss'
import Modal from '../Modal/Modal'
import AddButton from '../AddButton/AddButton'
import useNetworkStore from '@/app/store/useNetworkStore'

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
    const changeNetworkStatus = () => {
        toggleIsOpenNetwork(!isOpenNetwork)
        closeFn()
    }
    const closeFn = () => {
        setIsOpenModal(false)
    }
    return (
        <div className={styles.container} onClick={handleClick}>
            <span className={statusObj[status].class}>●</span>
            <span>{statusObj[status].content}</span>
            <Modal isOpen={isOpenModal} closeFn={closeFn} shadow>
                <div className={styles.modal}>
                    <div className={styles.prompt}>是否{isOpenNetwork ? "关闭" : "开启"}实时编辑</div>
                    <div className={styles.btns}>
                        <AddButton msg={'确定'} handleClick={() => changeNetworkStatus()}/>
                        <AddButton msg={'取消'} handleClick={closeFn}/>
                    </div>
                </div>
            </Modal>
        </div>
    )
}