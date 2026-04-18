// hooks/useWebRTC.ts
// Core WebRTC logic:
//   - RTCPeerConnection per remote peer
//   - DataChannel for code operations (sub-50ms latency)
//   - MediaStream for video/audio in PiP corner
import { useEffect, useRef, useCallback, useState } from 'react'
import { Socket } from 'socket.io-client'

export interface CodeOperation {
  type: 'insert' | 'delete' | 'replace' | 'cursor' | 'language'
  position?: number
  text?: string
  length?: number
  cursor?: { line: number; column: number }
  language?: string
  from: string
  timestamp: number
}

interface PeerState {
  peerId: string
  username: string
  connection: RTCPeerConnection
  videoRef?: HTMLVideoElement
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

interface UseWebRTCProps {
  socket: Socket | null
  myPeerId: string
  roomId: string
  localStream: MediaStream | null
  onCodeOperation: (op: CodeOperation) => void
}

export function useWebRTC({ socket, myPeerId, roomId, localStream, onCodeOperation }: UseWebRTCProps) {
  const peers = useRef<Map<string, PeerState>>(new Map())
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [connectedPeers, setConnectedPeers] = useState<{ peerId: string; username: string }[]>([])

  // ── Create RTCPeerConnection for a given remote peer ──────────────────────
  const createPeerConnection = useCallback(
    (remotePeerId: string, username: string): PeerState => {
      const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS })

      // Add local tracks so remote sees our video/audio
      if (localStream) {
        localStream.getTracks().forEach((track) => connection.addTrack(track, localStream))
      }

      // Receive remote tracks → update remoteStreams state
      connection.ontrack = (event) => {
        const [stream] = event.streams
        setRemoteStreams((prev) => new Map(prev).set(remotePeerId, stream))
      }

      // ICE candidate → relay via signaling server
      connection.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('ice-candidate', { to: remotePeerId, candidate: event.candidate.toJSON(), from: myPeerId })
        }
      }

      connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') {
          cleanupPeer(remotePeerId)
        }
      }

      const peerState: PeerState = { peerId: remotePeerId, username, connection }
      peers.current.set(remotePeerId, peerState)
      return peerState
    },
    [socket, myPeerId, localStream]
  )

  // ── Initiate connection (caller) ──────────────────────────────────────────
  const initiateCall = useCallback(
    async (remotePeerId: string, username: string) => {
      const peerState = createPeerConnection(remotePeerId, username)

      const offer = await peerState.connection.createOffer()
      await peerState.connection.setLocalDescription(offer)
      socket?.emit('offer', { to: remotePeerId, offer: peerState.connection.localDescription, from: myPeerId })
    },
    [createPeerConnection, socket, myPeerId]
  )

  // ── Handle incoming offer (callee) ────────────────────────────────────────
  const handleOffer = useCallback(
    async ({ from, offer, username }: { from: string; offer: RTCSessionDescriptionInit; username?: string }) => {
      const peerState = createPeerConnection(from, username ?? 'Guest')

      await peerState.connection.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await peerState.connection.createAnswer()
      await peerState.connection.setLocalDescription(answer)
      socket?.emit('answer', { to: from, answer: peerState.connection.localDescription, from: myPeerId })
    },
    [createPeerConnection, socket, myPeerId]
  )

  const handleAnswer = useCallback(async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
    const peer = peers.current.get(from)
    if (peer) await peer.connection.setRemoteDescription(new RTCSessionDescription(answer))
  }, [])

  const handleIceCandidate = useCallback(async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
    const peer = peers.current.get(from)
    if (peer) await peer.connection.addIceCandidate(new RTCIceCandidate(candidate))
  }, [])

  // ── Broadcast a code operation to ALL connected peers ─────────────────────
  const broadcastOperation = useCallback((op: Omit<CodeOperation, 'from' | 'timestamp'>) => {
    if (!socket || !roomId) return
    socket.emit('code-operation', { roomId, op })
  }, [socket, roomId])

  const cleanupPeer = (peerId: string) => {
    const peer = peers.current.get(peerId)
    if (peer) {
      peer.connection.close()
      peers.current.delete(peerId)
      setRemoteStreams((prev) => { const m = new Map(prev); m.delete(peerId); return m })
      setConnectedPeers((prev) => prev.filter((p) => p.peerId !== peerId))
    }
  }

  // ── Wire up socket events ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return

    socket.on('room-peers', (peerList: { peerId: string; username: string }[]) => {
      setConnectedPeers(peerList)
      peerList.forEach(({ peerId, username }) => {
        if (!peers.current.has(peerId)) initiateCall(peerId, username)
      })
    })

    socket.on('peer-joined', ({ peerId, username }: { peerId: string; username: string }) => {
      setConnectedPeers((prev) => [...prev.filter((p) => p.peerId !== peerId), { peerId, username }])
    })

    socket.on('peer-left', ({ peerId }: { peerId: string }) => cleanupPeer(peerId))
    socket.on('offer', handleOffer)
    socket.on('answer', handleAnswer)
    socket.on('ice-candidate', handleIceCandidate)
    socket.on('code-operation', onCodeOperation)

    return () => {
      socket.off('room-peers')
      socket.off('peer-joined')
      socket.off('peer-left')
      socket.off('offer')
      socket.off('answer')
      socket.off('ice-candidate')
      socket.off('code-operation')
    }
  }, [socket, initiateCall, handleOffer, handleAnswer, handleIceCandidate, onCodeOperation])

  return { broadcastOperation, remoteStreams, connectedPeers }
}
