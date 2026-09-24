/**
 * Real-time event relay client.
 * Next.js API routes POST events to the socket.io mini service (port 3003),
 * which broadcasts them to connected CRM clients.
 *
 * Rooms:
 *  - user:<userId>      → events for one agent
 *  - role:<ROLE>        → events for a role group
 *  - conversation:<id>  → live chat updates for an open conversation
 *  - call               → live call events (incoming call popups etc.)
 *  - all                → global broadcast
 *
 * The socket service runs on 127.0.0.1:3003 and only accepts emit requests
 * carrying the shared INTERNAL_EVENT_SECRET header (never exposed to browsers).
 */

const SOCKET_URL = process.env.SOCKET_SERVICE_URL || 'http://127.0.0.1:3004'
const SECRET = process.env.INTERNAL_EVENT_SECRET || 'dev-internal-secret'

export type CommSocketEvent =
  | { room: string; event: 'whatsapp:new-message'; data: Record<string, unknown> }
  | { room: string; event: 'whatsapp:status'; data: Record<string, unknown> }
  | { room: string; event: 'whatsapp:conversation'; data: Record<string, unknown> }
  | { room: string; event: 'call:incoming'; data: Record<string, unknown> }
  | { room: string; event: 'call:update'; data: Record<string, unknown> }
  | { room: string; event: 'lead:update'; data: Record<string, unknown> }
  | { room: string; event: 'notification'; data: Record<string, unknown> }
  | { room: string; event: 'health:update'; data: Record<string, unknown> }

export async function emitSocketEvent(payload: CommSocketEvent): Promise<void> {
  try {
    await fetch(`${SOCKET_URL}/emit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    })
  } catch (e) {
    // Real-time is best-effort: never break the main flow because of it.
    console.error('[socket-emit-fail]', e instanceof Error ? e.message : e)
  }
}

export async function emitMany(events: CommSocketEvent[]): Promise<void> {
  if (events.length === 0) return
  try {
    await fetch(`${SOCKET_URL}/emit-many`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': SECRET,
      },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (e) {
    console.error('[socket-emit-many-fail]', e instanceof Error ? e.message : e)
  }
}
