"use client"

import { useEffect } from "react"
import type { FileMetadata } from "@filedrop/shared"

const STORAGE_KEY = "filedrop_session"

export interface PersistedSession {
    roomCode: string
    role: "sender" | "receiver"
    savedAt: number
    files?: FileMetadata[]
}

// Save session to sessionStorage
// sessionStorage clears when the browser tab is closed — perfect for our use case
export function saveSession(session: PersistedSession): void {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}


//Read Session back
export function loadSession(): PersistedSession | null {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const session = JSON.parse(raw) as PersistedSession

        //discard sessions older than 2 minutes - our grace server period
        const twoMinutesAgo = Date.now() - 2 * 60 * 1000
        if (session.savedAt < twoMinutesAgo) {
            clearSession()
            return null
        }

        return session
    } catch {
        return null
    }
}

export function clearSession(): void {
    sessionStorage.removeItem(STORAGE_KEY)
}

//Hook that warns before leaving during an active session
export function useLeaveWarning(isActive: boolean): void {
    useEffect(() => {
        if (!isActive) return

        function handleBeforeUnload(e: BeforeUnloadEvent) {
            e.preventDefault()
        }

        window.addEventListener("beforeunload", handleBeforeUnload)
        return () => window.removeEventListener("beforeunload", handleBeforeUnload)
    }, [isActive])
}