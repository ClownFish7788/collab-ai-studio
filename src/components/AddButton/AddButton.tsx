import styles from './AddButton.module.scss'
import classNames from 'classnames'

interface Props {
    msg: string
    handleClick?: () => void
    disabled?: boolean
}

const AddButton = ({ msg, handleClick, disabled = false }: Props) => {
    return (
        <div className={classNames(styles.add)}>
            <button
                type="button"
                className={classNames(styles.btn)}
                onClick={handleClick}
                disabled={disabled}
            >
                <span>{msg}</span>
            </button>
        </div>
    )
}

export default AddButton