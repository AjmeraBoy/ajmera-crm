import { createServer } from 'http'
import { Server, type Socket } from 'socket.io'

/**
 * CRM Real-time Relay Service (port 3003)
 *
 * Responsibilities:
 * 1. Browser clients connect via socket.io (through the Caddy gateway:
 *    io('/?XTransformPort=3003')). Sessions are validated against the CRM
 *    backend using the CRM session cookie — unauthenticated clients are
 *    disconnected immediately.
 * 2. CRM backend (Next.js API) publishes events via authenticated internal
 *    HTTP endpoints (/emit, /emit-many) protected by INTERNAL_EVENT_SECRET.
 *
 * Rooms:
 *   user:<userId>       → notifications for one agent
 *   role:<ROLE>         → role broadcasts
 *   whatsapp            → live chat list updates
 *   conversation:<id>   → live messages for an open conversation (validated)
 *   call                → call lifecycle events (incoming call popups)
 *   all                 → global
 */

const PORT = 3003
const INTERNAL_PORT = 3004 // internal publish API (localhost-only, not exposed via gateway)
const INTERNAL_SECRET = process.env.INTERNAL_EVENT_SECRET || 'dev-internal-secret'
const CRM_BASE = process.env.CRM_BASE_URL || 'http://127.0.0.1:3000'

const httpServer = createServer()

const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  pingTimeout: 60000,
  pingInterval: 25000,
})

type SessionInfo = { id: string; name: string; role: string; department: string | null }

/**
 * Validate a browser session against the CRM backend.
 * Identity sources, in priority order:
 *   1. Bearer token (socket.io handshake `auth.token` or subscribe payload) —
 *      used when the browser blocks cookies (cross-site preview iframe).
 *   2. Forwarded `Cookie` header from the socket.io handshake.
 */
async function validateSession(token: string | undefined, cookieHeader: string | undefined): Promise<SessionInfo | null> {
  if (!token && !cookieHeader) return null
  const headers: Record<string, string> = { 'x-internal-secret': INTERNAL_SECRET }
  if (token) headers.authorization = `Bearer ${token}`
  else headers.cookie = cookieHeader as string
  try {
    const res = await fetch(`${CRM_BASE}/api/auth/validate-session`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { user?: SessionInfo }
    return data.user ?? null
  } catch {
    return null
  }
}

async function validateConversationRoom(user: SessionInfo, conversationId: string): Promise<boolean> {
  try {
    const res = await fetch(`${CRM_BASE}/api/comm/validate-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ userId: user.id, role: user.role, department: user.department, conversationId }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { allowed?: boolean }
    return data.allowed === true
  } catch {
    return false
  }
}

io.on('connection', (socket: Socket) => {
  let session: SessionInfo | null = null

  socket.on('subscribe', async (data: { rooms?: string[]; conversationId?: string; token?: string }, ack?: (res: unknown) => void) => {
    if (!session) {
      // Validate on first subscribe — Bearer token first, cookie fallback
      const rawCookie = (socket.request as { headers?: Record<string, string | undefined> }).headers?.cookie
      const handshakeToken = (socket.handshake.auth as { token?: string } | undefined)?.token
      session = await validateSession(data?.token || handshakeToken, rawCookie)
      if (!session) {
        socket.emit('auth-error', { message: 'Session invalid. Please login again.' })
        socket.disconnect(true)
        return
      }
      socket.data.user = session
      // Base rooms
      socket.join(`user:${session.id}`)
      socket.join('whatsapp')
      socket.join('call')
      if (session.department) socket.join(`dept:${session.department}`)
      if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(session.role)) socket.join('management')
    }

    const rooms: string[] = []
    for (const r of data?.rooms ?? []) {
      if (r.startsWith('user:') && r === `user:${session.id}`) rooms.push(r)
      else if (r === 'whatsapp' || r === 'call') rooms.push(r)
      else if (r.startsWith('role:')) {
        if (['SUPER_ADMIN', 'ADMIN'].includes(session.role)) rooms.push(r)
      }
    }
    if (data?.conversationId) {
      const ok = await validateConversationRoom(session, data.conversationId)
      if (ok) {
        const room = `conversation:${data.conversationId}`
        socket.join(room)
        rooms.push(room)
      } else {
        socket.emit('subscribe-error', { conversationId: data.conversationId, message: 'Not allowed' })
      }
    }
    ack?.({ ok: true, rooms, user: session })
  })

  socket.on('unsubscribe-conversation', (conversationId: string) => {
    if (typeof conversationId === 'string') socket.leave(`conversation:${conversationId}`)
  })

  socket.on('error', (e) => console.error('[socket-error]', socket.id, e))
  socket.on('disconnect', () => {})
})

// ---------- internal publish API (CRM backend only) ----------

type EmitPayload = { room: string; event: string; data: unknown }

function authorized(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const h = req.headers['x-internal-secret']
  const value = Array.isArray(h) ? h[0] : h
  return value === INTERNAL_SECRET
}

function sanitizeRoom(room: string): string | null {
  if (typeof room !== 'string') return null
  if (!/^[a-zA-Z0-9:_-]{1,120}$/.test(room)) return null
  return room
}

function handleEmit(req: { headers: Record<string, string | string[] | undefined> }, res: { writeHead: (n: number, h?: Record<string, string>) => void; end: (s?: string) => void }, many: boolean) {
  if (!authorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  const chunks: Buffer[] = []
  const readable = req as unknown as { on: (ev: string, cb: (c?: Buffer) => void) => void }
  readable.on('data', (c) => c && chunks.push(c))
  readable.on('end', () => {
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const events: EmitPayload[] = many ? (parsed.events ?? []) : [parsed]
      let delivered = 0
      for (const ev of events) {
        const room = sanitizeRoom(ev.room)
        if (!room || typeof ev.event !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(ev.event)) continue
        io.to(room).emit(ev.event, ev.data)
        delivered++
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, delivered }))
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad payload' }))
    }
  })
}

httpServer.listen(PORT, () => {
  console.log(`[socket-service] websocket listening on :${PORT}`)
})

// ---------- internal HTTP server (localhost only) ----------

const internalServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'socket-relay', connections: io.engine.clientsCount, uptimeSec: Math.round(process.uptime()) }))
    return
  }
  if (req.url === '/emit' && req.method === 'POST') return handleEmit(req, res, false)
  if (req.url === '/emit-many' && req.method === 'POST') return handleEmit(req, res, true)
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

internalServer.listen(INTERNAL_PORT, '127.0.0.1', () => {
  console.log(`[socket-service] internal publish API on 127.0.0.1:${INTERNAL_PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
  internalServer.close()
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
  internalServer.close()
})
