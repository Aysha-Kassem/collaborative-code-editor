# Collaborative Code Editor

A real-time collaborative code editor built with `Next.js`, `Socket.IO`, `WebRTC`, and the `Monaco Editor`.

## Course Information

This project was developed for the `Distributed Systems & Web Services` course under the supervision of `Dr. Abdelghafar Shenaway`.

## Team

- Aysha Ahmed Kassem
- Nada Khamis Etman
- Maryam Ahmed Elsayed
- Mohamed Kamal Mohamed
- ABDELRHMAN MOUSTAFA SALEM

## Overview

The application allows users to create private coding rooms, request access to existing rooms, collaborate on code in real time, and communicate through peer-to-peer audio/video streams.

## Features

- Real-time code synchronization using `Socket.IO`
- Conflict handling with Operational Transform (`OT`)
- Private room creation and room reservation
- Admin approval and rejection flow for join requests
- Multi-user remote cursor support
- Audio and video communication with `WebRTC`
- Monaco-based code editing experience
- Floating picture-in-picture video component
- Syntax highlighting for multiple languages

## Tech Stack

- `Next.js`
- `React`
- `TypeScript`
- `Socket.IO`
- `WebRTC`
- `@monaco-editor/react`
- `PM2`
- `Nginx`

## Project Structure

```text
collaborative-code-editor/
├── components/
│   ├── CollabEditor.tsx
│   ├── RemoteCursors.tsx
│   └── VideoPiP.tsx
├── hooks/
│   └── useWebRTC.ts
├── lib/
│   └── ot.ts
├── pages/
│   ├── api/
│   │   └── socket.ts
│   ├── _app.tsx
│   └── index.tsx
├── styles/
│   └── globals.css
├── deploy-oracle.sh
├── ecosystem.config.js
└── README.md
```

## How It Works

### Collaboration Flow

1. An admin creates a private room.
2. The room ID becomes reserved while the admin remains inside the room.
3. Another user submits a join request.
4. The admin approves or rejects the request.
5. Authorized users receive real-time code updates through `Socket.IO`.
6. Audio/video signaling is exchanged through the server, while media flows directly through `WebRTC`.

### Editing Flow

1. A user types in the Monaco editor.
2. The app computes the difference between the previous and current code.
3. The diff is converted into OT operations.
4. The operation is sent to the server.
5. The server broadcasts it to approved room members.
6. Peers transform and apply the operation locally.

## Local Development

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run dev
```

### Open in the browser

```text
http://localhost:3000
```

## Production Deployment

### Live URL

- `https://collab-editor.ddns.net`

### Server Setup

The project is currently deployed on an Oracle Cloud Ubuntu instance and served through:

- `PM2` for process management
- `Nginx` as a reverse proxy
- `Let's Encrypt` for HTTPS

### Deploy Script

The repository includes an automated deployment script:

```bash
./deploy-oracle.sh
```

This script:

- builds the app locally
- syncs the required files to the Oracle server
- installs production dependencies on the server
- restarts the app with `PM2`

## Running the App Manually in Production

### Build

```bash
npm run build
```

### Start

```bash
HOSTNAME=0.0.0.0 PORT=3000 npm start
```

### PM2

```bash
pm2 start ecosystem.config.js
pm2 save
```

## STUN / TURN Notes

The project uses public Google STUN servers by default. For stricter NAT environments, a TURN server should be added in [useWebRTC.ts](/Users/AyshaKassem/Desktop/Web/collaborative%20code%20editor/hooks/useWebRTC.ts).

Example configuration:

```ts
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:your-turn-server.com:3478',
    username: 'user',
    credential: 'password',
  },
]
```

## Future Improvements

- Replace OT with a CRDT-based approach such as `Yjs`
- Add a text chat channel
- Add sandboxed code execution
- Add a file tree sidebar
- Add export or GitHub Gist integration
