// hooks/useWebRTC.ts
// Core WebRTC logic:
//   - RTCPeerConnection per remote peer
//   - DataChannel for code operations (sub-50ms latency)
//   - MediaStream for video/audio in PiP corner
import { useEffect, useRef, useCallback, useState } from 'react'
import { Socket } from 'socket.io-client'

export interface CodeOperation {
  type: 'insert' | 'delete' | 'replace' | 'cursor' | 'language' | 'file-switch'
  position?: number
  text?: string
  length?: number
  cursor?: { line: number; column: number }
  language?: string
  filePath?: string
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
  const makingOffer = useRef<Set<string>>(new Set())

  const negotiateConnection = useCallback(
    async (remotePeerId: string, connection: RTCPeerConnection) => {
      if (!socket || makingOffer.current.has(remotePeerId) || connection.signalingState !== 'stable') return

      try {
        makingOffer.current.add(remotePeerId)
        const offer = await connection.createOffer()
        await connection.setLocalDescription(offer)
        socket.emit('offer', { to: remotePeerId, offer: connection.localDescription, from: myPeerId })
      } finally {
        makingOffer.current.delete(remotePeerId)
      }
    },
    [socket, myPeerId]
  )

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
      connection.onnegotiationneeded = async () => {
        await negotiateConnection(remotePeerId, connection)
      }

      const peerState: PeerState = { peerId: remotePeerId, username, connection }
      peers.current.set(remotePeerId, peerState)
      return peerState
    },
    [socket, myPeerId, localStream, negotiateConnection]
  )

  // ── Initiate connection (caller) ──────────────────────────────────────────
  const initiateCall = useCallback(
    async (remotePeerId: string, username: string) => {
      const peerState = createPeerConnection(remotePeerId, username)
      await negotiateConnection(remotePeerId, peerState.connection)
    },
    [createPeerConnection, negotiateConnection]
  )

  // ── Handle incoming offer (callee) ────────────────────────────────────────
  const handleOffer = useCallback(
    async ({ from, offer, username }: { from: string; offer: RTCSessionDescriptionInit; username?: string }) => {
      const peerState = peers.current.get(from) ?? createPeerConnection(from, username ?? 'Guest')

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
    if (!localStream) return

    peers.current.forEach((peer) => {
      const senders = peer.connection.getSenders()

      localStream.getTracks().forEach((track) => {
        const existingSender = senders.find((sender) => sender.track?.kind === track.kind)
        if (!existingSender) {
          peer.connection.addTrack(track, localStream)
          return
        }

        if (existingSender.track?.id !== track.id) {
          void existingSender.replaceTrack(track)
        }
      })
    })
  }, [localStream])

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
