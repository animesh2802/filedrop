"use client"

import { useState, useEffect, useRef } from "react"
import { useSocket } from "@/lib/useSocket"
import { useWebRTC } from "@/lib/useWebRTC"
import { useTransferState } from "@/lib/useTransferState"
import { FileProgressCard } from "@/components/FileProgressCard"
import { FileReceiver } from "@/lib/transferReceiver"
import type { Room } from "@filedrop/shared"
import JSZip from "jszip"

interface CompletedFile {
    fileId: string
    name: string
    size: number
    receiver: FileReceiver | null  // null for Tus files (downloaded via URL)
    downloadUrl?: string           // only for Tus files
}

export default function ReceivePage() {
    const { socket, isConnected } = useSocket()
    const [codeInput, setCodeInput] = useState("")
    const [room, setRoom] = useState<Room | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [isJoining, setIsJoining] = useState(false)
    const [sessionPhase, setSessionPhase] = useState<
        "setup" | "transferring" | "done"
    >("setup")
    const [completedFiles, setCompletedFiles] = useState<CompletedFile[]>([])
    const [isZipping, setIsZipping] = useState(false)

    const roomRef = useRef<Room | null>(null)
    useEffect(() => { roomRef.current = room }, [room])

    const { files: fileProgress, initFiles, updateFile } = useTransferState(
        room?.files ?? []
    )

    const { startAsReceiver } = useWebRTC("receiver", {
        onChunkSent: (fileId, bytes) => {
            updateFile(fileId, { bytesTransferred: bytes, phase: "transferring", path: "webrtc" })
        },
        onFileComplete: (fileId) => {
            updateFile(fileId, { phase: "done" })
        },
        onFileAssembled: (fileId, receiver) => {
            const meta = roomRef.current?.files.find(f => f.id === fileId)
            if (!meta) return
            setCompletedFiles(prev => [...prev, {
                fileId,
                name: meta.name,
                size: meta.size,
                receiver,
                downloadUrl: undefined,
            }])
        },
    })

    useEffect(() => {
        function onRoomJoined({ room }: { room: Room }) {
            setRoom(room)
            setIsJoining(false)
            setSessionPhase("transferring")
            initFiles(room.files)
            room.files.forEach(f =>
                updateFile(f.id, { phase: "connecting", path: "webrtc" })
            )
        }

        function onRoomError({ message }: { message: string }) {
            setErrorMessage(message)
            setIsJoining(false)
        }

        // Tus file ready — add to completed list with a URL instead of blob
        function onTusReady({ fileId, downloadUrl }: {
            fileId: string
            downloadUrl: string
        }) {
            updateFile(fileId, { phase: "done" })
            const meta = roomRef.current?.files.find(f => f.id === fileId)
            if (!meta) return
            setCompletedFiles(prev => [...prev, {
                fileId,
                name: meta.name,
                size: meta.size,
                receiver: null,
                downloadUrl,
            }])
        }

        socket.on("room:joined", onRoomJoined)
        socket.on("room:error", onRoomError)
        socket.on("transfer:tus-ready", onTusReady)

        return () => {
            socket.off("room:joined", onRoomJoined)
            socket.off("room:error", onRoomError)
            socket.off("transfer:tus-ready", onTusReady)
        }
    }, [socket, updateFile, initFiles])

    useEffect(() => {
        if (room) startAsReceiver()
    }, [room, startAsReceiver])

    // Check if all files are done after completedFiles updates
    useEffect(() => {
        const fileList = Object.values(fileProgress)
        if (
            sessionPhase === "transferring" &&  // ← only transition from transferring
            fileList.length > 0 &&
            fileList.every(f => f.phase === "done")
        ) {
            setSessionPhase("done")
        }
    }, [fileProgress, sessionPhase])

    function downloadFile(file: CompletedFile) {
        if (file.receiver) {
            file.receiver.download()
        } else if (file.downloadUrl) {
            const a = document.createElement("a")
            a.href = file.downloadUrl
            a.download = file.name
            document.body.appendChild(a)
            a.click()
            setTimeout(() => document.body.removeChild(a), 100)
        }
    }

    async function downloadAll() {
        try {
            const zip = new JSZip()

            for (const file of completedFiles) {
                if (file.receiver) {
                    // WebRTC file — get blob from receiver
                    const blob = file.receiver.getBlob()
                    if (blob) zip.file(file.name, blob)
                } else if (file.downloadUrl) {
                    // Tus file — fetch from S3 first
                    const response = await fetch(file.downloadUrl)
                    const blob = await response.blob()
                    zip.file(file.name, blob)
                }
            }

            const zipBlob = await zip.generateAsync({ type: "blob" })
            const url = URL.createObjectURL(zipBlob)
            const a = document.createElement("a")
            a.href = url
            a.download = "filedrop-files.zip"
            document.body.appendChild(a)
            a.click()
            setTimeout(() => {
                URL.revokeObjectURL(url)
                document.body.removeChild(a)
            }, 100)
        } finally {
            setIsZipping(false)
        }
    }

    function formatBytes(bytes: number): string {
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    }

    const fileList = Object.values(fileProgress)
    const completedCount = fileList.filter(f => f.phase === "done").length

    function handleJoin() {
        if (codeInput.trim().length === 0) return
        setIsJoining(true)
        setErrorMessage(null)
        socket.emit("room:join", { code: codeInput.trim().toLowerCase() })
    }

    return (
        <main className="flex flex-col items-center justify-center min-h-screen p-8">
            <div className="w-full max-w-sm flex flex-col items-center gap-6">

                <a href="/" className="text-2xl font-semibold tracking-tight">
                    File<span className="text-blue-400">drop</span>
                </a>

                <p className="text-xs text-gray-500 text-center">
                    {sessionPhase === "setup"
                        ? isConnected ? "🟢 Ready" : "🔴 Connecting..."
                        : sessionPhase === "transferring"
                            ? `🔵 Receiving — ${completedCount} of ${fileList.length} done`
                            : "🟢 All files ready"
                    }
                </p>

                {errorMessage && (
                    <p className="text-sm text-red-400 text-center">{errorMessage}</p>
                )}

                {/* SETUP */}
                {sessionPhase === "setup" && (
                    <div className="w-full flex flex-col items-center gap-4">
                        <p className="text-sm text-gray-400 text-center">
                            Enter the code from the sender
                        </p>
                        <input
                            type="text"
                            value={codeInput}
                            onChange={(e) => setCodeInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                            placeholder="e.g. x7k2mq"
                            maxLength={6}
                            className="w-full text-center font-mono text-2xl tracking-widest bg-gray-900 border border-gray-700 px-6 py-4 rounded-lg outline-none focus:border-blue-500 transition-colors"
                        />
                        <button
                            onClick={handleJoin}
                            disabled={codeInput.trim().length === 0 || isJoining}
                            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-sm"
                        >
                            {isJoining ? "Joining..." : "Join room"}
                        </button>
                    </div>
                )}

                {/* TRANSFERRING */}
                {sessionPhase === "transferring" && (
                    <div className="w-full flex flex-col gap-3">
                        <p className="text-xs text-gray-600 text-center">
                            Files will be ready to download once transfer completes
                        </p>
                        {fileList.map(fp => (
                            <FileProgressCard key={fp.fileId} file={fp} />
                        ))}
                    </div>
                )}

                {/* DONE — show completed files with download options */}
                {sessionPhase === "done" && (
                    <div className="w-full flex flex-col gap-3">

                        <div className="flex justify-between items-center">
                            <p className="text-sm text-gray-300 font-medium">
                                {completedFiles.length} file{completedFiles.length > 1 ? "s" : ""} ready
                            </p>
                            {completedFiles.length > 1 && (
                                <button
                                    onClick={downloadAll}
                                    disabled={isZipping}
                                    className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors font-medium"
                                >
                                    {isZipping ? "Zipping..." : "⬇ Download all as ZIP"}
                                </button>
                            )}
                        </div>

                        {/* Completed file list with individual download buttons */}
                        <div className="flex flex-col gap-2">
                            {completedFiles.map(file => (
                                <div
                                    key={file.fileId}
                                    className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-3"
                                >
                                    <span className="text-lg">📄</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-gray-200 truncate">{file.name}</p>
                                        <p className="text-xs text-gray-500">{formatBytes(file.size)}</p>
                                    </div>
                                    <button
                                        onClick={() => downloadFile(file)}
                                        className="shrink-0 text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
                                    >
                                        ↓ Save
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={() => {
                                setSessionPhase("setup")
                                setRoom(null)
                                setCodeInput("")
                                setCompletedFiles([])
                            }}
                            className="w-full mt-2 px-6 py-3 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg font-medium transition-colors text-sm"
                        >
                            Receive more files
                        </button>
                    </div>
                )}

            </div>
        </main>
    )
}