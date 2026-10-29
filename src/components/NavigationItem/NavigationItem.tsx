'use client'
import classNames from 'classnames'
import styles from './NavigationItem.module.scss'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
    const pathname = usePathname()
    if(href) {
        return (
            <Link href={href} onClick={handleClick} aria-current={pathname === href ? 'page' : undefined} className={classNames(styles.container, pathname === href && styles.active)}>
                {svg}
                <div>{title}</div>
            </Link>
        )
    }
    return (
        <button type="button" className={classNames(styles.container)} onClick={handleClick}>
            {svg}
            <div>{title}</div>
        </button>
    )
}

export default NavigationItem
