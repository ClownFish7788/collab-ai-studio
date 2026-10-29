'use client'

import Link from "next/link"
import styles from './NavigationBar.module.scss'
import classNames from "classnames"
import { Search, FileText, Settings, House, Layers } from 'lucide-react'
import Expansion from "../Expansion/Expansion"
import useStyleStore from "@/app/store/useStyleStore"
import SearchModal from "../Modal/SearchModal/SearchModal"
import NavigationItem from "../NavigationItem/NavigationItem"
import SettingModal from "../Modal/SettingModal/SettingModal"

export interface Navigation {
    title: string
    href: string | undefined
    svg: React.ReactNode
}

const navigationList: Navigation[] = [
    {title: '工作区首页', href: '/workspace', svg: <House size={18} aria-hidden />},
    {title: '搜索文档', href: undefined, svg: <Search size={18} aria-hidden />},
    {title: '全部文档', href: '/workspace/all', svg: <FileText size={18} aria-hidden />},
    {title: '设置', href: undefined, svg: <Settings size={18} aria-hidden />}
]

const ModalType = [null, 'SEARCH', null, 'SETTINGS'] as const

const NavigationBar = () => {
    const toggleLeftBarOpen = useStyleStore(state => state.toggleLeftBarOpen)
    const toggleModalOpen = useStyleStore(state => state.toggleModalOpen)
    const { settingModalOpen, searchModalOpen } = useStyleStore(state => state)
    const closeMobileNavigation = () => {
        if (window.matchMedia('(max-width: 760px)').matches) {
            useStyleStore.setState({ leftBarOpen: false })
        }
    }

    return (
        <div className={classNames(styles.container)}>
            <div className={styles.brandRow}>
                <Link href="/workspace" className={styles.brand} onClick={closeMobileNavigation}>
                    <Layers size={24} aria-hidden /><span>CollabAI <small>Studio</small></span>
                </Link>
                <Expansion closeFn={toggleLeftBarOpen} />
            </div>
            <p className={styles.caption}>工作区</p>
            <nav aria-label="工作区导航" className={classNames(styles.navigationContainer)}>
                {
                    navigationList.map((item, i) => <NavigationItem 
                        title={item.title} 
                        svg={item.svg} 
                        href={item.href}
                        handleClick={() => {
                            toggleModalOpen(ModalType[i])
                            closeMobileNavigation()
                        }}
                        key={i}
                    />)
                }
            </nav>
            <div className={styles.footer}><span>文字与画布，让想法一起生长。</span></div>
            <SearchModal open={searchModalOpen} closeFn={() => toggleModalOpen(null)} />
            <SettingModal open={settingModalOpen} closeFn={() => toggleModalOpen(null)} />
        </div>
    )
}

export default NavigationBar
