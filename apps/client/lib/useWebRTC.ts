"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { getSocket } from "./socket"
import { sendFileOverDataChannel } from "./transferSender"
import { FileReceiver } from "./transferReceiver"
import type { FileMetadata } from "@filedrop/shared"

// Google's public STUN server — free, no signup needed
// In production you'd usually add more than one for redundancy
const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
]

type ConnectionState = "idle" | "connecting" | "connected" | "failed"

interface WebRTCCallbacks {
    onChunkSent?: (fileId: string, bytes: number) => void
    onFileComplete?: (fileId: string) => void
    onFileAssembled?: (fileId: string, receiver: FileReceiver) => void
}

export function useWebRTC(role: "sender" | "receiver", callbacks: WebRTCCallbacks = {}) {
    const socket = getSocket()

    // useRef instead of useState here because we need a value that
    // persists across renders WITHOUT triggering a re-render when it changes
    // RTCPeerConnection and the DataChannel are exactly this kind of value
    const pcRef = useRef<RTCPeerConnection | null>(null)
    const dataChannelRef = useRef<RTCDataChannel | null>(null)

    const [connectionState, setConnectionState] = useState<ConnectionState>("idle")

    // Create the peer connection — called once when we're ready to start
    const createPeerConnection = useCallback((): RTCPeerConnection => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

        // Whenever the browser discovers a new ICE candidate (a possible
        // network path), send it to the other peer via the signaling server
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit("webrtc:ice-candidate", {
                    candidate: event.candidate.toJSON(),
                })
            }
        }

        // Track the overall connection state
        pc.onconnectionstatechange = () => {
            console.log("[webrtc] connection state:", pc.connectionState)

            if (pc.connectionState === "connected") {
                setConnectionState("connected")
                // Tell the server WebRTC succeeded — cancels the 5s fallback timer
                socket.emit("webrtc:connected")
            }

            if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
                setConnectionState("failed")
            }
        }

        pcRef.current = pc
        return pc
    }, [socket])

    // --- SENDER SIDE: create offer ---
    const startAsSender = useCallback(
        async (files: File[], fileMetadata: FileMetadata[]) => {
            setConnectionState("connecting")
            const pc = createPeerConnection()

            const channel = pc.createDataChannel("file-transfer", {
                ordered: true,
            })
            dataChannelRef.current = channel

            channel.onopen = async () => {
                console.log("[webrtc] data channel open (sender) — starting transfer")

                for (let i = 0; i < files.length; i++) {
                    const file = files[i]
                    const meta = fileMetadata[i]

                    // Send metadata first
                    channel.send(
                        JSON.stringify({
                            type: "file-meta",
                            fileId: meta.id,
                            name: meta.name,
                            size: meta.size,
                            mimeType: meta.mimeType,
                        })
                    )

                    // Send file bytes
                    await sendFileOverDataChannel(
                        file,
                        meta.id,
                        channel,
                        (bytes) => {
                            //Report to UI via callback
                            callbacks.onChunkSent?.(meta.id, bytes)
                        },
                        (fileId, checkpoint) => {
                            socket.emit("transfer:checkpoint", {
                                fileId,
                                bytesReceived: checkpoint
                            })
                        }
                    )

                    // Notify receiver that file finished
                    channel.send(
                        JSON.stringify({
                            type: "file-done",
                            fileId: meta.id,
                        })
                    )

                    socket.emit("transfer:complete", {
                        fileId: meta.id,
                    })

                    callbacks.onFileComplete?.(meta.id)
                }
            }

            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)

            socket.emit("webrtc:offer", { offer })
        },
        [socket, createPeerConnection]
    )

    // --- RECEIVER SIDE: create answer when offer arrives ---
    const startAsReceiver = useCallback(() => {
        setConnectionState("connecting")
        const pc = createPeerConnection()

        pc.ondatachannel = (event) => {
            const channel = event.channel
            dataChannelRef.current = channel

            let currentReceiver: FileReceiver | null = null
            let currentFileId = ""

            channel.onopen = () => {
                console.log("[webrtc] data channel open (receiver)")
            }

            channel.onmessage = (event) => {
                // JSON control message
                if (typeof event.data === "string") {
                    const msg = JSON.parse(event.data)

                    if (msg.type === "file-meta") {
                        currentFileId = msg.fileId
                        currentReceiver = new FileReceiver(
                            msg.name,
                            msg.size,
                            msg.mimeType,
                            (bytes) => {
                                console.log(
                                    `[transfer] receiving ${msg.name}: ${bytes}/${msg.size}`
                                )
                            }
                        )
                    }

                    if (msg.type === "file-done" && currentReceiver) {
                        currentReceiver.assemble()
                        callbacks.onFileAssembled?.(currentFileId, currentReceiver)
                        callbacks.onFileComplete?.(currentFileId)
                        currentReceiver = null
                        currentFileId = ""
                    }
                } else {
                    // Binary chunk — just receive and report progress
                    // Never trigger completion here — wait for the "file-done" string message
                    // which is guaranteed to arrive after all chunks on an ordered DataChannel
                    if (currentReceiver) {
                        currentReceiver.receiveChunk(event.data as ArrayBuffer)
                        callbacks.onChunkSent?.(currentFileId, currentReceiver.getBytesReceived())
                    }
                }
            }
        }
    }, [createPeerConnection])

    // --- Handle incoming signaling events ---
    useEffect(() => {
        async function handleOffer({ offer }: { offer: RTCSessionDescriptionInit }) {
            // Receiver gets the offer — must have already called startAsReceiver
            // so pcRef.current exists
            const pc = pcRef.current
            if (!pc) return

            await pc.setRemoteDescription(offer)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            socket.emit("webrtc:answer", { answer })
        }

        async function handleAnswer({ answer }: { answer: RTCSessionDescriptionInit }) {
            // Sender gets the answer back
            const pc = pcRef.current
            if (!pc) return

            await pc.setRemoteDescription(answer)
        }

        async function handleIceCandidate({
            candidate,
        }: {
            candidate: RTCIceCandidateInit
        }) {
            const pc = pcRef.current
            if (!pc) return

            try {
                await pc.addIceCandidate(candidate)
            } catch (err) {
                console.error("[webrtc] failed to add ICE candidate:", err)
            }
        }

        socket.on("webrtc:offer", handleOffer)
        socket.on("webrtc:answer", handleAnswer)
        socket.on("webrtc:ice-candidate", handleIceCandidate)

        return () => {
            socket.off("webrtc:offer", handleOffer)
            socket.off("webrtc:answer", handleAnswer)
            socket.off("webrtc:ice-candidate", handleIceCandidate)
        }
    }, [socket])

    return {
        connectionState,
        startAsSender,
        startAsReceiver,
        dataChannelRef,
    }
}