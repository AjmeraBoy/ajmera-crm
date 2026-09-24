'use client'

/**
 * Singleton socket.io connection to the CRM real-time relay (mini-services/socket-service).
 *
 * IMPORTANT (environment contract, see examples/websocket/frontend.tsx):
 * - Connect with io('/?XTransformPort=3003') — the Caddy gateway routes on the
 *   XTransformPort query param; the socket.io path must stay '/'.
 * - withCredentials: true so the CRM session cookie reaches the relay, which
 *   validates it against /api/auth/validate-session on first 'subscribe'.
 */

import { useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { getAuthToken } from '@/lib/client'

let socket: Socket | null = null
let refCount = 0

export function getCrmSocket(): Socket {
  if (!socket) {
    socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnectionDelayMax: 10000,
      // Cookie-restricted contexts (cross-site preview iframe) block cookies,
      // so also hand the relay the Bearer session token. The function form is
      // re-evaluated on every (re)connect attempt.
      auth: (cb) => cb({ token: getAuthToken() ?? undefined }),
    })
  }
  return socket
}

/** Tear down the singleton (called after auth errors / logout so the next login re-handshakes). */
export function resetCrmSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  refCount = 0
}

// ---------- server event payload shapes ----------

export interface WaMessageEvent {
  message: {
    id: string
    conversationId?: string
    direction?: string
    type?: string
    body?: string | null
    mediaName?: string | null
    mediaUrl?: string | null
    status?: string
    templateName?: string | null
    createdAt?: string
    [key: string]: unknown
  }
  conversationId: string
  direction?: string
}

export interface WaStatusEvent {
  messageId: string
  status: string
  conversationId: string
}

export interface WaConversationEvent {
  conversationId: string
  phone?: string
  lastMessage?: string | null
  unreadCount?: number
}

export interface CallLeadInfo {
  id: string
  leadCode: string
  customerName: string
  mobile?: string | null
  department: string
  source?: string | null
  assignedTo?: string | null
}

export interface CallIncomingEvent {
  callId: string
  customerNumber?: string | null
  known: boolean
  lead?: CallLeadInfo | null
  agentExtension?: string | null
}

export interface CallUpdateEvent {
  callId: string
  callStatus?: string
  durationSec?: number
  answerAt?: string | null
  endAt?: string | null
}

export interface NotificationEvent {
  title?: string
  body?: string
  type?: string
}

/**
 * Mount the shared connection for this component tree. Returns live status.
 * On (re)connect it emits the base 'subscribe' handshake the relay expects.
 * 'auth-error' is surfaced as a window event ('crm:auth-error') so the app shell
 * can force a re-login without every consumer wiring its own handler.
 */
export function useCrmSocket(): boolean {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const s = getCrmSocket()
    refCount++

    const onConnect = () => {
      setConnected(true)
      s.emit('subscribe', { token: getAuthToken() ?? undefined })
    }
    const onDisconnect = () => setConnected(false)
    const onAuthError = () => {
      setConnected(false)
      window.dispatchEvent(new CustomEvent('crm:auth-error'))
    }

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)
    s.on('auth-error', onAuthError)
    if (s.connected) {
      setConnected(true)
      s.emit('subscribe', { token: getAuthToken() ?? undefined })
    }

    return () => {
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      s.off('auth-error', onAuthError)
      refCount--
      if (refCount <= 0) resetCrmSocket()
    }
  }, [])

  return connected
}

/** Join the live room of an open WhatsApp conversation. */
export function subscribeConversation(conversationId: string) {
  try {
    getCrmSocket().emit('subscribe', { conversationId })
  } catch {
    // socket not ready — polling fallback in the view keeps things working
  }
}

/** Leave the live room of a WhatsApp conversation. */
export function unsubscribeConversation(conversationId: string) {
  try {
    getCrmSocket().emit('unsubscribe-conversation', conversationId)
  } catch {
    // ignore
  }
}
