
import styles from './AddButton.module.scss'
import classNames from 'classnames'

interface Props {
    msg: string,
    handleClick?: () => void
}

const AddButton = ({ msg, handleClick }: Props) => {
    return (
        <div className={classNames(styles.add)}>
            <button className={classNames(styles.btn)} onClick={handleClick}>
                <span>{msg}</span>
            </button>
        </div>
    )
}

export default AddButton