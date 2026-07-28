"use client"

import { useState, useEffect, useRef } from "react"
import { useSocket } from "@/lib/useSocket"
import type { FileMetadata } from "@filedrop/shared"
import { useWebRTC } from "@/lib/useWebRTC"
import { useTransfer } from "@/lib/useTransfer"

export default function SendPage() {
    const { socket, isConnected } = useSocket()
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const [roomCode, setRoomCode] = useState<string | null>(null)
    const [isCreatingRoom, setIsCreatingRoom] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const { connectionState, startAsSender } = useWebRTC("sender")
    const [fileMetadata, setFileMetadata] = useState<FileMetadata[]>([])
    const selectedFilesRef = useRef<File[]>([])
    const fileMetadataRef = useRef<FileMetadata[]>([])
    const { progress } = useTransfer(selectedFilesRef.current, fileMetadataRef.current)

    // Keep refs in sync with state
    useEffect(() => {
        selectedFilesRef.current = selectedFiles
    }, [selectedFiles])

    useEffect(() => {
        fileMetadataRef.current = fileMetadata
    }, [fileMetadata])

    // All socket LISTENING happens here, registered once on mount
    useEffect(() => {
        function onRoomCreated({ code }: { code: string; expiresAt: number }) {
            setRoomCode(code)
            setIsCreatingRoom(false)
        }

        function onRoomError({ message }: { message: string }) {
            setErrorMessage(message)
            setIsCreatingRoom(false)
        }

        function onReceiverJoined() {
            console.log("[send] receiver joined — starting WebRTC")
            console.log("[send] files in ref:", selectedFilesRef.current.length)
            startAsSender(selectedFilesRef.current, fileMetadataRef.current)
        }


        socket.on("room:created", onRoomCreated)
        socket.on("room:error", onRoomError)
        socket.on("room:receiver-joined", onReceiverJoined)

        // Cleanup when component unmounts
        return () => {
            socket.off("room:created", onRoomCreated)
            socket.off("room:error", onRoomError)
            socket.off("room:receiver-joined", onReceiverJoined)
        }
    }, [socket, startAsSender])

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

        // EMITTING (sending) stays in the event handler, not in useEffect
        // We only emit when the user actually clicks the button
        socket.emit("room:create", { files: metadata })
    }

    return (
        <main className="flex flex-col items-center justify-center min-h-screen p-8 gap-6">
            <h1 className="text-2xl font-bold">Send a file</h1>

            <p className="text-sm text-gray-500">
                {isConnected ? "🟢 Connected" : "🔴 Connecting..."}
            </p>

            <p className="text-sm text-gray-500 mt-2">
                WebRTC: {connectionState}
            </p>

            {errorMessage && (
                <p className="text-sm text-red-500">{errorMessage}</p>
            )}

            {!roomCode ? (
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
            ) : (
                <div className="text-center">
                    <p className="text-gray-400 mb-2">Share this code with the receiver:</p>
                    <p className="text-4xl font-mono font-bold tracking-widest bg-gray-900 px-6 py-4 rounded-lg">
                        {roomCode}
                    </p>
                </div>
            )}
        </main>
    )
}