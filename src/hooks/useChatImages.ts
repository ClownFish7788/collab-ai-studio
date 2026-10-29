'use client'

import { useEffect, useRef, useState, type ClipboardEvent, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { MAX_IMAGES_PER_MESSAGE, readImage, type ImageAttachment } from '../utils/chat/images'

export function useChatImages({ requestRef, isClosing, setError }: {
    requestRef: RefObject<AbortController | null>
    isClosing: boolean
    setError: Dispatch<SetStateAction<string>>
}) {
    const [images, setImages] = useState<ImageAttachment[]>([])
    const [isReadingImages, setIsReadingImages] = useState(false)
    const imageReadVersionRef = useRef(0)

    useEffect(() => () => { imageReadVersionRef.current++ }, [])

    const cancelReading = () => {
        imageReadVersionRef.current++
        setIsReadingImages(false)
    }

    const addImages = async (files: File[]) => {
        if (!files.length || requestRef.current || isReadingImages || isClosing) return
        const version = ++imageReadVersionRef.current
        setIsReadingImages(true)
        setError('')
        const accepted: ImageAttachment[] = [], errors: string[] = []
        for (const file of files) {
            if (images.length + accepted.length >= MAX_IMAGES_PER_MESSAGE) {
                errors.push('每条消息最多上传 3 张图片')
                break
            }
            try {
                accepted.push(await readImage(file))
            } catch (error) {
                errors.push(error instanceof Error ? error.message : '图片读取失败')
            }
            if (version !== imageReadVersionRef.current) return
        }
        setImages(previous => [...previous, ...accepted])
        setError(errors.join('；'))
        setIsReadingImages(false)
    }

    const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
        // 聊天中的粘贴不能触发 document 上的画板粘贴监听。
        event.stopPropagation()
        const files = Array.from(event.clipboardData.items)
            // kind 只有 file / string；图片属于 file，随后由 readImage 检查 MIME 和文件头。
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file): file is File => file !== null)
        if (files.length) {
            event.preventDefault()
            void addImages(files)
        }
    }

    return { images, setImages, isReadingImages, addImages, handlePaste, cancelReading }
}
