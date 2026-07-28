import * as tus from "tus-js-client"
import { savePendingUpload, deletePendingUpload } from "./db"

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000"

export function uploadFileViaTus(
    file: File,
    fileId: string,
    resumeFromByte: number,
    onProgress: (bytes: number, total: number) => void,
    onSuccess: (downloadUrl: string) => void,
    onError: (err: Error) => void
): tus.Upload {
    const targetFile = resumeFromByte > 0
        ? file.slice(resumeFromByte) as unknown as File
        : file

    const upload = new tus.Upload(targetFile, {
        endpoint: `${SERVER_URL}/uploads`,
        retryDelays: [0, 1000, 3000, 5000],
        chunkSize: 5 * 1024 * 1024,
        metadata: {
            fileId,
            filename: file.name,
            filetype: file.type || "application/octet-stream",
            resumeFromByte: resumeFromByte.toString(),
        },

        async onProgress(bytesUploaded, bytesTotal) {
            const totalBytes = resumeFromByte + bytesTotal
            const totalUploaded = resumeFromByte + bytesUploaded
            onProgress(totalUploaded, totalBytes)

            // Persist progress to IndexedDB every time progress fires
            // If the tab crashes mid-upload, we can resume from here
            if (upload.url) {
                await savePendingUpload({
                    fileId,
                    tusUploadUrl: upload.url,
                    bytesUploaded: totalUploaded,
                    fileName: file.name,
                    fileSize: totalBytes,
                    savedAt: Date.now(),
                })
            }
        },

        async onSuccess() {
            const uploadId = upload.url?.split("/uploads/")[1]
            const downloadUrl = `${SERVER_URL}/uploads/${uploadId}`

            // Clean up IndexedDB — transfer is done, no need to resume
            await deletePendingUpload(fileId)

            onSuccess(downloadUrl)
        },

        onError(err) {
            console.error("[tus] upload error:", err)
            onError(err instanceof Error ? err : new Error(String(err)))
        },
    })

    upload.start()
    return upload
}