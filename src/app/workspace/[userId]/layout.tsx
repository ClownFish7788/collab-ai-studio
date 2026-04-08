'use client'

import NavigationBar from "@/components/NavigationBar/NavigationBar"
import styles from './workspaceLayout.module.scss'
import classNames from "classnames"
import useStyleStore from "@/app/store/useStyleStore"
import Expansion from "@/components/Expansion/Expansion"
import { useTheme } from "@/hooks/useTheme"
import { useEffect } from "react"
import { useParams } from "next/navigation"

const WorkspaceLayout = ({children, header}: {
    children: React.ReactNode
    header: React.ReactNode
}) => {
    const leftBarOpen = useStyleStore(state => state.leftBarOpen)
    const toggleLeftBarOpen = useStyleStore(state => state.toggleLeftBarOpen)
    const isMounted = useTheme()
    // 重置用户信息
    const resolveParams = useParams()
    useEffect(() => {
        localStorage.setItem('userId', resolveParams.userId as string)
        localStorage.setItem('userName', `用户_${resolveParams.userId?.slice(0,6)}`)
    }, [resolveParams.userId])
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