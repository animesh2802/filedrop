export class FileReceiver {
    private chunks: ArrayBuffer[] = []
    private bytesReceived = 0
    private expectedSize: number
    private fileName: string
    private mimeType: string
    private onProgress: (bytes: number) => void
    private savedBlob: Blob | null = null

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

    save(): void {
        const blob = new Blob(this.chunks, { type: this.mimeType })
        this.savedBlob = blob
        this.triggerDownload(blob)
    }

    private triggerDownload(blob: Blob): void {
        const url = URL.createObjectURL(blob)
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

    getBytesReceived(): number {
        return this.bytesReceived
    }

    getFileName(): string {
        return this.fileName
    }
}