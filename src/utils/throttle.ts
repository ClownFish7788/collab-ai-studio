type ThrottleFunction = <T>(fn: () => T, delay: number) => T | null

export const throttle: ThrottleFunction = (fn, delay) => {
    let res = null, timer = null
    if(timer) return null
    timer = setTimeout(() => {
        res = fn()
        timer = null
    }, delay)
    return res
}