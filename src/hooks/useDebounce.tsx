'use client'

import { useRef } from "react"

const useDebounce = <T extends (...args: any[]) => any>(func: T, delay: number) => {
    const timer = useRef<null | NodeJS.Timeout>(null)
    return (...args) => {
        if(timer.current) clearTimeout(timer.current)
        timer.current = null
        timer.current = setTimeout(() => {
            func(...args)
            timer.current = null
        }, delay)
    }
}

export default useDebounce