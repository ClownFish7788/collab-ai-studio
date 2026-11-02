import { isTraceImageUrl, splitTraceImageUrls } from '@/utils/agent-traces/images'
import styles from './page.module.scss'

export type PreviewTraceImage = (url: string, trigger: HTMLButtonElement) => void

export default function TraceJson({ text, onPreview }: { text: string; onPreview: PreviewTraceImage }) {
    return <pre>{splitTraceImageUrls(text).map((part, index) => isTraceImageUrl(part)
        ? <span key={index}>{part}<button type="button" className={styles.imagePreviewButton} onClick={event => onPreview(part, event.currentTarget)}>预览图片</button></span>
        : part)}</pre>
}
