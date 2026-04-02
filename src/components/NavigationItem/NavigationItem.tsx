'use client'
import classNames from 'classnames'
import styles from './NavigationItem.module.scss'
import Link from 'next/link'

interface Props {
    title: string
    href?:string | undefined
    svg: React.ReactNode
    handleClick?: () => void
}

const NavigationItem = ({
    title, 
    svg, 
    href, 
    handleClick = () => {}
}: Props) => {
    if(href) {
        return (
            <Link href={href} className={classNames(styles.container)}>
                {svg}
                <div>{title}</div>
            </Link>
        )
    }
    return (
        <div className={classNames(styles.container)} onClick={handleClick}>
            {svg}
            <div>{title}</div>
        </div>
    )
}

export default NavigationItem