"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { FileMetadata } from "@filedrop/shared"

export type TransferPath = "webrtc" | "tus" | null
export type TransferPhase =
    | "idle"
    | "connecting"
    | "transferring"
    | "done"
    | "error"

export interface FileProgress {
    fileId: string
    name: string
    bytesTransferred: number
    totalBytes: number
    phase: TransferPhase
    path: TransferPath
    speed: number
    lastUpdated: number
}

export function useTransferState(fileMetadata: FileMetadata[]) {
    const [files, setFiles] = useState<Record<string, FileProgress>>({})

    // Keep a ref of the latest files state for throttled updates
    const filesRef = useRef<Record<string, FileProgress>>({})

    // Throttle timer per fileId
    const throttleTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

    useEffect(() => {
        if (fileMetadata.length === 0) return
        const initial: Record<string, FileProgress> = {}
        fileMetadata.forEach((meta) => {
            initial[meta.id] = {
                fileId: meta.id,
                name: meta.name,
                bytesTransferred: 0,
                totalBytes: meta.size,
                phase: "idle",
                path: null,
                speed: 0,
                lastUpdated: Date.now(),
            }
        })
        filesRef.current = initial
        setFiles(initial)
    }, [fileMetadata])

    const updateFile = useCallback(
        (fileId: string, update: Partial<FileProgress>) => {
            // Always update the ref immediately — no throttle on ref
            // Always update the ref immediately — no throttle on ref
            const existing = filesRef.current[fileId]
            if (!existing) return

            const now = Date.now()
            const elapsed = (now - existing.lastUpdated) / 1000
            const bytesDelta =
                (update.bytesTransferred ?? existing.bytesTransferred) -
                existing.bytesTransferred
            const speed =
                elapsed > 0 && bytesDelta > 0
                    ? bytesDelta / elapsed
                    : existing.speed

            const updated = {
                ...existing,
                ...update,
                speed,
                lastUpdated: now,
            }

            filesRef.current = {
                ...filesRef.current,
                [fileId]: updated,
            }

            // For phase changes (connecting, done, error) — update immediately
            if (update.phase && update.phase !== "transferring") {
                clearTimeout(throttleTimers.current[fileId])
                delete throttleTimers.current[fileId]
                setFiles({ ...filesRef.current })
                return
            }

            // For progress updates during transfer — throttle to 200ms
            if (!throttleTimers.current[fileId]) {
                throttleTimers.current[fileId] = setTimeout(() => {
                    delete throttleTimers.current[fileId]
                    setFiles({ ...filesRef.current })
                }, 200)
            }
        },
        []
    )

    const initFiles = useCallback((metadata: FileMetadata[]) => {
        const initial: Record<string, FileProgress> = {}
        metadata.forEach((meta) => {
            initial[meta.id] = {
                fileId: meta.id,
                name: meta.name,
                bytesTransferred: 0,
                totalBytes: meta.size,
                phase: "idle",
                path: null,
                speed: 0,
                lastUpdated: Date.now(),
            }
        })
        filesRef.current = initial
        setFiles(initial)
    }, [])

    return { files, initFiles, updateFile }
}