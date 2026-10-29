import styles from './DocItem.module.scss'
import { ArrowUpRight, FileText } from 'lucide-react'
import Link from 'next/link'

interface DocItemProps {
  title: string
  id: string | number
  createDate: Date
}

const DocItem = ({ title, id, createDate }: DocItemProps) => (
  <Link className={styles.container} href={`/workspace/${id}`}>
    <span className={styles.icon}><FileText size={22} aria-hidden /></span>
    <span className={styles.content}>
      <span className={styles.title}>{title || '未命名文档'}</span>
      <span className={styles.description}>文档与白板</span>
    </span>
    <time className={styles.date} dateTime={createDate.toISOString()}>创建于 {createDate.toLocaleDateString('zh-CN')}</time>
    <ArrowUpRight size={18} className={styles.openIcon} aria-hidden />
  </Link>
)

export default DocItem
