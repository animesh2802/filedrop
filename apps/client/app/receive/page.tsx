"use client"

import { useState, useEffect, useRef } from "react"
import { useSocket } from "@/lib/useSocket"
import { useWebRTC } from "@/lib/useWebRTC"
import { useTransferState } from "@/lib/useTransferState"
import { FileProgressCard } from "@/components/FileProgressCard"
import type { Room } from "@filedrop/shared"

export default function ReceivePage() {
    const { socket, isConnected } = useSocket()
    const [codeInput, setCodeInput] = useState("")
    const [room, setRoom] = useState<Room | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [isJoining, setIsJoining] = useState(false)
    const [sessionPhase, setSessionPhase] = useState<
        "setup" | "transferring" | "done"
    >("setup")

    const roomRef = useRef<Room | null>(null)
    useEffect(() => { roomRef.current = room }, [room])

    const { files: fileProgress, initFiles, updateFile } = useTransferState(
        room?.files ?? []
    )

    const { startAsReceiver } = useWebRTC("receiver", {
        onChunkSent: (fileId, bytes) => {
            updateFile(fileId, {
                bytesTransferred: bytes,
                phase: "transferring",
                path: "webrtc",
            })
        },
        onFileComplete: (fileId) => {
            updateFile(fileId, { phase: "done" })
            checkAllDone(fileId)
        },
    })

    function checkAllDone(justCompletedId: string) {
        const all = Object.values(fileProgress)
        const allDone = all.every(
            (f) => f.fileId === justCompletedId || f.phase === "done"
        )
        if (allDone && all.length > 0) setSessionPhase("done")
    }

    useEffect(() => {
        function onRoomJoined({ room }: { room: Room }) {
            setRoom(room)
            setIsJoining(false)
            setSessionPhase("transferring")
            initFiles(room.files)
            // Mark all files as connecting initially
            room.files.forEach((f) =>
                updateFile(f.id, { phase: "connecting", path: "webrtc" })
            )
        }

        function onRoomError({ message }: { message: string }) {
            setErrorMessage(message)
            setIsJoining(false)
        }

        function onRoomClosed({ reason }: { reason: string }) {
            console.log("[room] closed:", reason)
        }

        // Tus file ready — trigger download automatically
        function onTusReady({ fileId, downloadUrl }: {
            fileId: string
            downloadUrl: string
        }) {
            updateFile(fileId, { phase: "done" })
            const fileName = roomRef.current?.files.find(f => f.id === fileId)?.name ?? "download"
            const a = document.createElement("a")
            a.href = downloadUrl
            a.download = fileName
            document.body.appendChild(a)
            a.click()
            setTimeout(() => document.body.removeChild(a), 100)
            checkAllDone(fileId)
        }

        socket.on("room:joined", onRoomJoined)
        socket.on("room:error", onRoomError)
        socket.on("room:closed", onRoomClosed)
        socket.on("transfer:tus-ready", onTusReady)

        return () => {
            socket.off("room:joined", onRoomJoined)
            socket.off("room:error", onRoomError)
            socket.off("room:closed", onRoomClosed)
            socket.off("transfer:tus-ready", onTusReady)
        }
    }, [socket, updateFile, initFiles])

    useEffect(() => {
        if (room) {
            startAsReceiver()
        }
    }, [room, startAsReceiver])

    function handleJoin() {
        if (codeInput.trim().length === 0) return
        setIsJoining(true)
        setErrorMessage(null)
        socket.emit("room:join", { code: codeInput.trim().toLowerCase() })
    }

    const fileList = Object.values(fileProgress)
    const completedCount = fileList.filter(f => f.phase === "done").length

    return (
        <main className="flex flex-col items-center justify-center min-h-screen p-8 gap-6">
            <h1 className="text-2xl font-medium tracking-tight">
                File<span className="text-blue-400">drop</span>
            </h1>

            <p className="text-xs text-gray-500">
                {isConnected ? "🟢 Connected" : "🔴 Connecting..."}
            </p>

            {errorMessage && (
                <p className="text-sm text-red-400">{errorMessage}</p>
            )}

            {sessionPhase === "setup" && (
                <div className="flex flex-col items-center gap-4 w-full max-w-sm">
                    <p className="text-sm text-gray-400 self-start">
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

            {(sessionPhase === "transferring" || sessionPhase === "done") && (
                <div className="flex flex-col gap-3 w-full max-w-sm">

                    {/* Summary header */}
                    <div className="flex justify-between items-center">
                        <p className="text-sm text-gray-400">
                            {sessionPhase === "done"
                                ? `All ${fileList.length} file${fileList.length > 1 ? "s" : ""} saved to your downloads`
                                : `${completedCount} of ${fileList.length} complete`}
                        </p>
                        {sessionPhase === "done" && (
                            <span className="text-green-400 text-sm">✅ Done</span>
                        )}
                    </div>

                    {/* File list */}
                    {fileList.map((fp) => (
                        <FileProgressCard key={fp.fileId} file={fp} />
                    ))}

                    {/* Note about auto-download */}
                    {sessionPhase === "transferring" && (
                        <p className="text-xs text-gray-600 text-center mt-2">
                            Files save to your downloads folder automatically
                        </p>
                    )}

                    {/* Session done — offer to receive more */}
                    {sessionPhase === "done" && (
                        <button
                            onClick={() => {
                                setSessionPhase("setup")
                                setRoom(null)
                                setCodeInput("")
                            }}
                            className="mt-2 px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-medium transition-colors text-sm"
                        >
                            Receive more files
                        </button>
                    )}
                </div>
            )}
        </main>
    )
}