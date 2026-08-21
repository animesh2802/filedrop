export function throttle<T extends (...args: any[]) => void>(
    fn: T,
    ms: number
): T {
    let lastCall = 0
    return ((...args: any[]) => {
        const now = Date.now()
        if (now - lastCall >= ms) {
            lastCall = now
            fn(...args)
        }
    }) as T
}