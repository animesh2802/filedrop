// Re-export everything from both files
// This means consumers can write:
// import { Room, FileMetadata, ClientToServerEvents } from "@filedrop/shared"
// instead of importing from specific files
export * from "./room.js"
export * from "./events.js"