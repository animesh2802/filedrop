"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { getSocket } from "./socket"

// Google's public STUN server — free, no signup needed
// In production you'd usually add more than one for redundancy
const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
]

type ConnectionState = "idle" | "connecting" | "connected" | "failed"

export function useWebRTC(role: "sender" | "receiver") {
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
    const startAsSender = useCallback(async () => {
        setConnectionState("connecting")
        const pc = createPeerConnection()

        // Create the DataChannel BEFORE the offer
        // Creating it is what triggers ICE negotiation to begin
        const channel = pc.createDataChannel("file-transfer", {
            ordered: true, // chunks must arrive in order — see our earlier discussion
        })
        dataChannelRef.current = channel

        channel.onopen = () => {
            console.log("[webrtc] data channel open (sender)")
        }

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        socket.emit("webrtc:offer", { offer })
    }, [socket, createPeerConnection])

    // --- RECEIVER SIDE: create answer when offer arrives ---
    const startAsReceiver = useCallback(() => {
        setConnectionState("connecting")
        const pc = createPeerConnection()

        // The receiver doesn't create the DataChannel — it RECEIVES one
        // This event fires when the sender's channel reaches us
        pc.ondatachannel = (event) => {
            const channel = event.channel
            dataChannelRef.current = channel

            channel.onopen = () => {
                console.log("[webrtc] data channel open (receiver)")
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