"use client"

import { useState, useEffect } from "react"
import { useSocket } from "@/lib/useSocket"
import type { Room } from "@filedrop/shared"
import { useWebRTC } from "@/lib/useWebRTC"
import { useTransfer } from "@/lib/useTransfer"

export default function ReceivePage() {
    const { socket, isConnected } = useSocket()
    const [codeInput, setCodeInput] = useState("")
    const [room, setRoom] = useState<Room | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [isJoining, setIsJoining] = useState(false)
    const { connectionState, startAsReceiver } = useWebRTC("receiver")
    
    // Receiver has no files to upload — pass empty arrays
    // useTransfer on receiver side only listens for transfer:tus-ready
    const { progress } = useTransfer([], room?.files ? [] : [])

    // Effect 1 — socket listeners
    useEffect(() => {
        function onRoomJoined({ room }: { room: Room }) {
            setRoom(room)
            setIsJoining(false)
        }

        function onRoomError({ message }: { message: string }) {
            setErrorMessage(message)
            setIsJoining(false)
        }

        socket.on("room:joined", onRoomJoined)
        socket.on("room:error", onRoomError)

        return () => {
            socket.off("room:joined", onRoomJoined)
            socket.off("room:error", onRoomError)
        }
    }, [socket])

    // Effect 2 — start WebRTC ONLY after room is set
    // This runs whenever `room` changes — null on mount, Room object after joining
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

    return (
        <main className="flex flex-col items-center justify-center min-h-screen p-8 gap-6">
            <h1 className="text-2xl font-bold">Receive a file</h1>

            <p className="text-sm text-gray-500">
                {isConnected ? "🟢 Connected" : "🔴 Connecting..."}
            </p>

            {errorMessage && (
                <p className="text-sm text-red-500">{errorMessage}</p>
            )}

            {!room ? (
                <div className="flex flex-col items-center gap-4">
                    <input
                        type="text"
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value)}
                        placeholder="Enter room code"
                        maxLength={6}
                        className="text-2xl font-mono text-center tracking-widest bg-gray-900 px-6 py-4 rounded-lg w-64 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        onClick={handleJoin}
                        disabled={codeInput.trim().length === 0 || isJoining}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
                    >
                        {isJoining ? "Joining..." : "Join room"}
                    </button>
                </div>
            ) : (
                <div className="text-center">
                    <p className="text-gray-400 mb-4">Connected! Files waiting:</p>
                    <ul className="text-sm">
                        {room.files.map((file) => (
                            <li key={file.id} className="mb-1">
                                {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
                            </li>
                        ))}
                    </ul>
                    <p className="text-sm text-gray-500 mt-4">
                        WebRTC: {connectionState}
                    </p>
                </div>
            )}
        </main>
    )
}