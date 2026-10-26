'use client'

import Image from 'next/image'
import { X } from 'lucide-react'
import Modal from '../Modal'
import styles from './ImagePreviewModal.module.scss'

interface Props {
    image: { name: string; dataUrl: string } | null
    closeFn: () => void
}

const ImagePreviewModal = ({ image, closeFn }: Props) => (
    <Modal
        isOpen={image !== null}
        shadow
        closeFn={closeFn}
        className={styles.overlay}
        containerClassName={styles.container}
    >
        {image && <section
            role="dialog"
            aria-modal="true"
            aria-label={`图片预览：${image.name}`}
            onPaste={event => event.stopPropagation()}
            onKeyUp={event => event.stopPropagation()}
            onKeyDown={event => {
                event.stopPropagation()
                if (event.key === 'Escape') closeFn()
                if (event.key === 'Tab') {
                    event.preventDefault()
                    event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus()
                }
            }}
        >
            <button type="button" className={styles.close} aria-label="关闭图片预览" autoFocus onClick={closeFn}>
                <X size={22} aria-hidden="true" />
            </button>
            <div className={styles.image}>
                <Image src={image.dataUrl} alt={image.name} fill sizes="94vw" unoptimized />
            </div>
        </section>}
    </Modal>
)

export default ImagePreviewModal
