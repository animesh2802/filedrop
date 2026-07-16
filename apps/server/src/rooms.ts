import { redis } from "./redis.js"
import type { Room, FileMetadata } from "@filedrop/shared"

// How long a room lives if receiver never joins (10 minutes)
const ROOM_TTL_SECONDS = 60 * 10

// How long we keep a room alive after a disconnect (2 minutes)
const RECONNECT_GRACE_SECONDS = 60 * 2

// Generate a random 6-character alphanumeric room code
export function generateRoomCode(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    let code = ""
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)]
    }
    return code
}

// Redis key for a room — keeps our keys organised
function roomKey(code: string): string {
    return `room:${code}`
}

// Redis key for tracking the WebRTC checkpoint byte per file
function checkpointKey(code: string, fileId: string): string {
    return `checkpoint:${code}:${fileId}`
}

// Save a room to Redis
export async function createRoom(
    code: string,
    senderId: string,
    files: FileMetadata[]
): Promise<Room> {
    const now = Date.now()
    const room: Room = {
        code,
        status: "waiting",
        senderId,
        files,
        createdAt: now,
        expiresAt: now + ROOM_TTL_SECONDS * 1000,
    }

    // Store as JSON string in Redis with a TTL
    // The room auto-deletes after ROOM_TTL_SECONDS if nothing happens
    await redis.set(
        roomKey(code),
        JSON.stringify(room),
        "EX",
        ROOM_TTL_SECONDS
    )

    return room
}

// Fetch a room from Redis
export async function getRoom(code: string): Promise<Room | null> {
    const data = await redis.get(roomKey(code))
    if (!data) return null
    return JSON.parse(data) as Room
}

// Update specific fields on a room
export async function updateRoom(
    code: string,
    updates: Partial<Room>
): Promise<Room | null> {
    const room = await getRoom(code)
    if (!room) return null

    const updated = { ...room, ...updates }

    // Preserve the remaining TTL — don't reset it on every update
    const ttl = await redis.ttl(roomKey(code))
    await redis.set(
        roomKey(code),
        JSON.stringify(updated),
        "EX",
        ttl > 0 ? ttl : ROOM_TTL_SECONDS
    )

    return updated
}

// Delete a room from Redis
export async function deleteRoom(code: string): Promise<void> {
    await redis.del(roomKey(code))
}

// Store the last confirmed byte offset from a WebRTC transfer
// Called when receiver reports a checkpoint
export async function saveCheckpoint(
    code: string,
    fileId: string,
    bytesReceived: number
): Promise<void> {
    await redis.set(
        checkpointKey(code, fileId),
        bytesReceived.toString(),
        "EX",
        RECONNECT_GRACE_SECONDS
    )
}

// Get the checkpoint byte for a file — used when switching to Tus
export async function getCheckpoint(
    code: string,
    fileId: string
): Promise<number> {
    const val = await redis.get(checkpointKey(code, fileId))
    return val ? parseInt(val, 10) : 0
}

// Extend room TTL after a disconnect — gives 2 minutes to reconnect
export async function extendRoomForReconnect(code: string): Promise<void> {
    await redis.expire(roomKey(code), RECONNECT_GRACE_SECONDS)
}