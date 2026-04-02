import classNames from 'classnames'
import styles from './Expansion.module.scss'

const Expansion = ({closeFn}: {
    closeFn: () => void
}) => {
    
    return (
        <div onClick={closeFn} className={classNames(styles.container)}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none"data-notification="false"><path fill="currentColor" fillRule="evenodd" d="M3.5 6.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zm6.75-.5h8.25a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-8.25zm-1.5 0H5.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h3.25z" clipRule="evenodd"></path>
            </svg>
        </div>
    )
}

export default Expansion