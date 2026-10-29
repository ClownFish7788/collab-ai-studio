'use client'

import NavigationBar from "@/components/NavigationBar/NavigationBar"
import styles from './workspaceLayout.module.scss'
import classNames from "classnames"
import useStyleStore from "@/app/store/useStyleStore"
import Expansion from "@/components/Expansion/Expansion"
import { useTheme } from "@/hooks/useTheme"
import { Provider } from "@/components/provider/Provider"
import { AuthSync } from "@/components/AuthSync/AuthSync"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { useInitData } from "@/hooks/useInitData"
import { Analytics } from "@vercel/analytics/next"
import { useEffect, useRef } from "react"

const WorkspaceLayout = ({children, header}: {
    children: React.ReactNode
    header: React.ReactNode
}) => {
    const leftBarOpen = useStyleStore(state => state.leftBarOpen)
    const toggleLeftBarOpen = useStyleStore(state => state.toggleLeftBarOpen)
    const isMounted = useTheme()
    const navigationRef = useRef<HTMLDivElement>(null)
    // 数据初始化
    useInitData()
    useEffect(() => {
        const media = window.matchMedia('(max-width: 760px)')
        const closeOnMobile = () => {
            if (media.matches) useStyleStore.setState({ leftBarOpen: false })
        }
        closeOnMobile()
        media.addEventListener('change', closeOnMobile)
        return () => media.removeEventListener('change', closeOnMobile)
    }, [])
    useEffect(() => {
        if (!leftBarOpen || !window.matchMedia('(max-width: 760px)').matches) return
        navigationRef.current?.querySelector<HTMLElement>('a, button')?.focus()
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!window.matchMedia('(max-width: 760px)').matches) return
            if (event.key === 'Escape') toggleLeftBarOpen()
            if (event.key !== 'Tab') return
            const elements = navigationRef.current?.querySelectorAll<HTMLElement>('a, button')
            if (!elements?.length) return
            const first = elements[0]
            const last = elements[elements.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            const { searchModalOpen, settingModalOpen } = useStyleStore.getState()
            if (!searchModalOpen && !settingModalOpen) {
                Array.from(document.querySelectorAll<HTMLElement>('[data-navigation-toggle]'))
                    .find(element => getComputedStyle(element).visibility !== 'hidden')?.focus()
            }
        }
    }, [leftBarOpen, toggleLeftBarOpen])
    if(!isMounted) {
        return null
    }
    return (
        <>
            <Provider>
                <AuthSync />
                <SpeedInsights />
                <Analytics />
                <div className={classNames(styles.container, !leftBarOpen && styles.close)}>
                    {leftBarOpen && <button type="button" className={styles.backdrop} aria-label="收起导航" onClick={toggleLeftBarOpen} />}
                    <div ref={navigationRef} className={classNames(styles.slot)}>
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
        </>
    )
}

export default WorkspaceLayout
