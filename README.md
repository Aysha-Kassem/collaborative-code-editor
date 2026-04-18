# 🚀 Collaborative Code Editor

محرر أكواد مشترك في الوقت الفعلي باستخدام **Next.js** + **Socket.IO** + **WebRTC**.

---

## ⚡ المميزات

| الميزة | التقنية |
|--------|---------|
| مزامنة الكود لحظياً | Socket.IO عبر Node.js server |
| دمج التعديلات المتعارضة | Operational Transform (OT) |
| مؤشرات المستخدمين الآخرين | Monaco Decorations API |
| فيديو وصوت | WebRTC MediaStream |
| نافذة فيديو عائمة | Picture-in-Picture component |
| دعم لغات متعددة | Monaco + Syntax Highlighting |
| كتم الصوت/إيقاف الكاميرا | MediaTrack.enabled toggle |
| روم خاص ومحجوز | Room ID reservation while admin is inside |
| موافقة على الانضمام | Admin approve/reject join requests |

---

## 🛠️ التثبيت والتشغيل

```bash
# 1. تثبيت الحزم
npm install

# 2. تشغيل في وضع التطوير
npm run dev

# 3. افتح المتصفح
# http://localhost:3000
```

---

## 📐 هيكل المشروع

```
collab-editor/
├── pages/
│   ├── index.tsx          # صفحة الدخول + واجهة المحرر الكاملة
│   └── api/
│       └── socket.ts      # Room security + Socket.IO signaling/broadcast
├── components/
│   ├── CollabEditor.tsx   # Monaco Editor + OT integration
│   ├── VideoPiP.tsx       # نافذة الفيديو العائمة
│   └── RemoteCursors.tsx  # مؤشرات المستخدمين الآخرين
├── hooks/
│   └── useWebRTC.ts       # RTCPeerConnection + DataChannel + MediaStream
└── lib/
    └── ot.ts              # Operational Transform engine
```

---

## 🔄 كيف يعمل

```
Browser A                     Node.js / Socket.IO                    Browser B
   │                                  │                                 │
   │── create-room / request-join ───►│                                 │
   │                                  │── approve / reject flow ───────►│
   │── code-operation ───────────────►│── broadcast to room members ───►│
   │                                  │                                 │
   │──── offer / answer / ICE ───────►│──── relay to target peer ──────►│
   │◄────────────────────────────── WebRTC media channel ───────────────►│
```

### تسلسل التعديل:
1. المستخدم يكتب في Monaco
2. `onChange` يُنتج diff بين النص القديم والجديد
3. `diffToOps()` يحوّل الـ diff لعملية OT
4. `Socket.IO` يرسل العملية إلى Node.js server
5. السيرفر يعمل broadcast لكل أعضاء الروم المصرح لهم فقط
6. الـ peer يستقبل العملية ويطبّق `transformOp()` ثم `applyOp()`

---

## 🔐 Security Flow

1. الـ admin فقط هو اللي يقدر ينشئ الغرفة.
2. بمجرد إنشاء الغرفة، `roomId` يبقى محجوز ومحدش يقدر ينشئ نفس الرقم.
3. أي مستخدم يريد الدخول يرسل `request-join`.
4. المستخدم يظل في حالة انتظار لحد ما الـ admin يعمل `approve` أو `reject`.
5. لو الـ admin خرج، الغرفة تقفل ويتفك الحجز.

---

## 🌐 النشر على سيرفر Node.js حقيقي

### 1. على السيرفر

```bash
git clone <your-repo>
cd collaborative-code-editor
npm install
npm run build
```

### 2. تشغيل مباشر

```bash
HOSTNAME=0.0.0.0 PORT=3000 npm start
```

### 3. تشغيل دائم باستخدام PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 4. ربط دومين أو IP عبر Nginx

اعمل reverse proxy إلى:

```txt
http://127.0.0.1:3000
```

مهم:
- افتح بورت `80` و`443`.
- لو هتجرب WebRTC من خارج الشبكة، استخدم `https`.
- لو المستخدمين على شبكات مقفولة، أضف TURN server بجانب STUN.

---

## 🔒 STUN/TURN

الكود يستخدم Google STUN servers مجاناً:
- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

للشبكات المحجوبة (NAT صارم)، أضف TURN server في `hooks/useWebRTC.ts`:
```typescript
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:your-turn-server.com:3478',
    username: 'user',
    credential: 'password',
  },
]
```

---

## 💡 تحسينات مستقبلية

- [ ] CRDT (Yjs) بدلاً من OT للدقة الأعلى
- [ ] Chat text channel
- [ ] Code execution (sandboxed)
- [ ] File tree sidebar
- [ ] GitHub Gist export
