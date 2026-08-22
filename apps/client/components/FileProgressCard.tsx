import type { FileProgress } from "@/lib/useTransferState"

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
    return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`
}

function formatETA(bytesRemaining: number, speed: number): string {
    if (speed === 0) return "calculating..."
    const seconds = bytesRemaining / speed
    if (seconds < 60) return `${Math.ceil(seconds)}s remaining`
    return `${Math.ceil(seconds / 60)}m remaining`
}

interface Props {
    file: FileProgress
}

export function FileProgressCard({ file }: Props) {
    const percentage =
        file.totalBytes > 0
            ? Math.round((file.bytesTransferred / file.totalBytes) * 100)
            : 0

    const bytesRemaining = file.totalBytes - file.bytesTransferred

    const pathLabel =
        file.path === "webrtc"
            ? "⚡ Direct P2P"
            : file.path === "tus"
                ? "☁️ Cloud relay"
                : null

    const phaseColor = {
        idle: "bg-gray-600",
        connecting: "bg-yellow-500",
        transferring: "bg-blue-500",
        done: "bg-green-500",
        error: "bg-red-500",
    }[file.phase]

    return (
        <div className="bg-gray-900 rounded-xl p-4 w-full max-w-md">
            <div className="flex justify-between items-start mb-2">
                <div>
                    <p className="font-medium text-sm truncate max-w-60">{file.name}</p>
                    <p className="text-xs text-gray-500">
                        {file.phase === "done"
                            ? formatBytes(file.totalBytes)
                            : `${formatBytes(file.bytesTransferred)} / ${formatBytes(file.totalBytes)}`}
                    </p>
                </div>
                <div className="text-right">
                    {file.phase === "done" ? (
                        <p className="text-xs text-green-400">✅ Complete</p>
                    ) : (
                        <>
                            {pathLabel && (
                                <p className="text-xs text-gray-400">{pathLabel}</p>
                            )}
                            {file.phase === "transferring" && (
                                <p className="text-xs text-gray-400">{formatSpeed(file.speed)}</p>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div className="w-full bg-gray-800 rounded-full h-2 mb-2">
                <div
                    className={`h-2 rounded-full transition-all duration-300 ${phaseColor}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>

            <div className="flex justify-between text-xs text-gray-500">
                <span>
                    {file.phase === "done"
                        ? "✅ Complete"
                        : file.phase === "error"
                            ? "❌ Failed"
                            : file.phase === "connecting"
                                ? "Connecting..."
                                : file.phase === "transferring"
                                    ? formatETA(bytesRemaining, file.speed)
                                    : "Waiting..."}
                </span>
                <span className="font-mono">{percentage}%</span>
            </div>
        </div>
    )
}