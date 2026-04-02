'use client'

import classNames from "classnames"
import styles from './pageHeader.module.scss'
import { useParams, usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import EdgeLessHeader from "./mode-edgeless/page"

const linkList = [
    {href: (userId:string) => `/workspace/${userId}/all`, title: '文档'},
    {href: (userId: string) => `/workspace/${userId}/collection`, title: '精选'},
    {href: (userId: string) => `/workspace/${userId}/tag`, title: '标签'}
]

const PageHeader = () => {
    const params = useParams()
    const pathName = usePathname()
    const searchParams = useSearchParams()
    const mode = searchParams.get('mode')

    if(mode === 'edgeless') return <EdgeLessHeader />

    return (
        <div className={classNames(styles.container)}>
            {
                linkList.map((item, i) => {
                    const href = item.href(typeof params?.userId === 'string' ? params.userId : "")
                    return <Link 
                        href={href}
                        key={i}
                        className={classNames(styles.item, href === pathName && styles.active)}
                    >{item.title}</Link>
                })
            }
        </div>
    )
}

export default PageHeader