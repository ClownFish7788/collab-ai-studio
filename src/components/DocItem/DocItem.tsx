
import styles from './DocItem.module.scss'
import Doc from '@/svg/Doc'
import Collection from '@/svg/Collection/Collection'

interface DocItemProps {
  title: string
  id: string | number
}

const DocItem = ({ title, id }: DocItemProps) => {
  return (
    <div className={styles.container} data-id={id}>
      <div>
        <Doc />
      </div>
      <div className={styles.content}>
        <div className={styles.title}>{title}</div>
        <div className={styles.message}>message</div>
      </div>
      <div className={styles.createDate}>4天前</div>
      <div className={styles.lastModifiedDate}>1天前</div>
      <div className={styles.collection}>
        <Collection />
      </div>
      <div className={styles.more}>more</div>
    </div>
  )
}

export default DocItem