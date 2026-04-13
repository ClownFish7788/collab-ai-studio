'use client'

import NavigationBar from "@/components/NavigationBar/NavigationBar"
import styles from './workspaceLayout.module.scss'
import classNames from "classnames"
import useStyleStore from "@/app/store/useStyleStore"
import Expansion from "@/components/Expansion/Expansion"
import { useTheme } from "@/hooks/useTheme"
import { Provider } from "@/components/provider/Provider"
import { AuthSync } from "@/components/AuthSync/AuthSync"

const WorkspaceLayout = ({children, header}: {
    children: React.ReactNode
    header: React.ReactNode
}) => {
    const leftBarOpen = useStyleStore(state => state.leftBarOpen)
    const toggleLeftBarOpen = useStyleStore(state => state.toggleLeftBarOpen)
    const isMounted = useTheme()
    if(!isMounted) {
        return null
    }
    return (
        <Provider>
            <AuthSync />
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
        </Provider>
    )
}

export default WorkspaceLayout