'use client'

import NavigationBar from "@/components/NavigationBar/NavigationBar"
import styles from './workspaceLayout.module.scss'
import classNames from "classnames"
import useStyleStore from "@/app/store/useStyleStore"
import Expansion from "@/components/Expansion/Expansion"
import { useTheme } from "@/hooks/useTheme"
import { useEffect } from "react"
import { nanoid } from "nanoid"

const WorkspaceLayout = ({children, header}: {
    children: React.ReactNode
    header: React.ReactNode
}) => {
    const leftBarOpen = useStyleStore(state => state.leftBarOpen)
    const toggleLeftBarOpen = useStyleStore(state => state.toggleLeftBarOpen)
    const isMounted = useTheme()
    // 查看用户是否注册
    useEffect(() => {
        const userId = localStorage.getItem('userId')
        const userName = localStorage.getItem('userName')
        if(!userId || !userName) {
            const id = `${nanoid()}`
            const name = `用户-${id.slice(0, 4)}`
            localStorage.setItem('userId', id)
            localStorage.setItem('userName', name)
        }
    }, [])
    if(!isMounted) {
        return null
    }
    return (
        <div className={classNames(styles.container, !leftBarOpen && styles.close)}>
            <div className={classNames(styles.slot)}>
                <aside className={classNames(styles.aside)}>
                    <NavigationBar />
                </aside>
            </div>
            <main className={classNames(styles.main)}>
                <header className={classNames(styles.header)}>
                    {
                        !leftBarOpen && <Expansion closeFn={toggleLeftBarOpen} />
                    }
                    {header}
                </header>
                {children}
            </main>
        </div>
    )
}

export default WorkspaceLayout