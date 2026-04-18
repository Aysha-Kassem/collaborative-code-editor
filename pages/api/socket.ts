// pages/api/socket.ts
// Signaling server for WebRTC — handles offer/answer/ICE candidates via Socket.IO
import type { NextApiRequest, NextApiResponse } from 'next'
import { Server as ServerIO } from 'socket.io'
import { Server as NetServer } from 'http'
import type { Socket as NetSocket } from 'net'

interface SocketServer extends NetServer {
  io?: ServerIO
}
interface SocketWithIO extends NetSocket {
  server: SocketServer
}
interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO
}

interface RoomMember {
  socketId: string
  peerId: string
  username: string
}

interface RoomState {
  roomId: string
  adminSocketId: string
  members: Map<string, RoomMember>
  pending: Map<string, RoomMember>
}

const rooms = new Map<string, RoomState>()

export const config = { api: { bodyParser: false } }

export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.io) {
    const io = new ServerIO(res.socket.server as any, {
      path: '/api/socket',
      addTrailingSlash: false,
      cors: { origin: '*' },
    })
    res.socket.server.io = io

    const getRoomPeers = (room: RoomState, excludeSocketId?: string) =>
      [...room.members.values()]
        .filter((member) => member.socketId !== excludeSocketId)
        .map(({ peerId, username }) => ({ peerId, username }))

    const findMemberSocketId = (room: RoomState, peerId: string) => {
      const member = [...room.members.values()].find((item) => item.peerId === peerId)
      return member?.socketId
    }

    const cleanupRoomIfEmpty = (roomId: string) => {
      const room = rooms.get(roomId)
      if (!room) return
      if (room.members.size === 0 && room.pending.size === 0) {
        rooms.delete(roomId)
      }
    }

    io.on('connection', (socket) => {
      socket.on(
        'create-room',
        (
          { roomId, peerId, username }: { roomId: string; peerId: string; username: string },
          callback?: (response: { ok: boolean; error?: string }) => void
        ) => {
          const normalizedRoomId = roomId.trim()
          const normalizedUsername = username.trim()

          if (!normalizedRoomId || !normalizedUsername) {
            callback?.({ ok: false, error: 'Room ID and username are required.' })
            return
          }

          if (rooms.has(normalizedRoomId)) {
            callback?.({ ok: false, error: 'This room ID is already reserved right now.' })
            return
          }

          const adminMember: RoomMember = { socketId: socket.id, peerId, username: normalizedUsername }
          const room: RoomState = {
            roomId: normalizedRoomId,
            adminSocketId: socket.id,
            members: new Map([[socket.id, adminMember]]),
            pending: new Map(),
          }

          rooms.set(normalizedRoomId, room)
          socket.join(normalizedRoomId)
          socket.data.roomId = normalizedRoomId
          socket.data.peerId = peerId
          socket.data.username = normalizedUsername
          socket.data.isAdmin = true

          socket.emit('room-peers', [])
          callback?.({ ok: true })
        }
      )

      socket.on(
        'request-join',
        (
          { roomId, peerId, username }: { roomId: string; peerId: string; username: string },
          callback?: (response: { ok: boolean; error?: string }) => void
        ) => {
          const normalizedRoomId = roomId.trim()
          const normalizedUsername = username.trim()
          const room = rooms.get(normalizedRoomId)

          if (!normalizedUsername) {
            callback?.({ ok: false, error: 'Username is required.' })
            return
          }

          if (!room) {
            callback?.({ ok: false, error: 'This room does not exist or has already been closed.' })
            return
          }

          if (room.members.has(socket.id) || room.pending.has(socket.id)) {
            callback?.({ ok: false, error: 'You already have an active request for this room.' })
            return
          }

          const pendingMember: RoomMember = { socketId: socket.id, peerId, username: normalizedUsername }
          room.pending.set(socket.id, pendingMember)
          socket.data.requestedRoomId = normalizedRoomId
          socket.data.peerId = peerId
          socket.data.username = normalizedUsername

          io.to(room.adminSocketId).emit('join-request', {
            requestId: socket.id,
            peerId,
            username: normalizedUsername,
          })
          socket.emit('join-pending', { roomId: normalizedRoomId })
          callback?.({ ok: true })
        }
      )

      socket.on(
        'approve-join',
        (
          { roomId, requestId }: { roomId: string; requestId: string },
          callback?: (response: { ok: boolean; error?: string }) => void
        ) => {
          const room = rooms.get(roomId)
          if (!room || room.adminSocketId !== socket.id) {
            callback?.({ ok: false, error: 'Only the room admin can approve join requests.' })
            return
          }

          const pendingMember = room.pending.get(requestId)
          const requesterSocket = io.sockets.sockets.get(requestId)
          if (!pendingMember || !requesterSocket) {
            room.pending.delete(requestId)
            callback?.({ ok: false, error: 'The join request is no longer active.' })
            return
          }

          room.pending.delete(requestId)
          room.members.set(requestId, pendingMember)
          requesterSocket.join(room.roomId)
          requesterSocket.data.roomId = room.roomId
          requesterSocket.data.requestedRoomId = undefined
          requesterSocket.data.peerId = pendingMember.peerId
          requesterSocket.data.username = pendingMember.username
          requesterSocket.data.isAdmin = false

          requesterSocket.emit('join-approved', { roomId: room.roomId })
          requesterSocket.emit('room-peers', getRoomPeers(room, requestId))
          socket.emit('join-request-resolved', { requestId })
          requesterSocket.to(room.roomId).emit('peer-joined', {
            peerId: pendingMember.peerId,
            username: pendingMember.username,
          })
          callback?.({ ok: true })
        }
      )

      socket.on(
        'reject-join',
        (
          { roomId, requestId }: { roomId: string; requestId: string },
          callback?: (response: { ok: boolean; error?: string }) => void
        ) => {
          const room = rooms.get(roomId)
          if (!room || room.adminSocketId !== socket.id) {
            callback?.({ ok: false, error: 'Only the room admin can reject join requests.' })
            return
          }

          const pendingMember = room.pending.get(requestId)
          if (!pendingMember) {
            callback?.({ ok: false, error: 'The join request is no longer active.' })
            return
          }

          room.pending.delete(requestId)
          io.to(requestId).emit('join-rejected', {
            roomId,
            reason: 'The admin rejected your join request.',
          })
          socket.emit('join-request-resolved', { requestId })
          cleanupRoomIfEmpty(roomId)
          callback?.({ ok: true })
        }
      )

      socket.on('code-operation', ({ roomId, op }: { roomId: string; op: Record<string, unknown> }) => {
        const room = rooms.get(roomId)
        if (!room || !room.members.has(socket.id)) return

        socket.to(roomId).emit('code-operation', {
          ...op,
          from: socket.data.peerId,
          timestamp: Date.now(),
        })
      })

      // ── WebRTC signaling ───────────────────────────────────────────────────
      socket.on(
        'offer',
        ({ to, offer, from }: { to: string; offer: RTCSessionDescriptionInit; from: string }) => {
          const roomId = socket.data.roomId
          if (!roomId) return
          const room = rooms.get(roomId)
          if (!room) return
          const targetSocketId = findMemberSocketId(room, to)
          if (!targetSocketId) return
          io.to(targetSocketId).emit('offer', { from, offer, username: socket.data.username })
        }
      )

      socket.on(
        'answer',
        ({ to, answer, from }: { to: string; answer: RTCSessionDescriptionInit; from: string }) => {
          const roomId = socket.data.roomId
          if (!roomId) return
          const room = rooms.get(roomId)
          if (!room) return
          const targetSocketId = findMemberSocketId(room, to)
          if (!targetSocketId) return
          io.to(targetSocketId).emit('answer', { from, answer })
        }
      )

      socket.on(
        'ice-candidate',
        ({ to, candidate, from }: { to: string; candidate: RTCIceCandidateInit; from: string }) => {
          const roomId = socket.data.roomId
          if (!roomId) return
          const room = rooms.get(roomId)
          if (!room) return
          const targetSocketId = findMemberSocketId(room, to)
          if (!targetSocketId) return
          io.to(targetSocketId).emit('ice-candidate', { from, candidate })
        }
      )

      socket.on('disconnecting', () => {
        const roomId = socket.data.roomId as string | undefined
        const requestedRoomId = socket.data.requestedRoomId as string | undefined
        const peerId = socket.data.peerId as string | undefined

        if (requestedRoomId) {
          const room = rooms.get(requestedRoomId)
          if (room?.pending.delete(socket.id)) {
            io.to(room.adminSocketId).emit('join-request-resolved', { requestId: socket.id })
            cleanupRoomIfEmpty(requestedRoomId)
          }
        }

        if (!roomId) return
        const room = rooms.get(roomId)
        if (!room) return

        if (room.adminSocketId === socket.id) {
          room.pending.forEach((member) => {
            io.to(member.socketId).emit('join-rejected', {
              roomId,
              reason: 'The admin left before approving your request.',
            })
          })
          socket.to(roomId).emit('room-closed', {
            roomId,
            reason: 'The admin left, so the room was closed and the ID is available again.',
          })
          rooms.delete(roomId)
          return
        }

        if (room.members.delete(socket.id)) {
          socket.to(roomId).emit('peer-left', { peerId })
        }
        cleanupRoomIfEmpty(roomId)
      })
    })
  }

  res.end()
}
