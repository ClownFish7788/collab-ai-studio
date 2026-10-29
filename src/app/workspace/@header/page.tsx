'use client'

import classNames from "classnames"
import styles from './pageHeader.module.scss'
import { usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import EdgeLessHeader from "./mode-edgeless/page"

const linkList = [
    {href: '/workspace', title: '工作区'},
    {href: '/workspace/all', title: '全部文档'},
]

const PageHeader = () => {
    const pathName = usePathname()
    const searchParams = useSearchParams()
    const mode = searchParams.get('mode')

    if(mode === 'edgeless') return <EdgeLessHeader />

    return (
        <div className={classNames(styles.container)}>
            {
                linkList.map((item, i) => {
                    const href = item.href
                    return <Link 
                        href={href}
                        key={i}
                        aria-current={href === pathName ? 'page' : undefined}
                        className={classNames(styles.item, href === pathName && styles.active)}
                    >{item.title}</Link>
                })
            }
        </div>
    )
}

export default PageHeader
