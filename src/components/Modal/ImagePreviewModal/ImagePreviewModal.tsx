'use client'

import Image from 'next/image'
import { useState } from 'react'
import { X } from 'lucide-react'
import Modal from '../Modal'
import styles from './ImagePreviewModal.module.scss'

interface Props {
    image: { name: string; dataUrl: string } | null
    closeFn: () => void
}

function PreviewImage({ image }: { image: NonNullable<Props['image']> }) {
    const [failed, setFailed] = useState(false)
    return failed
        ? <p role="alert">图片加载失败，可能已失效、当前无访问权限或浏览器不支持此格式。</p>
        : <Image src={image.dataUrl} alt={image.name} fill sizes="94vw" unoptimized onError={() => setFailed(true)} />
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
                <PreviewImage key={image.dataUrl} image={image} />
            </div>
        </section>}
    </Modal>
)

export default ImagePreviewModal
