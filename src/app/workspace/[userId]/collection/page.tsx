'use client'
import classNames from 'classnames'
import styles from './collectionPage.module.scss'
import Item from '@/components/Item/Item'
import AddButton from '@/components/AddButton/AddButton'


const CollectionPage = () => {

    return (
        <div className={classNames(styles.container)}>
            <header className={classNames(styles.header)}>
                <div>精选</div>
                <AddButton msg='新建精选' />
            </header>
            <main className={classNames(styles.main)}>
                <Item title='title' isCollected={false} hasEdit={true} />
            </main>
        </div>
    )
}

export default CollectionPage