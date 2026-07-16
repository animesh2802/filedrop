import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import cors from "cors"
import { registerSocketHandlers } from "./socket/index.js"
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@filedrop/shared"

const PORT = process.env.PORT ?? "4000"
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3000"

const app = express()
app.use(cors({ origin: CLIENT_URL }))

app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() })
})

const httpServer = createServer(app)

// Now the io instance is fully typed with our event interfaces
const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>(httpServer, {
    cors: {
        origin: CLIENT_URL,
        methods: ["GET", "POST"],
    },
})

// Register all socket event handlers
registerSocketHandlers(io)

httpServer.listen(PORT, () => {
    console.log(`[server] running on http://localhost:${PORT}`)
})