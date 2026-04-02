'use client'
import classNames from 'classnames'
import styles from './Modal.module.scss'
import ReactDOM from 'react-dom'

interface Props {
    isOpen: boolean
    shadow?: boolean
    closeFn: () => void
    children: React.ReactNode
}

const Modal = ({isOpen, shadow = false, closeFn, children}: Props) => {
    if(!isOpen) return null
    return ReactDOM.createPortal(
        <div
            className={classNames(styles.overlay, shadow && styles.shadow)}
            onClick={(e) => {
                closeFn()
            }}
        >
            <div 
                className={classNames(styles.container)}
                onClick={(e) => {
                    e.stopPropagation()
                }}
            >
                {children}
            </div>
        </div>
        ,document.body
    )
}

export default Modal