'use client'

import { useRef } from "react"

const useDebounce = (func: (...args: any[]) => any, delay: number) => {
    const timer = useRef<number | null>(null)
    
    return (...args: any[]) => {
        if (timer.current !== null) {
            clearTimeout(timer.current)
        }
        timer.current = setTimeout(() => {
            func(...args)
        }, delay)
    }
}

export default useDebounce