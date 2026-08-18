import { Server, Socket } from "socket.io"
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@filedrop/shared"
import {
    generateRoomCode,
    createRoom,
    getRoom,
    updateRoom,
    deleteRoom,
    saveCheckpoint,
    getCheckpoint,
    extendRoomForReconnect,
} from "../rooms.js"

const WEBRTC_TIMEOUT_MS = 5000

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>

export function registerSocketHandlers(io: TypedServer): void {
    const webrtcTimers = new Map<string, ReturnType<typeof setTimeout>>()

    async function startWebRTCTimer(code: string): Promise<void> {
        console.log(`[webrtc] starting timer for room ${code}`)
        const timer = setTimeout(async () => {
            const room = await getRoom(code)
            if (!room || room.status === "closed") return
            console.log(`[webrtc] timer fired for room ${code} — switching to Tus`)
            for (const file of room.files) {
                const resumeFromByte = await getCheckpoint(code, file.id)
                io.to(code).emit("transfer:use-tus", {
                    fileId: file.id,
                    resumeFromByte,
                    uploadUrl: `${process.env.TUS_URL ?? "http://localhost:4000"}/uploads`,
                })
            }
        }, WEBRTC_TIMEOUT_MS)
        webrtcTimers.set(code, timer)
    }

    io.on("connection", (socket: TypedSocket) => {
        console.log(`[socket] connected: ${socket.id}`)

        socket.on("room:create", async ({ files }) => {
            try {
                let code = generateRoomCode()
                while (await getRoom(code)) {
                    code = generateRoomCode()
                }
                const room = await createRoom(code, socket.id, files)
                socket.data.roomCode = code
                socket.data.role = "sender"
                await socket.join(code)
                socket.emit("room:created", { code, expiresAt: room.expiresAt })
                console.log(`[room] created: ${code} by ${socket.id}`)
            } catch (err) {
                console.error("[room:create] error:", err)
                socket.emit("room:error", { message: "Failed to create room" })
            }
        })

        // Single room:join handler — timer starts here after room is active
        socket.on("room:join", async ({ code }) => {
            try {
                const room = await getRoom(code)

                if (!room) {
                    socket.emit("room:error", { message: "Room not found or expired" })
                    return
                }
                if (room.status === "active") {
                    // Check if this is a reconnection attempt — room exists but receiver slot is open
                    // because the previous receiver disconnected (their socket ID is gone)
                    const previousReceiverConnected = room.receiverId
                        ? (await io.fetchSockets()).some(s => s.id === room.receiverId)
                        : false

                    if (previousReceiverConnected) {
                        socket.emit("room:error", { message: "Room is already full" })
                        return
                    }
                    // Previous receiver disconnected — allow rejoin
                }
                if (room.status === "closed") {
                    socket.emit("room:error", { message: "Room is closed" })
                    return
                }

                await updateRoom(code, { status: "active", receiverId: socket.id })

                socket.data.roomCode = code
                socket.data.role = "receiver"
                await socket.join(code)

                const updatedRoom = await getRoom(code)
                socket.emit("room:joined", { room: updatedRoom! })
                socket.to(code).emit("room:receiver-joined", { receiverId: socket.id })

                console.log(`[room] ${socket.id} joined room: ${code}`)

                // Timer starts here — room is confirmed active at this point
                await startWebRTCTimer(code)
            } catch (err) {
                console.error("[room:join] error:", err)
                socket.emit("room:error", { message: "Failed to join room" })
            }
        })

        socket.on("webrtc:offer", async ({ offer }) => {
            const code = socket.data.roomCode
            if (!code) return
            socket.to(code).emit("webrtc:offer", { offer })
        })

        socket.on("webrtc:answer", async ({ answer }) => {
            const code = socket.data.roomCode
            if (!code) return
            socket.to(code).emit("webrtc:answer", { answer })
        })

        socket.on("webrtc:ice-candidate", async ({ candidate }) => {
            const code = socket.data.roomCode
            if (!code) return
            socket.to(code).emit("webrtc:ice-candidate", { candidate })
        })

        socket.on("webrtc:connected", () => {
            const code = socket.data.roomCode
            if (!code) return
            // Uncomment this when done testing Tus:
            const timer = webrtcTimers.get(code)
            if (timer) {
                clearTimeout(timer)
                webrtcTimers.delete(code)
                console.log(`[webrtc] P2P connected in room ${code} — timer cancelled`)
            }
        })

        socket.on("transfer:checkpoint", async ({ fileId, bytesReceived }) => {
            const code = socket.data.roomCode
            if (!code) return
            await saveCheckpoint(code, fileId, bytesReceived)
        })

        socket.on("transfer:complete", async ({ fileId }) => {
            const code = socket.data.roomCode
            if (!code) return
            console.log(`[transfer] file ${fileId} complete in room ${code}`)
        })

        socket.on("room:leave", async () => {
            await handleLeave(socket, io, "sender-left")
        })

        socket.on("disconnect", async (reason) => {
            console.log(`[socket] disconnected: ${socket.id} — ${reason}`)
            const code = socket.data.roomCode
            if (!code) return

            const room = await getRoom(code)
            if (!room || room.status === "closed") return

            if (socket.data.role === "sender") {
                // Sender left — destroy room immediately, no grace period
                await deleteRoom(code)
                io.to(code).emit("room:closed", { reason: "sender-left" })
                console.log(`[room] destroyed: ${code} — sender disconnected`)
            } else {
                // Receiver left — grace period still applies
                await extendRoomForReconnect(code)
                socket.to(code).emit("room:closed", { reason: "receiver-left" })
                console.log(`[room] ${socket.id} disconnected — receiver grace period started`)
            }
        })
    })
}

async function handleLeave(
    socket: TypedSocket,
    io: TypedServer,
    reason: "sender-left" | "receiver-left"
): Promise<void> {
    const code = socket.data.roomCode
    if (!code) return
    await deleteRoom(code)
    socket.to(code).emit("room:closed", { reason })
    await socket.leave(code)
    socket.data.roomCode = undefined
    console.log(`[room] closed: ${code} — reason: ${reason}`)
}