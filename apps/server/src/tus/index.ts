import { Server as TusServer } from "@tus/server"
import { S3Store } from "@tus/s3-store"
import type { Express } from "express"
import type { Server } from "socket.io"
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@filedrop/shared"

type TypedIO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>

let ioInstance: TypedIO | null = null

export function setIO(io: TypedIO): void {
    ioInstance = io
}

// Fix 1 — s3ClientConfig takes raw config fields directly, NOT a pre-built client instance
const s3Store = new S3Store({
    s3ClientConfig: {
        bucket: process.env.S3_BUCKET ?? "filedrop",
        region: process.env.S3_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
            secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
        },
        forcePathStyle: true,
    },
})

// Fix 2 — onUploadFinish returns Promise<{ res }> not Promise<res>
export const tusServer = new TusServer({
    path: "/uploads",
    datastore: s3Store,

    async onUploadFinish(req, upload) {
        console.log(`[tus] upload complete: ${upload.id}`)

        const fileId = upload.metadata?.fileId
        if (fileId && ioInstance) {
            const downloadUrl = `http://localhost:4000/uploads/${upload.id}`
            ioInstance.emit("transfer:tus-ready", { fileId, downloadUrl })
        }

        // Must return this shape — not just res directly
        return {}
    },
})

export function mountTusServer(app: Express): void {
    app.all("/uploads", (req, res) => {
        tusServer.handle(req, res)
    })
    app.all("/uploads/*", (req, res) => {
        tusServer.handle(req, res)
    })

    console.log("[tus] server mounted at /uploads")
}