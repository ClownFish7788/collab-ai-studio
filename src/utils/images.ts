/** 每条用户消息最多携带的图片数量，选图、粘贴和服务端校验共用。 */
export const MAX_IMAGES_PER_MESSAGE = 3
/** 单张图片的原始字节数必须严格小于此值（5 × 1024² 字节）。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** 整个 HTTP 请求的传输保护上限，包含 Base64 和历史消息，不代替单张大小与数量校验。 */
export const MAX_CHAT_REQUEST_BYTES = 32 * 1024 * 1024
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic']

export type ImageAttachment = { id: string; name: string; dataUrl: string }
export type ImagePart = { type: 'image_url'; image_url: { url: string } }
export type TextPart = { type: 'text'; text: string }
export type MessageContent = string | (ImagePart | TextPart)[]

/**
 * 根据文件头识别支持的图片 MIME 类型，不依赖文件名或声明的类型。
 * @param bytes 原始图片字节；只检查前 32 字节，不执行完整图片解码。
 * @returns 识别出的 MIME 类型；无法识别时返回 `null`。
 */
function imageMime(bytes: Uint8Array): string | null {
    const head = String.fromCharCode(...bytes.slice(0, 32))
    if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png'
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
    if (head.startsWith('BM')) return 'image/bmp'
    if (head.startsWith('II*\0') || head.startsWith('MM\0*')) return 'image/tiff'
    if (head.slice(4, 8) === 'ftyp' && /heic|heix|hevc|hevx/.test(head.slice(8))) return 'image/heic'
    return null
}

/**
 * 校验千问图文消息中的 Base64 图片 Data URI，并将参数类型收窄为字符串。
 * @param value 待校验的值，例如 `data:image/png;base64,...`；不接受外部图片 URL。
 * @returns 校验通过时不返回值，也不修改输入。
 * @throws 格式不支持、Base64 不合法、文件头与 MIME 不一致，或原图不小于 5MB 时抛出错误。
 * @remarks 根据 Base64 长度和末尾填充计算原始字节数，5MB 限制针对原图，而非编码后的字符串。
 */
export function validateImageDataUrl(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 64) {
        throw new Error('图片必须小于 5MB')
    }
    const match = /^data:(image\/(?:png|jpeg|webp|bmp|tiff|heic));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
    if (!match || match[2].length % 4 !== 0) throw new Error('仅接受支持格式的 Base64 图片')
    const [, mime, base64] = match
    const size = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
    if (!size || size >= MAX_IMAGE_BYTES) throw new Error('图片必须非空且小于 5MB')
    const header = Uint8Array.from(atob(base64.slice(0, 64)), char => char.charCodeAt(0))
    if (imageMime(header) !== mime) throw new Error('图片内容与声明的格式不符')
}

/**
 * 将文件选择或剪贴板提供的图片读取为 Base64 附件，两种上传入口共用此校验。
 * @param file 浏览器提供的 File；须属于支持的图片格式，非空且严格小于 5MB。
 * @returns 包含唯一 `id`、显示名称 `name` 和完整 Base64 Data URI `dataUrl` 的附件。
 * @throws 类型不支持、文件头不匹配、文件大小不合规，或读取失败、被取消时抛出错误。
 */
export async function readImage(file: File): Promise<ImageAttachment> {
    if (!IMAGE_MIME_TYPES.includes(file.type)) throw new Error(`${file.name}：仅支持 PNG、JPEG、WebP、BMP、TIFF、HEIC 图片`)
    if (!file.size || file.size >= MAX_IMAGE_BYTES) throw new Error(`${file.name}：图片必须非空且小于 5MB`)
    if (imageMime(new Uint8Array(await file.slice(0, 32).arrayBuffer())) !== file.type) {
        throw new Error(`${file.name}：不是有效的 ${file.type} 图片`)
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'))
        reader.onerror = () => reject(new Error(`${file.name}：图片读取失败，请重试`))
        reader.onabort = () => reject(new Error('图片读取已取消'))
        reader.readAsDataURL(file)
    })
    return { id: crypto.randomUUID(), name: file.name || '粘贴的图片', dataUrl }
}

/**
 * 组装千问用户消息内容：图片块全部在前，非空文字块在后。
 * @param text 用户输入的文字；有图片时允许为空。
 * @param images 已校验的图片附件，默认无图片，每条消息最多 3 张。
 * @returns 无图时返回原文字字符串；有图时返回 `image_url` 与可选 `text` 组成的内容数组。
 * @throws 图片数量超过 3 张时抛出错误。
 */
export function toMessageContent(text: string, images: ImageAttachment[] = []): MessageContent {
    if (images.length > MAX_IMAGES_PER_MESSAGE) throw new Error('每条消息最多上传 3 张图片')
    if (!images.length) return text
    const parts: (ImagePart | TextPart)[] = images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))
    if (text.trim()) parts.push({ type: 'text', text })
    return parts
}
