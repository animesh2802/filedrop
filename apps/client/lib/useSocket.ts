"use client"

import { useEffect, useState } from "react"
import { getSocket } from "./socket"

export function useSocket() {
    const [isConnected, setIsConnected] = useState(false)

    useEffect(() => {
        const socket = getSocket()

        // If not already connected, connect now
        if (!socket.connected) {
            socket.connect()
        }

        function onConnect() {
            setIsConnected(true)
            console.log("[socket] connected:", socket.id)
        }

        function onDisconnect() {
            setIsConnected(false)
            console.log("[socket] disconnected")
        }

        socket.on("connect", onConnect)
        socket.on("disconnect", onDisconnect)

        // Sync initial state in case socket connected before this ran
        setIsConnected(socket.connected)

        // Cleanup — remove these specific listeners when component unmounts
        return () => {
            socket.off("connect", onConnect)
            socket.off("disconnect", onDisconnect)
        }
    }, [])

    return { socket: getSocket(), isConnected }
}