import { useState, useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { v4 as uuidv4 } from 'uuid'
import dynamic from 'next/dynamic'
import type { CodeOperation } from '../hooks/useWebRTC'
import { useWebRTC } from '../hooks/useWebRTC'

const CollabEditor = dynamic(() => import('../components/CollabEditor'), { ssr: false })
const VideoPiP = dynamic(() => import('../components/VideoPiP'), { ssr: false })

interface JoinRequest {
  requestId: string
  peerId: string
  username: string
}

export default function Home() {
  const [phase, setPhase] = useState<'join' | 'editor'>('join')
  const [mode, setMode] = useState<'pick' | 'create' | 'join'>('pick')
  const [roomId, setRoomId] = useState('')
  const [username, setUsername] = useState('')
  const [newRoomId] = useState(() => uuidv4().slice(0, 8))
  const [copied, setCopied] = useState(false)
  const [myPeerId] = useState(() => uuidv4())
  const [socket, setSocket] = useState<Socket | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [micActive, setMicActive] = useState(true)
  const [camActive, setCamActive] = useState(true)
  const [pipMinimized, setPipMinimized] = useState(false)
  const [incomingOp, setIncomingOp] = useState<CodeOperation | null>(null)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([])
  const [pendingApproval, setPendingApproval] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Create a private room or request access to one.')
  const [errorMessage, setErrorMessage] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const lastOpTs = useRef(0)

  const handleCodeOperation = useCallback((op: CodeOperation) => {
    if (op.timestamp === lastOpTs.current) return
    lastOpTs.current = op.timestamp
    setIncomingOp(op)
  }, [])

  const { broadcastOperation, remoteStreams, connectedPeers } = useWebRTC({
    socket,
    myPeerId,
    roomId,
    localStream,
    onCodeOperation: handleCodeOperation,
  })

  useEffect(() => {
    let active = true

    const init = async () => {
      await fetch('/api/socket')
      const s = io({ path: '/api/socket', transports: ['websocket'] })
      if (!active) {
        s.close()
        return
      }
      setSocket(s)
    }

    init()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    return () => {
      socket?.close()
    }
  }, [socket])

  useEffect(() => {
    if (!socket) return

    const handleJoinPending = ({ roomId: pendingRoomId }: { roomId: string }) => {
      setPendingApproval(true)
      setRoomId(pendingRoomId)
      setErrorMessage('')
      setStatusMessage(`Join request sent for room ${pendingRoomId}. Waiting for the admin's approval.`)
    }

    const handleJoinApproved = ({ roomId: approvedRoomId }: { roomId: string }) => {
      setPendingApproval(false)
      setRoomId(approvedRoomId)
      setPhase('editor')
      setStatusMessage(`Approved by the admin. You are now inside room ${approvedRoomId}.`)
    }

    const handleJoinRejected = ({ reason }: { roomId: string; reason: string }) => {
      setPendingApproval(false)
      setErrorMessage(reason)
      setStatusMessage('Your request was not accepted. You can try another room.')
    }

    const handleJoinRequest = (request: JoinRequest) => {
      setJoinRequests((prev) => [...prev.filter((item) => item.requestId !== request.requestId), request])
      setStatusMessage(`${request.username} is waiting for your approval to join room ${roomId}.`)
    }

    const handleJoinRequestResolved = ({ requestId }: { requestId: string }) => {
      setJoinRequests((prev) => prev.filter((item) => item.requestId !== requestId))
    }

    const handleRoomClosed = ({ reason }: { roomId: string; reason: string }) => {
      setPhase('join')
      setMode('pick')
      setRoomId('')
      setJoinRequests([])
      setPendingApproval(false)
      setIsAdmin(false)
      setErrorMessage(reason)
      setStatusMessage('The room was closed. You can create a new room or request access to another one.')
    }

    socket.on('join-pending', handleJoinPending)
    socket.on('join-approved', handleJoinApproved)
    socket.on('join-rejected', handleJoinRejected)
    socket.on('join-request', handleJoinRequest)
    socket.on('join-request-resolved', handleJoinRequestResolved)
    socket.on('room-closed', handleRoomClosed)

    return () => {
      socket.off('join-pending', handleJoinPending)
      socket.off('join-approved', handleJoinApproved)
      socket.off('join-rejected', handleJoinRejected)
      socket.off('join-request', handleJoinRequest)
      socket.off('join-request-resolved', handleJoinRequestResolved)
      socket.off('room-closed', handleRoomClosed)
    }
  }, [socket, roomId])

  const acquireMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      setLocalStream(stream)
      return stream
    } catch {
      console.warn('Media access denied — audio/video unavailable')
      return null
    }
  }, [])

  const handleToggleMic = () => {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled
    })
    setMicActive((value) => !value)
  }

  const handleToggleCam = () => {
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled
    })
    setCamActive((value) => !value)
  }

  const handleCreate = async () => {
    if (!socket || !username.trim()) return

    setErrorMessage('')
    await acquireMedia()

    socket.emit(
      'create-room',
      { roomId: newRoomId, peerId: myPeerId, username: username.trim() },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) {
          setErrorMessage(response.error ?? 'Unable to create the room right now.')
          return
        }

        setRoomId(newRoomId)
        setIsAdmin(true)
        setJoinRequests([])
        setPendingApproval(false)
        setStatusMessage(`Room ${newRoomId} is reserved for you until you leave it.`)
        setPhase('editor')
      }
    )
  }

  const handleJoinExisting = async () => {
    if (!socket || !roomId.trim() || !username.trim()) return

    setErrorMessage('')
    await acquireMedia()

    socket.emit(
      'request-join',
      { roomId: roomId.trim(), peerId: myPeerId, username: username.trim() },
      (response: { ok: boolean; error?: string }) => {
        if (!response.ok) {
          setPendingApproval(false)
          setErrorMessage(response.error ?? 'Unable to send the join request.')
        }
      }
    )
  }

  const handleApproveJoin = (requestId: string) => {
    if (!socket) return

    socket.emit('approve-join', { roomId, requestId }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) {
        setErrorMessage(response.error ?? 'Unable to approve this request.')
      }
    })
  }

  const handleRejectJoin = (requestId: string) => {
    if (!socket) return

    socket.emit('reject-join', { roomId, requestId }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) {
        setErrorMessage(response.error ?? 'Unable to reject this request.')
      }
    })
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(newRoomId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const peerNames = new Map(connectedPeers.map((peer) => [peer.peerId, peer.username]))

  if (phase === 'join') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
          fontFamily: '"Fira Code", monospace',
          padding: 20,
        }}
      >
        <div
          style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 12,
            padding: '40px 48px',
            width: 440,
            maxWidth: '92vw',
            boxShadow: '0 0 40px rgba(63,185,80,0.08)',
          }}
        >
          <div style={{ marginBottom: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 28, color: '#3fb950', letterSpacing: -1, fontWeight: 700 }}>{'</> collab'}</div>
            <div style={{ fontSize: 13, color: '#8b949e', marginTop: 4 }}>
              private room approval + node.js realtime broadcasting
            </div>
          </div>

          <div
            style={{
              marginBottom: 18,
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid #30363d',
              background: '#0d1117',
              fontSize: 12,
              color: '#8b949e',
              lineHeight: 1.6,
            }}
          >
            {statusMessage}
          </div>

          {errorMessage && (
            <div
              style={{
                marginBottom: 18,
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid #f85149',
                background: 'rgba(248,81,73,0.08)',
                fontSize: 12,
                color: '#ffb3ad',
              }}
            >
              {errorMessage}
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 6 }}>your name</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. Aysha"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 6,
                color: '#e6edf3',
                padding: '10px 12px',
                fontSize: 14,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {mode === 'pick' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                onClick={() => {
                  setErrorMessage('')
                  setMode('create')
                }}
                disabled={!username.trim()}
                style={{
                  background: '#238636',
                  border: '1px solid #2ea043',
                  borderRadius: 8,
                  color: '#fff',
                  padding: '14px',
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  opacity: !username.trim() ? 0.4 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                Create a Reserved Room
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: '#30363d' }} />
                <span style={{ fontSize: 11, color: '#6e7681' }}>or</span>
                <div style={{ flex: 1, height: 1, background: '#30363d' }} />
              </div>

              <button
                onClick={() => {
                  setErrorMessage('')
                  setMode('join')
                }}
                disabled={!username.trim()}
                style={{
                  background: '#21262d',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  color: '#58a6ff',
                  padding: '14px',
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  opacity: !username.trim() ? 0.4 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                Request to Join a Room
              </button>
            </div>
          )}

          {mode === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <button
                onClick={() => setMode('pick')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8b949e',
                  cursor: 'pointer',
                  fontSize: 12,
                  textAlign: 'left',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                ← back
              </button>

              <div style={{ background: '#0d1117', borderRadius: 8, padding: '14px 16px', border: '1px solid #30363d' }}>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>reserved room id</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 16, color: '#3fb950', fontWeight: 700, letterSpacing: 1 }}>{newRoomId}</span>
                  <button
                    onClick={handleCopy}
                    style={{
                      background: copied ? '#238636' : '#21262d',
                      border: '1px solid #30363d',
                      borderRadius: 6,
                      color: copied ? '#fff' : '#8b949e',
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontFamily: 'inherit',
                    }}
                  >
                    {copied ? 'copied!' : 'copy'}
                  </button>
                </div>
              </div>

              <button
                onClick={handleCreate}
                style={{
                  background: '#238636',
                  border: '1px solid #2ea043',
                  borderRadius: 8,
                  color: '#fff',
                  padding: '13px',
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                }}
              >
                Create Room & Start
              </button>
            </div>
          )}

          {mode === 'join' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <button
                onClick={() => {
                  setPendingApproval(false)
                  setMode('pick')
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8b949e',
                  cursor: 'pointer',
                  fontSize: 12,
                  textAlign: 'left',
                  padding: 0,
                  fontFamily: 'inherit',
                }}
              >
                ← back
              </button>

              <div>
                <label style={{ fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 6 }}>room id</label>
                <input
                  value={roomId}
                  onChange={(event) => setRoomId(event.target.value)}
                  placeholder="e.g. a1b2c3d4"
                  autoFocus
                  disabled={pendingApproval}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: 6,
                    color: '#e6edf3',
                    padding: '10px 12px',
                    fontSize: 14,
                    outline: 'none',
                    fontFamily: 'inherit',
                    opacity: pendingApproval ? 0.65 : 1,
                  }}
                  onKeyDown={(event) => event.key === 'Enter' && handleJoinExisting()}
                />
              </div>

              <button
                onClick={handleJoinExisting}
                disabled={!roomId.trim() || pendingApproval}
                style={{
                  background: pendingApproval ? '#30363d' : '#1f6feb',
                  border: '1px solid #388bfd',
                  borderRadius: 8,
                  color: '#fff',
                  padding: '13px',
                  fontSize: 14,
                  cursor: pendingApproval ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  opacity: !roomId.trim() ? 0.4 : 1,
                }}
              >
                {pendingApproval ? 'Waiting for Admin Approval...' : 'Send Join Request'}
              </button>
            </div>
          )}

          {mode === 'pick' && (
            <div
              style={{
                marginTop: 20,
                padding: '12px',
                background: '#0d1117',
                borderRadius: 6,
                fontSize: 11,
                color: '#8b949e',
                lineHeight: 1.7,
              }}
            >
              <div style={{ marginBottom: 4, color: '#6e7681' }}>security flow</div>
              {'• room id stays reserved while admin is inside\n• join requests wait for admin approval\n• code changes broadcast through node.js socket server'.split('\n').map((line, index) => (
                <div key={index}>{line}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          background: '#010409',
          borderBottom: '1px solid #21262d',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 14, color: '#3fb950', fontFamily: 'monospace', fontWeight: 700 }}>{'</>'}</span>
        <span style={{ fontSize: 13, color: '#8b949e', fontFamily: 'monospace' }}>collab</span>
        <div style={{ width: 1, height: 16, background: '#21262d' }} />
        <span style={{ fontSize: 12, color: '#6e7681' }}>room:</span>
        <span style={{ fontSize: 12, color: '#e6edf3', fontFamily: 'monospace' }}>{roomId}</span>
        <span
          style={{
            fontSize: 11,
            color: isAdmin ? '#3fb950' : '#58a6ff',
            border: '1px solid #30363d',
            borderRadius: 999,
            padding: '2px 8px',
          }}
        >
          {isAdmin ? 'admin' : 'approved member'}
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {connectedPeers.map((peer) => (
            <div
              key={peer.peerId}
              style={{
                background: '#21262d',
                borderRadius: 20,
                padding: '2px 10px',
                fontSize: 11,
                color: '#3fb950',
                border: '1px solid #30363d',
              }}
            >
              {peer.username}
            </div>
          ))}
          <div
            style={{
              background: '#21262d',
              borderRadius: 20,
              padding: '2px 10px',
              fontSize: 11,
              color: '#58a6ff',
              border: '1px solid #30363d',
            }}
          >
            {username} (you)
          </div>
        </div>
      </div>

      {(statusMessage || errorMessage || (isAdmin && joinRequests.length > 0)) && (
        <div style={{ padding: 14, borderBottom: '1px solid #21262d', background: '#0b1220' }}>
          {statusMessage && (
            <div
              style={{
                marginBottom: errorMessage || (isAdmin && joinRequests.length > 0) ? 10 : 0,
                padding: '10px 12px',
                borderRadius: 8,
                background: '#111827',
                border: '1px solid #1f2937',
                color: '#cbd5e1',
                fontSize: 12,
              }}
            >
              {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                marginBottom: isAdmin && joinRequests.length > 0 ? 10 : 0,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(248,81,73,0.08)',
                border: '1px solid #f85149',
                color: '#ffb3ad',
                fontSize: 12,
              }}
            >
              {errorMessage}
            </div>
          )}

          {isAdmin && joinRequests.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {joinRequests.map((request) => (
                <div
                  key={request.requestId}
                  style={{
                    minWidth: 240,
                    background: '#111827',
                    border: '1px solid #374151',
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <div style={{ fontSize: 13, color: '#e5e7eb', marginBottom: 6 }}>{request.username}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10 }}>
                    wants to join your private room
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleApproveJoin(request.requestId)}
                      style={{
                        flex: 1,
                        background: '#238636',
                        border: '1px solid #2ea043',
                        borderRadius: 8,
                        color: '#fff',
                        padding: '8px 10px',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleRejectJoin(request.requestId)}
                      style={{
                        flex: 1,
                        background: '#21262d',
                        border: '1px solid #f85149',
                        borderRadius: 8,
                        color: '#ffb3ad',
                        padding: '8px 10px',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CollabEditor myPeerId={myPeerId} broadcastOperation={broadcastOperation} incomingOp={incomingOp} />
      </div>

      <VideoPiP
        localStream={localStream}
        remoteStreams={remoteStreams}
        peerNames={peerNames}
        minimized={pipMinimized}
        onToggle={() => setPipMinimized((value) => !value)}
        micActive={micActive}
        camActive={camActive}
        onToggleMic={handleToggleMic}
        onToggleCam={handleToggleCam}
      />
    </div>
  )
}
