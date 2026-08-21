"use client"

import { useState, useEffect, useRef } from "react"
import { useSocket } from "@/lib/useSocket"
import { useWebRTC } from "@/lib/useWebRTC"
import { useTransferState } from "@/lib/useTransferState"
import { FileProgressCard } from "@/components/FileProgressCard"
import { uploadFileViaTus } from "@/lib/transferTus"
import { cleanOldUploads } from "@/lib/db"
import type { FileMetadata } from "@filedrop/shared"
import { clearSession, useLeaveWarning } from "@/lib/useSessionPersistence"

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
    const [isDragging, setIsDragging] = useState(false)
    const [peerDisconnected, setPeerDisconnected] = useState(false)

    useLeaveWarning(sessionPhase !== "setup")

    const selectedFilesRef = useRef<File[]>([])
    const fileMetadataRef = useRef<FileMetadata[]>([])
    const completedFileIds = useRef<Set<string>>(new Set())

    useEffect(() => { selectedFilesRef.current = selectedFiles }, [selectedFiles])
    useEffect(() => { fileMetadataRef.current = fileMetadata }, [fileMetadata])

    const { files: fileProgress, initFiles, updateFile } = useTransferState(fileMetadata)

    const { connectionState, startAsSender } = useWebRTC("sender", {
        onChunkSent: (fileId, bytes) => {
            updateFile(fileId, { bytesTransferred: bytes, phase: "transferring", path: "webrtc" })
        },
        onFileComplete: (fileId) => {
            completedFileIds.current.add(fileId)
            updateFile(fileId, { phase: "done" })
            const all = Object.values(fileProgress)
            const allDone = all.every(f => f.fileId === fileId || f.phase === "done")
            if (allDone && all.length > 0) setSessionPhase("done")
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
            if (selectedFilesRef.current.length === 0) {
                setErrorMessage("Session was refreshed and file data was lost. Please start a new session.")
                return
            }
            setPeerDisconnected(false)
            setSessionPhase("transferring")
            fileMetadataRef.current.forEach(meta =>
                updateFile(meta.id, { phase: "connecting", path: "webrtc", bytesTransferred: 0 })
            )
            startAsSender(selectedFilesRef.current, fileMetadataRef.current)
        }

        function onRoomClosed({ reason }: { reason: string }) {
            if (reason === "sender-left" || reason === "receiver-left") {
                setPeerDisconnected(true)
            }
            if (reason === "timeout") {
                // Room expired — reset to setup
                setSessionPhase("setup")
                setRoomCode(null)
                setErrorMessage("Room expired. Please create a new room.")
                clearSession()
            }
        }

        function onUseTus({ fileId, resumeFromByte }: {
            fileId: string
            resumeFromByte: number
            uploadUrl: string
        }) {
            // Skip if WebRTC already completed this file
            if (completedFileIds.current.has(fileId)) {
                console.log(`[tus] skipping ${fileId} — already completed via WebRTC`)
                return
            }

            const metaIndex = fileMetadataRef.current.findIndex(m => m.id === fileId)
            if (metaIndex === -1) return
            const file = selectedFilesRef.current[metaIndex]
            if (!file) return

            updateFile(fileId, { phase: "transferring", path: "tus" })

            uploadFileViaTus(
                file, fileId, resumeFromByte,
                (bytes, total) => updateFile(fileId, { bytesTransferred: bytes, totalBytes: total }),
                (_url) => {
                    updateFile(fileId, { phase: "done" })
                    socket.emit("transfer:complete", { fileId })
                },
                () => updateFile(fileId, { phase: "error" })
            )
        }

        socket.on("room:created", onRoomCreated)
        socket.on("room:closed", onRoomClosed)
        socket.on("room:error", onRoomError)
        socket.on("room:receiver-joined", onReceiverJoined)
        socket.on("transfer:use-tus", onUseTus)

        return () => {
            socket.off("room:created", onRoomCreated)
            socket.off("room:error", onRoomError)
            socket.off("room:receiver-joined", onReceiverJoined)
            socket.off("transfer:use-tus", onUseTus)
            socket.off("room:closed", onRoomClosed)
        }
    }, [socket, startAsSender, updateFile])

    function handleFiles(newFiles: File[]) {
        setSelectedFiles(prev => {
            // Merge new files with existing ones — skip duplicates by name
            const existingNames = new Set(prev.map(f => f.name))
            const unique = newFiles.filter(f => !existingNames.has(f.name))
            return [...prev, ...unique]
        })
    }

    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        if (!e.target.files) return
        handleFiles(Array.from(e.target.files))
        // Reset the input so selecting the same file again works
        e.target.value = ""
    }

    function handleRemoveFile(fileName: string) {
        setSelectedFiles(prev => prev.filter(f => f.name !== fileName))
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
        <main className="flex flex-col items-center justify-center min-h-screen p-8">
            <div className="w-full max-w-sm flex flex-col items-center gap-6">

                {/* Logo */}
                <a href="/" className="text-5xl font-semibold tracking-tight">
                    File<span className="text-blue-400">drop</span>
                </a>

                {sessionPhase !== "setup" && (
                    <button
                        onClick={() => {
                            socket.emit("room:leave")
                            clearSession()
                            setSessionPhase("setup")
                            setSelectedFiles([])
                            setFileMetadata([])
                            setRoomCode(null)
                            setErrorMessage(null)
                            setPeerDisconnected(false)
                        }}
                        className="self-end text-xs text-gray-600 hover:text-red-400 transition-colors"
                    >
                        ✕ Start new session
                    </button>
                )}

                {/* Connection status */}
                <p className="text-xs text-gray-500">
                    {isConnected ? "🟢 Connected to server" : "🔴 Connecting..."}
                </p>

                {peerDisconnected && (
                    <div className="w-full bg-yellow-950 border border-yellow-800 rounded-lg px-3 py-2 text-xs text-yellow-400 text-center">
                        ⚠️ Your peer disconnected. Waiting for them to reconnect (up to 2 minutes)...
                    </div>
                )}

                {errorMessage && (
                    <p className="text-sm text-red-400 text-center">{errorMessage}</p>
                )}

                {/* SETUP PHASE */}
                {sessionPhase === "setup" && (
                    <div className="w-full flex flex-col gap-4">
                        <p className="text-sm text-gray-400 text-center">
                            Select one or multiple files to send
                        </p>

                        {/* Drop zone */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={(e) => {
                                e.preventDefault()
                                setIsDragging(false)
                                handleFiles(Array.from(e.dataTransfer.files))
                            }}
                            onClick={() => document.getElementById("file-input")?.click()}
                            className={`
                w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                ${isDragging
                                    ? "border-blue-400 bg-blue-950"
                                    : "border-gray-700 hover:border-gray-500 bg-gray-900"
                                }
              `}
                        >
                            <p className="text-3xl mb-3">📁</p>
                            <p className="text-sm text-gray-300 font-medium">Drop files here</p>
                            <p className="text-xs text-gray-600 mt-1">or click to browse</p>
                        </div>

                        <input
                            id="file-input"
                            type="file"
                            multiple
                            onChange={handleFileSelect}
                            className="hidden"
                        />

                        <button
                            onClick={handleCreateRoom}
                            disabled={selectedFiles.length === 0 || isCreatingRoom}
                            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-sm"
                        >
                            {isCreatingRoom ? "Creating room..." : `Create room ${selectedFiles.length > 0 ? `(${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""})` : ""}`}
                        </button>

                        {/* Selected files list */}
                        {selectedFiles.length > 0 && (
                            <div className="flex flex-col gap-2">
                                {selectedFiles.map((f) => (
                                    <div
                                        key={f.name}
                                        className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2"
                                    >
                                        <span className="text-lg">📄</span>
                                        <span className="text-sm flex-1 truncate text-gray-200">{f.name}</span>
                                        <span className="text-xs text-gray-500 shrink-0">
                                            {(f.size / 1024 / 1024).toFixed(2)} MB
                                        </span>
                                        <button
                                            onClick={() => handleRemoveFile(f.name)}
                                            className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none ml-1"
                                            title="Remove file"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* WAITING PHASE */}
                {sessionPhase === "waiting" && roomCode && (
                    <div className="w-full flex flex-col items-center gap-4">
                        <p className="text-sm text-gray-400">Share this code with the receiver:</p>
                        <div className="w-full bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                            <p className="text-5xl font-mono font-bold tracking-widest text-white">
                                {roomCode}
                            </p>
                        </div>
                        <p className="text-xs text-gray-600 animate-pulse">
                            Waiting for receiver to join...
                        </p>

                        {/* Show queued files */}
                        <div className="w-full flex flex-col gap-2 mt-2">
                            {selectedFiles.map(f => (
                                <div key={f.name} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
                                    <span>📄</span>
                                    <span className="text-sm flex-1 truncate text-gray-400">{f.name}</span>
                                    <span className="text-xs text-gray-600">queued</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* TRANSFERRING / DONE PHASE */}
                {(sessionPhase === "transferring" || sessionPhase === "done") && (
                    <div className="w-full flex flex-col gap-3">
                        <div className="flex justify-between items-center">
                            <p className="text-sm text-gray-400">
                                {sessionPhase === "done"
                                    ? `${Object.values(fileProgress).length} file${Object.values(fileProgress).length > 1 ? "s" : ""} sent`
                                    : `WebRTC: ${connectionState}`}
                            </p>
                            {sessionPhase === "done" && <span className="text-green-400 text-sm">✅ Done</span>}
                        </div>

                        {Object.values(fileProgress).map(fp => (
                            <FileProgressCard key={fp.fileId} file={fp} />
                        ))}

                        {sessionPhase === "done" && (
                            <button
                                onClick={() => {
                                    completedFileIds.current = new Set()  // ← add this line
                                    clearSession()
                                    setSessionPhase("setup")
                                    setSelectedFiles([])
                                    setFileMetadata([])
                                    setRoomCode(null)
                                }}
                                className="w-full mt-2 px-6 py-3 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-lg font-medium transition-colors text-sm"
                            >
                                Send more files
                            </button>
                        )}
                    </div>
                )}

            </div>
        </main>
    )
}