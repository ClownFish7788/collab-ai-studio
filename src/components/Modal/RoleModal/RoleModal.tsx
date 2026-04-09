import Modal from '../Modal'
import styles from './RoleModal.module.scss'

export const RoleModal = ({
    isOpen,
    closeFn,
    role,
    onInviteClick
}: {
    isOpen: boolean
    closeFn: () => void
    role: 'owner' | 'collaborator' | 'viewer' | null
    onInviteClick: () => void
}) => {
    const handleRequestAccess = () => {
        closeFn()
        // 这里可以添加请求编辑权限的逻辑
        alert('已向房主发送编辑权限请求')
    }

    return (
        <Modal isOpen={isOpen} closeFn={closeFn} shadow={true}>
            <div className={styles.roleModal}>
                <div className={styles.roleModalHeader}>
                    <h3>你的身份</h3>
                </div>
                <div className={styles.roleModalBody}>
                    <div className={styles.roleInfo}>
                        <div className={styles.roleBadge}>
                            {role === 'owner' ? '拥有者' : role === 'collaborator' ? '合作者' : role === 'viewer' ? '观众' : '未知'}
                        </div>
                        <p className={styles.roleDescription}>
                            {role === 'owner' ? '你是文档的拥有者，可以邀请好友协作，管理文档权限。' : 
                             role === 'collaborator' ? '你是文档的合作者，可以编辑文档内容。' : 
                             role === 'viewer' ? '你是文档的观众，只能查看文档内容。' : 
                             '你的身份未知。'}
                        </p>
                    </div>
                    {role === 'owner' && (
                        <div className={styles.roleAction}>
                            <p>点击下方按钮邀请好友加入协作：</p>
                            <button 
                                className={styles.actionButton}
                                onClick={onInviteClick}
                            >
                                邀请好友
                            </button>
                        </div>
                    )}
                    {role === 'viewer' && (
                        <div className={styles.roleAction}>
                            <p>你当前只能查看文档内容，需要向房主请求编辑权限。</p>
                            <button 
                                className={styles.actionButton}
                                onClick={handleRequestAccess}
                            >
                                请求编辑权限
                            </button>
                        </div>
                    )}
                </div>
                <div className={styles.roleModalFooter}>
                    <button 
                        className={styles.closeButton}
                        onClick={closeFn}
                    >
                        关闭
                    </button>
                </div>
            </div>
        </Modal>
    )
}
