import type { FileMetadata, Room } from "./room.js"

// --- Events the CLIENT sends to the SERVER ---

export interface ClientToServerEvents {
    // Sender creates a new room and declares which files they want to send
    "room:create": (payload: {
        files: FileMetadata[]
    }) => void

    // Receiver joins an existing room using a code
    "room:join": (payload: {
        code: string
    }) => void

    // Either party leaves the room deliberately
    "room:leave": () => void

    // WebRTC signaling — sender sends an offer to receiver via server
    "webrtc:offer": (payload: {
        offer: RTCSessionDescriptionInit
    }) => void

    // WebRTC signaling — receiver sends answer back via server
    "webrtc:answer": (payload: {
        answer: RTCSessionDescriptionInit
    }) => void

    // WebRTC ICE candidate exchange — both sides send these
    "webrtc:ice-candidate": (payload: {
        candidate: RTCIceCandidateInit
    }) => void

    // Sender tells server "WebRTC connected successfully"
    "webrtc:connected": () => void

    // Receiver reports the last confirmed byte offset from WebRTC chunks
    // Server stores this in Redis in case we need to hand off to Tus
    "transfer:checkpoint": (payload: {
        fileId: string
        bytesReceived: number
    }) => void

    // Either party signals transfer is fully complete
    "transfer:complete": (payload: {
        fileId: string
    }) => void
}

// --- Events the SERVER sends to the CLIENT ---

export interface ServerToClientEvents {
    // Server confirms room was created, sends back the code
    "room:created": (payload: {
        code: string
        expiresAt: number
    }) => void

    // Server tells sender that a receiver just joined their room
    "room:receiver-joined": (payload: {
        receiverId: string
    }) => void

    // Server tells receiver the full room info when they successfully join
    "room:joined": (payload: {
        room: Room
    }) => void

    // Room was closed (timeout, disconnect, or explicit leave)
    "room:closed": (payload: {
        reason: "timeout" | "sender-left" | "receiver-left" | "transfer-complete"
    }) => void

    // Error — something went wrong (invalid code, room full, etc)
    "room:error": (payload: {
        message: string
    }) => void

    // Server relays WebRTC offer from sender to receiver
    "webrtc:offer": (payload: {
        offer: RTCSessionDescriptionInit
    }) => void

    // Server relays WebRTC answer from receiver to sender
    "webrtc:answer": (payload: {
        answer: RTCSessionDescriptionInit
    }) => void

    // Server relays ICE candidates between peers
    "webrtc:ice-candidate": (payload: {
        candidate: RTCIceCandidateInit
    }) => void

    // Server tells both clients to switch to Tus (WebRTC failed or timed out)
    // Includes the checkpoint byte so Tus can resume mid-transfer if needed
    "transfer:use-tus": (payload: {
        fileId: string
        resumeFromByte: number   // 0 if WebRTC never started, or checkpoint byte
        uploadUrl: string        // the Tus endpoint URL to upload to
    }) => void

    // Server notifies receiver that a Tus upload is ready to download
    "transfer:tus-ready": (payload: {
        fileId: string
        downloadUrl: string
    }) => void
}

// --- Internal server-only type ---
// Socket.io needs this third generic for server-to-server events
// We don't use it but it needs to exist
export interface InterServerEvents { }

// --- Per-socket data ---
// Extra data we attach to each socket connection on the server
export interface SocketData {
    roomCode?: string    // which room this socket is in
    role?: "sender" | "receiver"
}