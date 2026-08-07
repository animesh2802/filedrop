"use client"

import { useState, useCallback } from "react"
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
    speed: number        // bytes per second
    lastUpdated: number  // timestamp for speed calculation
}

export function useTransferState(fileMetadata: FileMetadata[]) {
    const [files, setFiles] = useState<Record<string, FileProgress>>({})

    // Initialise progress entries from metadata
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
        setFiles(initial)
    }, [])

    // Update a single file's progress — calculates speed automatically
    const updateFile = useCallback(
        (fileId: string, update: Partial<FileProgress>) => {
            setFiles((prev) => {
                const existing = prev[fileId]
                if (!existing) return prev

                // Calculate transfer speed in bytes/sec
                const now = Date.now()
                const elapsed = (now - existing.lastUpdated) / 1000
                const bytesDelta =
                    (update.bytesTransferred ?? existing.bytesTransferred) -
                    existing.bytesTransferred
                const speed =
                    elapsed > 0 && bytesDelta > 0
                        ? bytesDelta / elapsed
                        : existing.speed

                return {
                    ...prev,
                    [fileId]: {
                        ...existing,
                        ...update,
                        speed,
                        lastUpdated: now,
                    },
                }
            })
        },
        []
    )

    return { files, initFiles, updateFile }
}