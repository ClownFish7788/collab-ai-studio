
import styles from './Item.module.scss'
import classNames from 'classnames'
import Floder from '@/svg/Floder'
import Collection from '@/svg/Collection/Collection'
import Rename from '@/svg/Rename'
import Edit from '@/svg/Edit'
import More from '@/svg/More'

interface Props {
    title: string
    isCollected: boolean
    hasEdit?: boolean
    isTag?: boolean
}

const Item = ({
    title,
    isCollected,
    hasEdit = false,
    isTag = false
}: Props) => {

    return (
        <div className={classNames(styles.item)}>
            <div className={classNames(styles.decoration)}></div>
            {
                isTag ? <div className={classNames(styles.tagPoint)}></div> : <Floder />
            }
            <div className={classNames(styles.title)}>{title}</div>
            <div className={classNames(styles.svg, styles.collection)}>
                <Collection />
            </div>
            <div className={classNames(styles.svg)}>
                <Rename />
            </div>
            {
                hasEdit &&
                <div className={classNames(styles.svg)}>
                    <Edit />
                </div> 
            }
            <div className={classNames(styles.svg)}>
                <More />
            </div>
        </div>
    )
}

export default Item