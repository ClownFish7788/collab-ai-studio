import Modal from '../Modal'
import AddButton from '../../AddButton/AddButton'
import styles from './NetworkStatusModal.module.scss'

export const NetworkStatusModal = ({
    isOpen,
    closeFn,
    isOpenNetwork,
    onToggleNetwork
}: {
    isOpen: boolean
    closeFn: () => void
    isOpenNetwork: boolean
    onToggleNetwork: () => void
}) => {
    const handleToggleNetwork = () => {
        onToggleNetwork()
        closeFn()
    }

    return (
        <Modal isOpen={isOpen} closeFn={closeFn} shadow>
            <div className={styles.modal}>
                <div className={styles.prompt}>是否{isOpenNetwork ? "关闭" : "开启"}实时编辑</div>
                <div className={styles.btns}>
                    <AddButton msg={'确定'} handleClick={handleToggleNetwork}/>
                    <AddButton msg={'取消'} handleClick={closeFn}/>
                </div>
            </div>
        </Modal>
    )
}
