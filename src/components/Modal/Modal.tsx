'use client'
import classNames from 'classnames'
import styles from './Modal.module.scss'
import ReactDOM from 'react-dom'

interface Props {
    isOpen: boolean
    shadow?: boolean
    closeFn: () => void
    children: React.ReactNode
    className?: string
    containerClassName?: string
}

const Modal = ({isOpen, shadow = false, closeFn, children, className, containerClassName}: Props) => {
    if(!isOpen) return null
    return ReactDOM.createPortal(
        <div
            className={classNames(styles.overlay, shadow && styles.shadow, className)}
            onClick={() => {
                closeFn()
            }}
        >
            <div 
                className={classNames(styles.container, containerClassName)}
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
