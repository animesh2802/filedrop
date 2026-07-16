import { io, Socket } from "socket.io-client"
import type {
    ClientToServerEvents,
    ServerToClientEvents,
} from "@filedrop/shared"

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000"

// TypeScript note: Socket.io's client Socket type takes the events
// in the OPPOSITE order to the server — first the events we LISTEN to,
// then the events we EMIT. This is intentional, not a typo.
type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>

// We only want one instance, created lazily on first use
let socket: TypedClientSocket | null = null

export function getSocket(): TypedClientSocket {
    if (!socket) {
        socket = io(SERVER_URL, {
            autoConnect: false, // we control when to connect, not on import
        })
    }
    return socket
}