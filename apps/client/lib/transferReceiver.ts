export class FileReceiver {
    private chunks: ArrayBuffer[] = []
    private bytesReceived = 0
    private expectedSize: number
    private fileName: string
    private mimeType: string
    private onProgress: (bytes: number) => void
    private blob: Blob | null = null

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

    receiveChunk(chunk: ArrayBuffer): boolean {
        this.chunks.push(chunk)
        this.bytesReceived += chunk.byteLength
        this.onProgress(this.bytesReceived)
        return this.bytesReceived >= this.expectedSize
    }

    // Called when transfer is complete — assembles blob but does NOT download
    assemble(): void {
        this.blob = new Blob(this.chunks, { type: this.mimeType })
        // Free chunk memory — we only need the blob now
        this.chunks = []
    }

    // Call this when user clicks download
    download(): void {
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

    getBytesReceived(): number {
        return this.bytesReceived
    }

    getFileName(): string {
        return this.fileName
    }
}