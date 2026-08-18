import Dexie, { type Table } from "dexie"

// The shape of what we persist per upload
export interface PendingUpload {
    id?: number          // auto-incremented primary key
    fileId: string       // our app's file ID e.g. "f_0_1234567890"
    tusUploadUrl: string // the Tus upload URL to resume from
    bytesUploaded: number
    fileName: string
    fileSize: number
    savedAt: number      // timestamp so we can expire old entries
}

class FileDropDB extends Dexie {
    pendingUploads!: Table<PendingUpload>

    constructor() {
        super("filedrop")
        this.version(2).stores({
            // Index by fileId for fast lookup
            // The ++ prefix means auto-increment primary key
            pendingUploads: "++id, fileId, savedAt",
        })
    }
}

export const db = new FileDropDB()

// Save or update a pending upload
export async function savePendingUpload(upload: Omit<PendingUpload, "id">): Promise<void> {
    // Check if one already exists for this fileId
    const existing = await db.pendingUploads.where("fileId").equals(upload.fileId).first()
    if (existing?.id) {
        await db.pendingUploads.update(existing.id, upload)
    } else {
        await db.pendingUploads.add(upload)
    }
}

// Get a pending upload by fileId
export async function getPendingUpload(fileId: string): Promise<PendingUpload | undefined> {
    return db.pendingUploads.where("fileId").equals(fileId).first()
}

// Delete after successful completion
export async function deletePendingUpload(fileId: string): Promise<void> {
    await db.pendingUploads.where("fileId").equals(fileId).delete()
}

// Clean up entries older than 24 hours on startup
export async function cleanOldUploads(): Promise<void> {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
    await db.pendingUploads
        .where("savedAt")
        .below(oneDayAgo)
        .delete()
}