
import classNames from 'classnames'
import styles from './tagPage.module.scss'
import AddButton from '@/components/AddButton/AddButton'
import Item from '@/components/Item/Item'

const TagPage = () => {

    return (
        <div className={classNames(styles.container)}>
            <header className={classNames(styles.header)}>
                <div>标签</div>
                <AddButton msg='新增标签' />
            </header>
            <main className={classNames(styles.main)}>
                <Item title='标签' isCollected={false} isTag={true} />
            </main>
        </div>
    )
}

export default TagPage