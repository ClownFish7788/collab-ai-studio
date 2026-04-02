'use client'

import Link from "next/link"
import styles from './NavigationBar.module.scss'
import classNames from "classnames"
import Search from "../../svg/Search"
import Docs from "../../svg/Docs"
import Setting from "../../svg/Setting"
import Expansion from "../Expansion/Expansion"
import useStyleStore from "@/app/store/useStyleStore"
import { useState } from "react"
import SearchModal from "../Modal/SearchModal/SearchModal"
import NavigationItem from "../NavigationItem/NavigationItem"
import SettingModal from "../Modal/SettingModal/SettingModal"
import { useParams } from "next/navigation"

export interface Navigation {
    title: string
    href: string | undefined
    svg: React.ReactNode
}

const navigationList: Navigation[] = [
    {title: 'search', href: undefined, svg: <Search />},
    {title: 'All docs', href: '/all', svg: <Docs />},
    {title: 'Settings', href: undefined, svg: <Setting />}
]

const ModalType = ['SEARCH', null, 'SETTINGS'] as const

const NavigationBar = () => {
    const toggleLeftBarOpen = useStyleStore(state => state.toggleLeftBarOpen)
    const params = useParams()
    const toggleModalOpen = useStyleStore(state => state.toggleModalOpen)
    const { settingModalOpen, searchModalOpen } = useStyleStore(state => state)

    return (
        <div className={classNames(styles.container)}>
            <Expansion closeFn={toggleLeftBarOpen} />
            <Link href={`/workspace/${params.userId}`} className={classNames(styles.item)}>Demo Workspace</Link>
            <div className={classNames(styles.navigationContainer)}>
                {
                    navigationList.map((item, i) => <NavigationItem 
                        title={item.title} 
                        svg={item.svg} 
                        href={item.href && `/workspace/${params.userId}/${item.href}`}
                        handleClick={() => toggleModalOpen(ModalType[i])}
                        key={i}
                    />)
                }
            </div>
            <SearchModal open={searchModalOpen} closeFn={() => toggleModalOpen(null)} />
            <SettingModal open={settingModalOpen} closeFn={() => toggleModalOpen(null)} />
        </div>
    )
}

export default NavigationBar