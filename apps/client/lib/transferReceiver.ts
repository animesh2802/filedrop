export class FileReceiver {
    private chunks: ArrayBuffer[] = []
    private bytesReceived = 0
    private expectedSize: number
    private fileName: string
    private mimeType: string
    private onProgress: (bytes: number) => void
    private blob: Blob | null = null

    // File System Access API (Chrome/Edge)
    private fileHandle: FileSystemFileHandle | null = null
    private writableStream: FileSystemWritableFileStream | null = null
    private usingFileSystemAPI = false

    // StreamSaver (Firefox/Safari fallback)
    private streamSaverWriter: WritableStreamDefaultWriter | null = null
    private usingStreamSaver = false

    constructor(
        fileName: string,
        expectedSize: number,
        mimeType: string,
        onProgress: (bytes: number) => void
    ) {
        this.fileName = fileName
        this.expectedSize = expectedSize
        this.mimeType = mimeType
        this.onProgress = onProgress
    }

    async initFileSystemAccess(): Promise<boolean> {
        // Try File System Access API first (Chrome/Edge)
        if ("showSaveFilePicker" in window) {
            try {
                this.fileHandle = await (window as any).showSaveFilePicker({
                    suggestedName: this.fileName,
                    types: [{
                        description: "File",
                        accept: { [this.mimeType || "application/octet-stream"]: [] },
                    }],
                })
                if (!this.fileHandle) return false
                this.writableStream = await this.fileHandle.createWritable()
                this.usingFileSystemAPI = true
                console.log("[receiver] streaming to disk via File System Access API")
                return true
            } catch (err) {
                console.log("[receiver] File System Access API failed:", err)
                // Fall through to StreamSaver
            }
        }

        // StreamSaver fallback (Firefox, Safari, older Chrome)
        try {
            const streamSaverModule = await import("streamsaver")
            const streamSaver = streamSaverModule.default
            streamSaver.mitm = "/streamsaver/mitm.html"

            const fileStream = streamSaver.createWriteStream(this.fileName, {
                size: this.expectedSize,
            })
            this.streamSaverWriter = fileStream.getWriter()
            this.usingStreamSaver = true
            console.log("[receiver] streaming to disk via StreamSaver")
            return true
        } catch (err) {
            console.log("[receiver] StreamSaver failed — using in-memory fallback:", err)
            return false
        }
    }

    receiveChunk(chunk: ArrayBuffer): boolean {
        this.bytesReceived += chunk.byteLength
        this.onProgress(this.bytesReceived)

        if (this.usingFileSystemAPI && this.writableStream) {
            // Fire and forget — don't await, just queue the write
            this.writableStream.write(chunk).catch(err => {
                console.error("[receiver] write error:", err)
            })
        } else if (this.usingStreamSaver && this.streamSaverWriter) {
            // Fire and forget
            this.streamSaverWriter.write(new Uint8Array(chunk)).catch(err => {
                console.error("[receiver] StreamSaver write error:", err)
            })
        } else {
            this.chunks.push(chunk)
        }

        return this.bytesReceived >= this.expectedSize
    }

    async assemble(): Promise<void> {
        if (this.usingFileSystemAPI && this.writableStream) {
            // Stream writes are queued — close() waits for all pending writes to complete
            await this.writableStream.close()
            this.writableStream = null
        } else if (this.usingStreamSaver && this.streamSaverWriter) {
            await this.streamSaverWriter.close()
            this.streamSaverWriter = null
        } else {
            this.blob = new Blob(this.chunks, { type: this.mimeType })
            this.chunks = []
        }
    }

    download(): void {
        if (this.usingFileSystemAPI || this.usingStreamSaver) {
            console.log("[receiver] file already saved to disk")
            return
        }
        if (!this.blob) return
        const url = URL.createObjectURL(this.blob)
        const a = document.createElement("a")
        a.href = url
        a.download = this.fileName
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
            URL.revokeObjectURL(url)
            document.body.removeChild(a)
        }, 100)
    }

    getBlob(): Blob | null {
        return this.blob
    }

    isStreamedToDisk(): boolean {
        return this.usingFileSystemAPI || this.usingStreamSaver
    }

    getBytesReceived(): number {
        return this.bytesReceived
    }

    getFileName(): string {
        return this.fileName
    }
}