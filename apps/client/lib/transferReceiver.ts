export class FileReceiver {
    private chunks: ArrayBuffer[] = []
    private bytesReceived = 0
    private expectedSize: number
    private fileName: string
    private mimeType: string
    private onProgress: (bytes: number) => void

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

    // Called every time a chunk arrives on the DataChannel
    receiveChunk(chunk: ArrayBuffer): boolean {
        this.chunks.push(chunk)
        this.bytesReceived += chunk.byteLength
        this.onProgress(this.bytesReceived)

        // Return true if we've received everything
        return this.bytesReceived >= this.expectedSize
    }

    // Called when all chunks are in — assembles and triggers download
    save(): void {
        // Combine all ArrayBuffer chunks into one big Blob
        const blob = new Blob(this.chunks, { type: this.mimeType })

        // Create a temporary download link and click it programmatically
        // This is the standard browser pattern for triggering file downloads
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = this.fileName
        document.body.appendChild(a)
        a.click()

        // Clean up the object URL to free memory
        setTimeout(() => {
            URL.revokeObjectURL(url)
            document.body.removeChild(a)
        }, 100)
    }

    getBytesReceived(): number {
        return this.bytesReceived
    }
}