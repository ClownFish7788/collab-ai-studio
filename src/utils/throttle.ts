type ThrottleFunction = <T>(fn: () => T, delay: number) => T | null

export const throttle: ThrottleFunction = (fn, delay) => {
    let res = null, timer = null, lastRes = null
    if(timer) return lastRes
    res = fn()
    lastRes = res
    timer = setTimeout(() => {
        timer = null
    }, delay)
    return res
}