'use client'

import Image from 'next/image'
import { X } from 'lucide-react'
import type { ImageAttachment } from '../../../utils/chat/images'
import styles from './ChatAttachments.module.scss'

export default function ChatAttachments({ images, onPreview, onRemove, removingDisabled = false }: {
    images?: ImageAttachment[]
    onPreview: (image: ImageAttachment, trigger: HTMLButtonElement) => void
    onRemove?: (id: string) => void
    removingDisabled?: boolean
}) {
    if (!images?.length) return null
    return <div className={styles.attachments} aria-label={onRemove ? '待发送图片' : '已发送图片'}>
        {images.map(image => <figure key={image.id} className={styles.attachment}>
            <button type="button" className={styles.thumbnail} aria-label={`放大预览 ${image.name}`} onClick={event => onPreview(image, event.currentTarget)}>
                <Image src={image.dataUrl} alt={image.name} width={onRemove ? 72 : 128} height={onRemove ? 72 : 96} unoptimized />
            </button>
            <figcaption title={image.name}>{image.name}</figcaption>
            {onRemove && <button type="button" className={styles.removeImage} aria-label={`移除图片 ${image.name}`} disabled={removingDisabled} onClick={() => onRemove(image.id)}>
                <X size={12} aria-hidden="true" />
            </button>}
        </figure>)}
    </div>
}
