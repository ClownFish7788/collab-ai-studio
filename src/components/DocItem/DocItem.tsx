
import styles from './DocItem.module.scss'
import Doc from '@/svg/Doc'
import Collection from '@/svg/Collection/Collection'
import { useMemo } from 'react'

interface DocItemProps {
  title: string
  id: string | number
  lastModifiedDate: Date
  createDate: Date
}

const DocItem = ({ title, id, lastModifiedDate, createDate }: DocItemProps) => {
  const calcTime = (lastModifiedDate: Date) => {
    const now = new Date()
    const timeDefference = Math.floor((now.getTime() - lastModifiedDate.getTime()) / 60 / 60 / 24 / 1000)
    if(timeDefference < 1) {
      return '今天'
    }else if(timeDefference < 7) {
      return `${timeDefference}天前`
    } else if(timeDefference < 30) {
      return `${Math.floor(timeDefference / 7)}周前`
    } else if (timeDefference < 365) {
      return `${Math.floor(timeDefference / 30)}月前`
    } else {
      return `${Math.floor(timeDefference / 365)}年前`
    }
  }
  const lastModified = useMemo(() => {
    return calcTime(lastModifiedDate)
  }, [lastModifiedDate])
  const createAt = useMemo(() => {
    return calcTime(createDate)
  }, [createDate])
  return (
    <div className={styles.container} data-id={id}>
      <div>
        <Doc />
      </div>
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        <div className={styles.message}>message</div>
      </div>
      <div className={styles.createDate}>{createAt}</div>
      <div className={styles.lastModifiedDate}>{lastModified}</div>
      <div className={styles.collection}>
        <Collection />
      </div>
      <div className={styles.more}>more</div>
    </div>
  )
}

export default DocItem