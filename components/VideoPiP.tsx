// components/VideoPiP.tsx
// Picture-in-Picture video panel — floats in the corner of the editor.
// Shows local stream + up to 3 remote streams in a stacked layout.
import { useEffect, useRef } from 'react'

interface VideoTileProps {
  stream: MediaStream | null
  muted?: boolean
  label: string
}

function VideoTile({ stream, muted = false, label }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', background: '#111', flexShrink: 0 }}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#7d8590',
            fontSize: 11,
            background: 'linear-gradient(135deg, #101623 0%, #0f172a 100%)',
          }}
        >
          media off
        </div>
      )}
      <span style={{
        position: 'absolute', bottom: 4, left: 6,
        fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.55)',
        padding: '1px 5px', borderRadius: 3
      }}>{label}</span>
    </div>
  )
}

interface VideoPiPProps {
  localStream: MediaStream | null
  remoteStreams: Map<string, MediaStream>
  peerNames: Map<string, string>
  minimized: boolean
  onToggle: () => void
  micActive: boolean
  camActive: boolean
  onToggleMic: () => void
  onToggleCam: () => void
}

export default function VideoPiP({
  localStream, remoteStreams, peerNames, minimized, onToggle,
  micActive, camActive, onToggleMic, onToggleCam
}: VideoPiPProps) {
  const remoteEntries = [...remoteStreams.entries()].slice(0, 3)

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 100,
      display: 'flex', flexDirection: 'column', gap: 6,
      boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
      borderRadius: 10, overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      {/* Header bar */}
      <div style={{
        background: '#1a1a2e', padding: '5px 10px',
        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'
      }} onClick={onToggle}>
        <span style={{ fontSize: 11, color: '#9990ff', fontWeight: 500 }}>
          {remoteEntries.length > 0 ? `${remoteEntries.length + 1} participants` : 'Video'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#666' }}>{minimized ? '▲' : '▼'}</span>
      </div>

      {!minimized && (
        <div style={{
          background: '#0d0d1a',
          display: 'grid',
          gridTemplateColumns: remoteEntries.length ? '1fr 1fr' : '1fr',
          gap: 4, padding: 6,
          width: remoteEntries.length ? 280 : 160,
        }}>
          <div style={{ height: 120 }}>
            <VideoTile stream={localStream} muted label="You" />
          </div>
          {remoteEntries.map(([peerId, stream]) => (
            <div key={peerId} style={{ height: 120 }}>
              <VideoTile stream={stream} label={peerNames.get(peerId) ?? peerId.slice(0, 6)} />
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      {!minimized && (
        <div style={{
          background: '#1a1a2e', padding: '5px 10px',
          display: 'flex', gap: 8, justifyContent: 'center'
        }}>
          <button
            onClick={onToggleMic}
            title={micActive ? 'Mute mic' : 'Enable mic'}
            style={{
              background: micActive ? '#2d2d4e' : '#c0392b',
              border: 'none', borderRadius: 6, padding: '4px 10px',
              color: '#fff', fontSize: 14, cursor: 'pointer'
            }}>
            {micActive ? '🎙️' : '🔇'}
          </button>
          <button
            onClick={onToggleCam}
            title={camActive ? 'Stop camera' : 'Enable camera'}
            style={{
              background: camActive ? '#2d2d4e' : '#c0392b',
              border: 'none', borderRadius: 6, padding: '4px 10px',
              color: '#fff', fontSize: 14, cursor: 'pointer'
            }}>
            {camActive ? '📷' : '🚫'}
          </button>
        </div>
      )}
    </div>
  )
}
