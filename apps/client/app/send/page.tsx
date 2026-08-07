"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSocket } from "@/lib/useSocket"
import { useWebRTC } from "@/lib/useWebRTC"
import { useTransferState } from "@/lib/useTransferState"
import { FileProgressCard } from "@/components/FileProgressCard"
import { uploadFileViaTus } from "@/lib/transferTus"
import { cleanOldUploads } from "@/lib/db"
import type { FileMetadata } from "@filedrop/shared"

export default function SendPage() {
    const { socket, isConnected } = useSocket()
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const [roomCode, setRoomCode] = useState<string | null>(null)
    const [isCreatingRoom, setIsCreatingRoom] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [fileMetadata, setFileMetadata] = useState<FileMetadata[]>([])
    const [sessionPhase, setSessionPhase] = useState<
        "setup" | "waiting" | "transferring" | "done"
    >("setup")

    const selectedFilesRef = useRef<File[]>([])
    const fileMetadataRef = useRef<FileMetadata[]>([])

    useEffect(() => { selectedFilesRef.current = selectedFiles }, [selectedFiles])
    useEffect(() => { fileMetadataRef.current = fileMetadata }, [fileMetadata])

    const { files: fileProgress, initFiles, updateFile } = useTransferState(fileMetadata)

    const { connectionState, startAsSender } = useWebRTC("sender", {
        onChunkSent: (fileId, bytes) => {
            updateFile(fileId, {
                bytesTransferred: bytes,
                phase: "transferring",
                path: "webrtc",
            })
        },
        onFileComplete: (fileId) => {
            updateFile(fileId, { phase: "done" })
            // Check if all files are done
            const allDone = Object.values(fileProgress).every(
                (f) => f.fileId === fileId || f.phase === "done"
            )
            if (allDone) setSessionPhase("done")
        },
    })

    useEffect(() => { cleanOldUploads() }, [])

    useEffect(() => {
        function onRoomCreated({ code }: { code: string; expiresAt: number }) {
            setRoomCode(code)
            setIsCreatingRoom(false)
            setSessionPhase("waiting")
        }

        function onRoomError({ message }: { message: string }) {
            setErrorMessage(message)
            setIsCreatingRoom(false)
        }

        function onReceiverJoined() {
            setSessionPhase("transferring")
            fileMetadataRef.current.forEach((meta) => {
                updateFile(meta.id, { phase: "connecting", path: "webrtc" })
            })
            startAsSender(selectedFilesRef.current, fileMetadataRef.current)
        }

        // Switch to Tus when server signals fallback
        function onUseTus({ fileId, resumeFromByte }: {
            fileId: string
            resumeFromByte: number
            uploadUrl: string
        }) {
            const metaIndex = fileMetadataRef.current.findIndex((m) => m.id === fileId)
            if (metaIndex === -1) return
            const file = selectedFilesRef.current[metaIndex]
            if (!file) return

            updateFile(fileId, { phase: "transferring", path: "tus" })

            uploadFileViaTus(
                file,
                fileId,
                resumeFromByte,
                (bytes, total) => {
                    updateFile(fileId, { bytesTransferred: bytes, totalBytes: total })
                },
                (_downloadUrl) => {
                    updateFile(fileId, { phase: "done" })
                    socket.emit("transfer:complete", { fileId })
                },
                (_err) => {
                    updateFile(fileId, { phase: "error" })
                }
            )
        }

        socket.on("room:created", onRoomCreated)
        socket.on("room:error", onRoomError)
        socket.on("room:receiver-joined", onReceiverJoined)
        socket.on("transfer:use-tus", onUseTus)

        return () => {
            socket.off("room:created", onRoomCreated)
            socket.off("room:error", onRoomError)
            socket.off("room:receiver-joined", onReceiverJoined)
            socket.off("transfer:use-tus", onUseTus)
        }
    }, [socket, startAsSender, updateFile])

    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        if (!e.target.files) return
        const files = Array.from(e.target.files)
        setSelectedFiles(files)
    }

    function handleCreateRoom() {
        if (selectedFiles.length === 0) return
        setIsCreatingRoom(true)
        setErrorMessage(null)

        const metadata: FileMetadata[] = selectedFiles.map((file, index) => ({
            id: `f_${index}_${Date.now()}`,
            name: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream",
        }))

        setFileMetadata(metadata)
        initFiles(metadata)
        socket.emit("room:create", { files: metadata })
    }

    return (
        <main className="flex flex-col items-center justify-center min-h-screen p-8 gap-6">
            <h1 className="text-2xl font-bold">Send files</h1>

            <p className="text-sm text-gray-500">
                {isConnected ? "🟢 Connected" : "🔴 Connecting..."}
            </p>

            {errorMessage && (
                <p className="text-sm text-red-500">{errorMessage}</p>
            )}

            {sessionPhase === "setup" && (
                <>
                    <input
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        className="text-sm"
                    />
                    {selectedFiles.length > 0 && (
                        <ul className="text-sm text-gray-400">
                            {selectedFiles.map((f) => (
                                <li key={f.name}>
                                    {f.name} — {(f.size / 1024 / 1024).toFixed(2)} MB
                                </li>
                            ))}
                        </ul>
                    )}
                    <button
                        onClick={handleCreateRoom}
                        disabled={selectedFiles.length === 0 || isCreatingRoom}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
                    >
                        {isCreatingRoom ? "Creating room..." : "Create room"}
                    </button>
                </>
            )}

            {sessionPhase === "waiting" && roomCode && (
                <div className="text-center">
                    <p className="text-gray-400 mb-2">Share this code with the receiver:</p>
                    <p className="text-4xl font-mono font-bold tracking-widest bg-gray-900 px-6 py-4 rounded-lg">
                        {roomCode}
                    </p>
                    <p className="text-xs text-gray-600 mt-3">Waiting for receiver to join...</p>
                </div>
            )}

            {(sessionPhase === "transferring" || sessionPhase === "done") && (
                <div className="flex flex-col items-center gap-4 w-full max-w-md">
                    <p className="text-sm text-gray-400">
                        {sessionPhase === "done" ? "All transfers complete" : `WebRTC: ${connectionState}`}
                    </p>
                    {Object.values(fileProgress).map((fp) => (
                        <FileProgressCard key={fp.fileId} file={fp} />
                    ))}
                    {sessionPhase === "done" && (
                        <button
                            onClick={() => {
                                setSessionPhase("setup")
                                setSelectedFiles([])
                                setFileMetadata([])
                                setRoomCode(null)
                            }}
                            className="mt-4 px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors"
                        >
                            Send more files
                        </button>
                    )}
                </div>
            )}
        </main>
    )
}