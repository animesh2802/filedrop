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

// How long to wait for WebRTC to connect before falling back to Tus
const WEBRTC_TIMEOUT_MS = 5000

// This is the typed Socket.io server — we pass our event interfaces
// as generics so TypeScript knows exactly what events are valid
type TypedServer = Server<
ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
    >

    type TypedSocket = Socket<
ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
    >

export function registerSocketHandlers(io: TypedServer): void {
    io.on("connection", (socket: TypedSocket) => {
        console.log(`[socket] connected: ${socket.id}`)

        // -----------------------------------
        // ROOM: CREATE
        // Sender opens the app and picks files
        // -----------------------------------
        socket.on("room:create", async ({ files }) => {
            try {
                // Keep generating codes until we find one not already in use
                let code = generateRoomCode()
                while (await getRoom(code)) {
                    code = generateRoomCode()
                }

                const room = await createRoom(code, socket.id, files)

                // Attach room info to this socket so we can access it on disconnect
                socket.data.roomCode = code
                socket.data.role = "sender"

                // Join a Socket.io room — this lets us broadcast to everyone in the room
                await socket.join(code)

                // Tell the sender their room code and expiry time
                socket.emit("room:created", {
                    code,
                    expiresAt: room.expiresAt,
                })

                console.log(`[room] created: ${code} by ${socket.id}`)
            } catch (err) {
                console.error("[room:create] error:", err)
                socket.emit("room:error", { message: "Failed to create room" })
            }
        })

        // -----------------------------------
        // ROOM: JOIN
        // Receiver enters the room code
        // -----------------------------------
        socket.on("room:join", async ({ code }) => {
            try {
                const room = await getRoom(code)

                // Room doesn't exist or already expired
                if (!room) {
                    socket.emit("room:error", { message: "Room not found or expired" })
                    return
                }

                // Room already has a receiver — can't join twice
                if (room.status === "active") {
                    socket.emit("room:error", { message: "Room is already full" })
                    return
                }

                // Room was closed
                if (room.status === "closed") {
                    socket.emit("room:error", { message: "Room is closed" })
                    return
                }

                // Update room — mark it active and record receiver's socket ID
                await updateRoom(code, {
                    status: "active",
                    receiverId: socket.id,
                })

                socket.data.roomCode = code
                socket.data.role = "receiver"

                await socket.join(code)

                // Tell the receiver the full room info (including file list)
                const updatedRoom = await getRoom(code)
                socket.emit("room:joined", { room: updatedRoom! })

                // Tell the sender that their receiver has arrived
                socket.to(code).emit("room:receiver-joined", {
                    receiverId: socket.id,
                })

                console.log(`[room] ${socket.id} joined room: ${code}`)
            } catch (err) {
                console.error("[room:join] error:", err)
                socket.emit("room:error", { message: "Failed to join room" })
            }
        })

        // -----------------------------------
        // WEBRTC SIGNALING
        // Server just relays these — it never reads the contents
        // -----------------------------------
        socket.on("webrtc:offer", async ({ offer }) => {
            const code = socket.data.roomCode
            if (!code) return
            // Forward the offer to everyone else in the room (the receiver)
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

        // -----------------------------------
        // WEBRTC: CONNECTED
        // Sender tells us P2P succeeded — cancel the fallback timer
        // -----------------------------------
        const webrtcTimers = new Map<string, ReturnType<typeof setTimeout>>()

        socket.on("webrtc:connected", () => {
            const code = socket.data.roomCode
            if (!code) return

            // Cancel the fallback timer — WebRTC won, no need for Tus
            const timer = webrtcTimers.get(code)
            if (timer) {
                clearTimeout(timer)
                webrtcTimers.delete(code)
                console.log(`[webrtc] P2P connected in room ${code} — timer cancelled`)
            }
        })

        // -----------------------------------
        // START WEBRTC TIMER
        // Called internally when receiver joins
        // If WebRTC doesn't connect in 5s, fall back to Tus
        // -----------------------------------
        async function startWebRTCTimer(code: string): Promise<void> {
            const timer = setTimeout(async () => {
                const room = await getRoom(code)
                if (!room || room.status === "closed") return

                console.log(`[webrtc] timeout in room ${code} — switching to Tus`)

                // For each file, get the checkpoint byte (0 if WebRTC never started)
                for (const file of room.files) {
                    const resumeFromByte = await getCheckpoint(code, file.id)

                    // Tell BOTH clients to switch to Tus for this file
                    io.to(code).emit("transfer:use-tus", {
                        fileId: file.id,
                        resumeFromByte,
                        uploadUrl: `${process.env.TUS_URL ?? "http://localhost:4000"}/uploads`,
                    })
                }
            }, WEBRTC_TIMEOUT_MS)

            webrtcTimers.set(code, timer)
        }

        // -----------------------------------
        // TRANSFER: CHECKPOINT
        // Receiver reports how many bytes it has confirmed received via WebRTC
        // We store this in Redis — if WebRTC drops, Tus resumes from here
        // -----------------------------------
        socket.on("transfer:checkpoint", async ({ fileId, bytesReceived }) => {
            const code = socket.data.roomCode
            if (!code) return
            await saveCheckpoint(code, fileId, bytesReceived)
        })

        // -----------------------------------
        // TRANSFER: COMPLETE
        // Either party signals a file is done
        // -----------------------------------
        socket.on("transfer:complete", async ({ fileId }) => {
            const code = socket.data.roomCode
            if (!code) return
            console.log(`[transfer] file ${fileId} complete in room ${code}`)
            // We don't close the room here — user may want to send more files
            // Room stays open until explicit leave or disconnect timeout
        })

        // -----------------------------------
        // ROOM: LEAVE
        // Explicit "end session" by either party
        // -----------------------------------
        socket.on("room:leave", async () => {
            await handleLeave(socket, io, "sender-left")
        })

        // -----------------------------------
        // DISCONNECT
        // Browser closed, network dropped, etc.
        // Give them 2 minutes to reconnect before closing the room
        // -----------------------------------
        socket.on("disconnect", async (reason) => {
            console.log(`[socket] disconnected: ${socket.id} — ${reason}`)
            const code = socket.data.roomCode
            if (!code) return

            const room = await getRoom(code)
            if (!room || room.status === "closed") return

            console.log(`[room] ${socket.id} disconnected from room ${code} — starting grace period`)

            // Extend the room TTL to give them 2 minutes to reconnect
            await extendRoomForReconnect(code)

            // Tell the other person their peer disconnected temporarily
            const closeReason =
                socket.data.role === "sender" ? "sender-left" : "receiver-left"
            socket.to(code).emit("room:closed", { reason: closeReason })
        })

        // Start the WebRTC timer when receiver joins
        // We hook into the room:join flow via a separate listener
        socket.on("room:join", async ({ code }) => {
            const room = await getRoom(code)
            if (room?.status === "active") {
                await startWebRTCTimer(code)
            }
        })
    })
}

// -----------------------------------
// HELPER: handle a deliberate leave
// -----------------------------------
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