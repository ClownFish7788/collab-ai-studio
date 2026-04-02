import { useEffect } from "react"
import { AssetRecordType, Editor, createShapeId } from "tldraw"

type GetImageSize = (src: string) => Promise<{width: number, height: number}>

const getImageSize:GetImageSize = (src) => {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const clearFn = () => {
            img.onload = null
            img.onerror = null
            img.src = ''
        }
        img.onload = () => {
            resolve({
                width: img.width,
                height: img.height
            })
            clearFn()
        }
        img.onerror = (err) => {
            reject(new Error(`Failed to load image from: ${src}`))
            console.error(err)
            clearFn()
        }

        img.src = src
    })
}

export const usePasteImageToTldraw = (editor: Editor | null) => {
    useEffect(() => {
        if(!editor) return
        const handlePaste = async (e: ClipboardEvent) => {
            let w = 400, h = 400
            const items = e.clipboardData?.items
            const text = e.clipboardData?.getData('text')
            // 复制的是网络图片地址
            if (text && text.match(/^https?:\/\/.*\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i)) {
                e.preventDefault()
                e.stopImmediatePropagation()
                try {
                    const {width, height} = await getImageSize(text)
                    w = width
                    h = height
                    const assetId = AssetRecordType.createId()

                    editor.createAssets([{
                        id: assetId,
                        type: 'image',
                        typeName: 'asset',
                        props: {
                            name: 'pasted-url-image',
                            src: text, // 直接使用网络地址
                            w, h,
                            mimeType: 'image/png', // 默认给定一个类型
                            isAnimated: false,
                        },
                        meta: {}
                    }])

                    // 获取鼠标坐标
                    const {x, y} = editor.inputs.getCurrentPagePoint()
                    editor.createShapes([{
                        id: createShapeId(),
                        type: 'image',
                        x: x - w / 2, // 居中显示
                        y: y - h / 2,
                        props: { assetId, w, h },
                    }])
                } catch (err) {
                    console.error(err)
                }
                return
            }
            // 复制的是图片
            if(items) {
                for(const item of items) {
                    if(item.type.indexOf('image') === 0) {
                        e.preventDefault()
                        e.stopImmediatePropagation()
                        const file = item.getAsFile()
                        if(!file) continue

                        // 将图片转换为Base64编码
                        const reader = new FileReader()
                        reader.onload = async (event) => {
                            const base64Src = event.target?.result as string
                            try {
                                const {width, height} = await getImageSize(base64Src)
                                w = width
                                h = height
                                const assetId = AssetRecordType.createId()

                                editor.createAssets([{
                                    id: assetId,
                                    type: 'image',
                                    typeName: 'asset',
                                    props: {
                                        name: file.name || 'pasted-image',
                                        src: base64Src, // 使用 Base64 数据
                                        w, h,
                                        mimeType: file.type,
                                        isAnimated: false
                                    },
                                    meta: {}
                                }])

                                const { x, y } = editor.inputs.getCurrentPagePoint()
                                editor.createShapes([{
                                    id: createShapeId(),
                                    type: 'image',
                                    x: x - w / 2,
                                    y: y - h / 2,
                                    props: { assetId, w, h }
                                }])
                            }catch (err) {
                                console.error(err)
                            }
                        }
                        reader.readAsDataURL(file)
                        break
                    }
                }
            }
        }
        document.addEventListener('paste', handlePaste)
        return () => {
            document.removeEventListener('paste', handlePaste)
        }
    }, [editor])
}