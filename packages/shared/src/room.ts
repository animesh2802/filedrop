// The metadata for a single file being transferred
// This is what the sender tells the receiver about each file
// before the actual bytes start flowing
export interface FileMetadata {
    id: string           // unique ID we generate per file, e.g. "f_x7k2mq_0"
    name: string         // original filename, e.g. "photo.jpg"
    size: number         // total size in bytes
    mimeType: string     // e.g. "image/jpeg", "application/pdf"
}

// Every possible state a transfer can be in
// This is a union type — transferStatus can ONLY be one of these strings
// TypeScript will throw error if you try to assign anything else
export type TransferStatus =
    | "idle"           // nothing happening yet
    | "connecting"     // WebRTC handshake in progress
    | "transferring"   // actively sending/receiving bytes
    | "paused"         // connection dropped, attempting recovery
    | "fallback"       // switched to Tus path
    | "done"           // transfer complete
    | "cancelled"      // either party cancelled

// The state of a single file's transfer progress
export interface FileTransferState {
    fileId: string
    status: TransferStatus
    bytesTransferred: number   // how many bytes have arrived so far
    // The offset to resume from if we switch to Tus mid-transfer
    // The ? means this is optional — only set when WebRTC drops mid-transfer
    webrtcCheckpointByte?: number
}

// The full room state — this is what we store in Redis
export interface Room {
    code: string                      // the 6-char room code e.g. "x7k2mq"
    status: "waiting" | "active" | "closed"
    senderId: string                  // socket ID of the sender
    receiverId?: string               // socket ID of receiver (optional — may not have joined yet)
    files: FileMetadata[]             // list of files being sent this session
    createdAt: number                 // unix timestamp in ms
    expiresAt: number                 // unix timestamp — when the room auto-closes
}