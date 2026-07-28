"use client"

import { useEffect, useState, useRef } from "react"
import { getSocket } from "./socket"
import { uploadFileViaTus } from "./transferTus"
import type { FileMetadata } from "@filedrop/shared"

export type TransferPath = "webrtc" | "tus" | null
export type TransferPhase = "idle" | "connecting" | "transferring" | "done" | "error"

export interface FileProgress {
    fileId: string
    name: string
    bytesTransferred: number
    totalBytes: number
    phase: TransferPhase
    path: TransferPath
}

export function useTransfer(files: File[], fileMetadata: FileMetadata[]) {
    const socket = getSocket()
    const [progress, setProgress] = useState<Record<string, FileProgress>>({})
    const filesRef = useRef(files)
    const metadataRef = useRef(fileMetadata)

    // Keep refs current
    useEffect(() => { filesRef.current = files }, [files])
    useEffect(() => { metadataRef.current = fileMetadata }, [fileMetadata])

    // Update progress for a specific file
    function updateProgress(fileId: string, update: Partial<FileProgress>) {
        setProgress(prev => ({
            ...prev,
            [fileId]: { ...prev[fileId], ...update }
        }))
    }

    // Initialize progress entries when metadata is set
    useEffect(() => {
        if (fileMetadata.length === 0) return
        const initial: Record<string, FileProgress> = {}
        fileMetadata.forEach(meta => {
            initial[meta.id] = {
                fileId: meta.id,
                name: meta.name,
                bytesTransferred: 0,
                totalBytes: meta.size,
                phase: "idle",
                path: null,
            }
        })
        setProgress(initial)
    }, [fileMetadata])

    // Listen for server telling us to switch to Tus
    useEffect(() => {
        function onUseTus({ fileId, resumeFromByte, uploadUrl }: {
            fileId: string
            resumeFromByte: number
            uploadUrl: string
        }) {
            console.log(`[transfer] switching to Tus for ${fileId}, resume from byte ${resumeFromByte}`)

            // Find the file that matches this fileId
            const metaIndex = metadataRef.current.findIndex(m => m.id === fileId)
            if (metaIndex === -1) return

            const file = filesRef.current[metaIndex]
            const meta = metadataRef.current[metaIndex]
            if (!file) return // receiver side — no file to upload

            updateProgress(fileId, { phase: "transferring", path: "tus" })

            uploadFileViaTus(
                file,
                fileId,
                resumeFromByte,
                (bytes, total) => {
                    updateProgress(fileId, { bytesTransferred: bytes, totalBytes: total })
                },
                (downloadUrl) => {
                    console.log(`[tus] upload done: ${downloadUrl}`)
                    updateProgress(fileId, { phase: "done" })
                    // Tell server the upload is done so it can notify the receiver
                    socket.emit("transfer:complete", { fileId })
                },
                (err) => {
                    console.error("[tus] error:", err)
                    updateProgress(fileId, { phase: "error" })
                }
            )
        }

        // Receiver side — server tells them where to download from
        function onTusReady({ fileId, downloadUrl }: {
            fileId: string
            downloadUrl: string
        }) {
            console.log(`[transfer] tus download ready: ${downloadUrl}`)
            updateProgress(fileId, { phase: "done" })

            // Trigger download
            const a = document.createElement("a")
            a.href = downloadUrl
            a.download = metadataRef.current.find(m => m.id === fileId)?.name ?? "download"
            document.body.appendChild(a)
            a.click()
            setTimeout(() => document.body.removeChild(a), 100)
        }

        socket.on("transfer:use-tus", onUseTus)
        socket.on("transfer:tus-ready", onTusReady)

        return () => {
            socket.off("transfer:use-tus", onUseTus)
            socket.off("transfer:tus-ready", onTusReady)
        }
    }, [socket])

    return { progress, updateProgress }
}