import useStyleStore, { Theme } from "@/app/store/useStyleStore"
import { useEffect, useRef, useState } from "react"


export const useTheme = () => {
    const theme = useStyleStore(state => state.theme)
    const toggleTheme = useStyleStore(state => state.toggleTheme)
    // 是否是初次渲染
    const isFirstRender = useRef(true)
    // 避免在SSR阶段渲染
    const [isMounted, setIsMounted] = useState(false)

    // 初始化theme - 立即设置主题，避免闪烁
    useEffect(() => {
        const localTheme = localStorage.getItem('theme') || 'light'
        // 直接设置document的data-theme属性，避免等待状态更新
        document.documentElement.setAttribute('data-theme', localTheme)
        if(theme !== localTheme) {
            toggleTheme(localTheme as Theme)
        }
        setIsMounted(true)
    }, [])

    // 处理主题切换
    useEffect(() => {
        if(isFirstRender.current) {
            isFirstRender.current = false
            return
        }
        if(isMounted) {
            localStorage.setItem('theme', theme)
            document.documentElement.setAttribute('data-theme', theme)
        }
    }, [theme, isMounted])

    return isMounted
}