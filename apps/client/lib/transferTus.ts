import * as tus from "tus-js-client"

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000"

export function uploadFileViaTus(
    file: File,
    fileId: string,
    resumeFromByte: number,
    onProgress: (bytes: number, total: number) => void,
    onSuccess: (downloadUrl: string) => void,
    onError: (err: Error) => void
): tus.Upload {
    const upload = new tus.Upload(file, {
        endpoint: `${SERVER_URL}/uploads`,
        retryDelays: [0, 1000, 3000, 5000],
        chunkSize: 5 * 1024 * 1024, // 5MB chunks for Tus (larger than WebRTC chunks)

        // Metadata the server stores alongside the upload
        metadata: {
            fileId,
            filename: file.name,
            filetype: file.type || "application/octet-stream",
        },

        // Resume from a specific byte offset
        // This is the key field for our WebRTC-to-Tus handoff
        uploadLengthDeferred: false,

        onProgress(bytesUploaded, bytesTotal) {
            // Add the resumeFromByte offset so progress reflects the whole file
            onProgress(bytesUploaded + resumeFromByte, bytesTotal)
        },

        onSuccess() {
            const downloadUrl = `${SERVER_URL}/uploads/${upload.url?.split("/uploads/")[1]}`
            onSuccess(downloadUrl)
        },

        onError(err) {
            console.error("[tus] upload error:", err)
            onError(err instanceof Error ? err : new Error(String(err)))
        },
    })

    // If resumeFromByte > 0, this was a partial WebRTC transfer
    // We need to slice the file to only upload the remaining portion
    if (resumeFromByte > 0) {
        const remainingSlice = file.slice(resumeFromByte)
        const slicedUpload = new tus.Upload(remainingSlice as unknown as File, {
            ...upload.options,
            metadata: {
                ...upload.options.metadata,
                resumeFromByte: resumeFromByte.toString(),
            },
        })
        slicedUpload.start()
        return slicedUpload
    }

    upload.start()
    return upload
}