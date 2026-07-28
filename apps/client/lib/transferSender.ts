// How large each chunk is — 16KB is the standard safe size for WebRTC DataChannels
const CHUNK_SIZE = 16 * 1024

// If bufferedAmount exceeds this, we pause and wait
// Without this check the DataChannel crashes on large files
const BUFFER_THRESHOLD = 256 * 1024 // 256KB

// How often we report a checkpoint back to the server (every 1MB)
const CHECKPOINT_INTERVAL = 1024 * 1024 // 1MB

export async function sendFileOverDataChannel(
    file: File,
    fileId: string,
    dataChannel: RTCDataChannel,
    onProgress: (bytesTransferred: number) => void,
    onCheckpoint: (fileId: string, bytesReceived: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        let offset = 0
        let lastCheckpoint = 0

        // Read a slice of the file as an ArrayBuffer and send it
        function sendNextChunk() {
            // All chunks sent — we're done
            if (offset >= file.size) {
                resolve()
                return
            }

            // DataChannel buffer is too full — wait for it to drain
            // then try again. This is the backpressure mechanism.
            if (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
                dataChannel.onbufferedamountlow = () => {
                    dataChannel.onbufferedamountlow = null
                    sendNextChunk()
                }
                dataChannel.bufferedAmountLowThreshold = BUFFER_THRESHOLD / 2
                return
            }

            // Slice the file from current offset to offset + CHUNK_SIZE
            const slice = file.slice(offset, offset + CHUNK_SIZE)

            const reader = new FileReader()
            reader.onload = (e) => {
                if (!e.target?.result) return

                // Send the raw bytes through the DataChannel
                dataChannel.send(e.target.result as ArrayBuffer)

                offset += (e.target.result as ArrayBuffer).byteLength

                // Report progress to the UI
                onProgress(offset)

                // Every 1MB, report a checkpoint to the server
                // so Redis has an up-to-date offset in case WebRTC drops
                if (offset - lastCheckpoint >= CHECKPOINT_INTERVAL) {
                    lastCheckpoint = offset
                    onCheckpoint(fileId, offset)
                }

                // Send the next chunk
                sendNextChunk()
            }

            reader.onerror = () => reject(new Error("FileReader error"))
            reader.readAsArrayBuffer(slice)
        }

        // Handle DataChannel errors
        dataChannel.onerror = (err) => reject(err)

        // Start sending
        sendNextChunk()
    })
}