"use client"

import { useEffect } from "react"

export function StreamSaverInit() {
    useEffect(() => {
        if (typeof window !== "undefined") {
            import("streamsaver").then((module) => {
                module.default.mitm = "/streamsaver/mitm.html"
            })
        }
    }, [])

    return null
}