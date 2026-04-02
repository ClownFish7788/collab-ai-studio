
import Switch from '@/components/Switch/Switch'
import styles from './EditorHeader.module.scss'
import classNames from 'classnames'

const EditorHeader = () => {

    return (
        <div className={classNames(styles.container)}>
            <Switch />
        </div>
    )
}

export default EditorHeader