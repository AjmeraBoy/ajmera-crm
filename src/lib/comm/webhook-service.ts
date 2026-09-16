import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { notify } from '@/lib/api'
import { emitSocketEvent } from './socket'
import { ensureConversation, findConversationByPhone, findLeadByPhone } from './conversation'
import { normalizePhone } from './whatsapp'
import { runAutomations } from './automation'
import { markWebhookReceived } from './settings'
import { redactSecrets } from './crypto'

/**
 * WebhookService — production webhook processing for WhatsApp + Voice events.
 *
 * DESIGN:
 * - IDEMPOTENT: every event gets a dedupeKey (hash of provider + type + ids).
 *   Duplicate deliveries are recorded with status DUPLICATE and never
 *   create duplicate messages/call logs.
 * - NORMALIZER: accepts WhatsApp Cloud API format (Meta/Alendei BSP standard)
 *   and common flat variants. Raw payloads are always archived in
 *   WebhookEvent.payload for audit/debug.
 * - FAIL-SAFE: unknown formats are stored as UNRECOGNIZED (surfaced in the
 *   health dashboard) instead of failing the webhook with 500.
 */

export type WebhookProcessResult = {
  status: 'PROCESSED' | 'DUPLICATE' | 'FAILED' | 'UNRECOGNIZED'
  detail: string
  eventId?: string
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 48)
}

// ---------- WhatsApp ----------

type NormInbound = {
  kind: 'message'
  phone: string
  profileName?: string
  waMessageId: string
  type: 'TEXT' | 'IMAGE' | 'PDF' | 'VIDEO' | 'VOICE' | 'LOCATION' | 'OTHER'
  body?: string
  mediaUrl?: string
  mediaName?: string
  timestamp?: Date
}

type NormStatus = {
  kind: 'status'
  waMessageId: string
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  timestamp?: Date
  errorCode?: string
  errorMessage?: string
  recipient?: string
}

type NormW = NormInbound | NormStatus | { kind: 'unknown'; reason: string }

/** Normalize a WhatsApp webhook payload (Cloud API format + flat variants). */
export function normalizeWhatsappPayload(payload: Record<string, unknown>): NormW {
  // --- Meta WhatsApp Cloud API format: { entry: [ { changes: [ { value: { messages, statuses } } ] } ] }
  const entry = payload.entry as Array<Record<string, unknown>> | undefined
  if (Array.isArray(entry)) {
    for (const e of entry) {
      const changes = e.changes as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(changes)) continue
      for (const ch of changes) {
        const value = ch.value as Record<string, unknown> | undefined
        if (!value) continue
        const messages = value.messages as Array<Record<string, unknown>> | undefined
        if (Array.isArray(messages) && messages.length > 0) {
          const m = messages[0]
          const from = String(m.from ?? '')
          const contact = (value.contacts as Array<Record<string, unknown>> | undefined)?.[0]
          const profile = ((contact?.profile as Record<string, unknown> | undefined)?.wa_id ?? (contact?.profile as Record<string,unknown>|undefined)?.name) as string | undefined
          const name = (contact?.profile as Record<string, unknown> | undefined)?.name as string | undefined
          const waType = String(m.type ?? 'text').toUpperCase()
          let type: NormInbound['type'] = 'OTHER'
          let body: string | undefined
          let mediaUrl: string | undefined
          let mediaName: string | undefined
          if (waType === 'TEXT') {
            type = 'TEXT'
            body = String((m.text as Record<string, unknown> | undefined)?.body ?? '')
          } else if (['IMAGE', 'DOCUMENT', 'VIDEO', 'AUDIO', 'VOICE', 'STICKER'].includes(waType)) {
            const med = m[waType.toLowerCase()] as Record<string, unknown> | undefined
            type = waType === 'DOCUMENT' ? 'PDF' : waType === 'AUDIO' ? 'VOICE' : (waType as NormInbound['type'])
            mediaName = String(med?.filename ?? med?.id ?? 'media')
            mediaUrl = String(med?.link ?? med?.id ?? '')
          } else if (waType === 'LOCATION') {
            const loc = m.location as Record<string, unknown> | undefined
            type = 'LOCATION'
            body = [loc?.name, loc?.address].filter(Boolean).map(String).join(', ') || 'Location shared'
          }
          return {
            kind: 'message',
            phone: from,
            profileName: (name ?? profile) as string | undefined,
            waMessageId: String(m.id ?? sha(JSON.stringify(m)).slice(0, 24)),
            type,
            body,
            mediaUrl,
            mediaName,
            timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : undefined,
          }
        }
        const statuses = value.statuses as Array<Record<string, unknown>> | undefined
        if (Array.isArray(statuses) && statuses.length > 0) {
          const st = statuses[0]
          const raw = String(st.status ?? '').toUpperCase()
          const err = (st.errors as Array<Record<string, unknown>> | undefined)?.[0]
          const status = (['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(raw) ? raw : 'SENT') as NormStatus['status']
          return {
            kind: 'status',
            waMessageId: String(st.id ?? ''),
            status,
            timestamp: st.timestamp ? new Date(Number(st.timestamp) * 1000) : undefined,
            errorCode: err ? String(err.code ?? err.title ?? '') : undefined,
            errorMessage: err ? String(err.message ?? err.title ?? '') : undefined,
            recipient: st.recipient_id ? String(st.recipient_id) : undefined,
          }
        }
      }
    }
  }

  // --- Flat variant: { from / phone / wa_id, message / text, id / message_id, type }
  const from = (payload.from ?? payload.phone ?? payload.phone_number ?? payload.wa_id) as string | undefined
  const text = (payload.text ?? (payload.message as Record<string, unknown> | undefined)?.text ?? (payload.message as string | undefined)) as string | string[] | undefined
  const id = (payload.id ?? payload.message_id ?? payload.messageId ?? payload.wamid) as string | undefined
  const status = (payload.status ?? payload.message_status) as string | undefined
  if (typeof status === 'string' && id) {
    const raw = status.toUpperCase()
    if (['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(raw)) {
      return { kind: 'status', waMessageId: String(id), status: raw as NormStatus['status'], recipient: from ? String(from) : undefined }
    }
  }
  if (from && (text || payload.media || payload.image)) {
    let body: string | undefined
    if (typeof text === 'string') body = text
    else if (Array.isArray(text)) body = text.join(' ')
    else if (text && typeof text === 'object') body = String((text as Record<string, unknown>).body ?? '')
    return {
      kind: 'message',
      phone: String(from),
      profileName: (payload.name ?? payload.profileName ?? payload.sender_name) as string | undefined,
      waMessageId: String(id ?? sha(JSON.stringify(payload)).slice(0, 24)),
      type: 'TEXT',
      body: body ?? 'Media message',
      mediaUrl: (payload.mediaUrl ?? payload.media_url) as string | undefined,
      mediaName: (payload.mediaName ?? payload.media_name) as string | undefined,
    }
  }
  return { kind: 'unknown', reason: 'Payload did not match Cloud API or flat message/status formats' }
}

/** Process POST /api/webhooks/whatsapp payload. Idempotent. */
export async function processWhatsappWebhook(
  payload: Record<string, unknown>,
  ip?: string
): Promise<WebhookProcessResult> {
  await markWebhookReceived()

  // Hub verification (Meta-style GET is handled by the route; some providers POST verify too)
  if (payload.hub_challenge) {
    return { status: 'PROCESSED', detail: 'verification challenge acknowledged' }
  }

  const norm = normalizeWhatsappPayload(payload)
  const rawJson = redactSecrets(JSON.stringify(payload))

  // Idempotency key: provider message id + kind; fallback: full payload hash
  const idsForHash =
    norm.kind === 'message' ? `msg:${norm.waMessageId}` : norm.kind === 'status' ? `status:${norm.waMessageId}:${norm.status}` : `raw:${sha(rawJson)}`
  const dedupeKey = sha(`whatsapp:${idsForHash}`)

  const existing = await db.webhookEvent.findUnique({ where: { dedupeKey } })
  if (existing && existing.processingStatus === 'PROCESSED') {
    return { status: 'DUPLICATE', detail: 'Event already processed (idempotent).', eventId: existing.id }
  }

  const event = existing
    ? await db.webhookEvent.update({ where: { id: existing.id }, data: { payload: rawJson, ip, processingStatus: 'RECEIVED' } })
    : await db.webhookEvent.create({
        data: {
          dedupeKey,
          provider: 'WHATSAPP',
          eventType: norm.kind === 'message' ? 'MESSAGE' : norm.kind === 'status' ? 'MESSAGE_STATUS' : 'UNKNOWN',
          eventId: norm.kind !== 'unknown' ? norm.waMessageId : undefined,
          payload: rawJson,
          processingStatus: 'RECEIVED',
          ip: ip ?? null,
        },
      })

  try {
    if (norm.kind === 'unknown') {
      await db.webhookEvent.update({
        where: { id: event.id },
        data: { processingStatus: 'UNRECOGNIZED', error: norm.reason, processedAt: new Date() },
      })
      return { status: 'UNRECOGNIZED', detail: norm.reason, eventId: event.id }
    }

    if (norm.kind === 'message') {
      const detail = await handleInboundMessage(norm)
      await db.webhookEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: 'PROCESSED',
          processedAt: new Date(),
          leadId: detail.leadId,
          phoneNumber: normalizePhone(norm.phone),
          waId: normalizePhone(norm.phone),
          eventType: 'MESSAGE',
        },
      })
      return { status: 'PROCESSED', detail: detail.summary, eventId: event.id }
    }

    // status
    const detail = await handleStatusEvent(norm)
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { processingStatus: 'PROCESSED', processedAt: new Date(), eventType: 'MESSAGE_STATUS' },
    })
    return { status: 'PROCESSED', detail, eventId: event.id }
  } catch (e) {
    const msg = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 500)
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { processingStatus: 'FAILED', error: msg, processedAt: new Date() },
    })
    console.error('[webhook-whatsapp-fail]', e)
    return { status: 'FAILED', detail: msg, eventId: event.id }
  }
}

async function handleInboundMessage(m: NormInbound): Promise<{ summary: string; leadId: string | null }> {
  const ctx = await ensureConversation(m.phone, {
    name: m.profileName ?? null,
    autoCreateLead: true,
  })
  const convId = ctx.conversation.id
  const now = m.timestamp ?? new Date()

  // Duplicate WhatsApp message guard (same waMessageId already stored)
  const dupMessage = m.waMessageId
    ? await db.whatsAppMessage.findFirst({ where: { providerMessageId: m.waMessageId, direction: 'IN' } })
    : null
  if (dupMessage) return { summary: 'Duplicate inbound message ignored (idempotent).', leadId: ctx.conversation.leadId }

  const message = await db.whatsAppMessage.create({
    data: {
      conversationId: convId,
      direction: 'IN',
      type: m.type,
      body: m.body ?? null,
      mediaUrl: m.mediaUrl ?? null,
      mediaName: m.mediaName ?? null,
      providerMessageId: m.waMessageId || null,
      status: 'SENT',
      sentAt: now,
      createdAt: now,
    },
  })

  const conv = await db.whatsAppConversation.update({
    where: { id: convId },
    data: {
      unreadCount: { increment: 1 },
      lastMessage: (m.body ?? m.mediaName ?? '[media]').slice(0, 300),
      lastMessageAt: now,
      lastInboundAt: now,
    },
  })

  let leadId = ctx.conversation.leadId
  if (!leadId && ctx.created) {
    // conversation created without lead (autoCreateLead false) — try to attach now
    const lead = await findLeadByPhone(m.phone)
    if (lead) {
      await db.whatsAppConversation.update({ where: { id: convId }, data: { leadId: lead.id } })
      leadId = lead.id
    }
  }

  if (leadId) {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: { optInStatus: true, optInAt: true },
    })
    await db.lead.update({
      where: { id: leadId },
      data: {
        lastWaMessage: (m.body ?? m.mediaName ?? '[media]').slice(0, 200),
        lastWaMessageAt: now,
        lastWaDirection: 'IN',
        lastContactAt: now,
        waStatus: 'AVAILABLE',
        ...(lead && lead.optInStatus !== 'OPTED_IN'
          ? { optInStatus: 'OPTED_IN', optInAt: now, optInSource: 'INBOUND_MESSAGE' }
          : {}),
      },
    })
    await db.activity.create({
      data: {
        leadId,
        type: 'WHATSAPP',
        title: 'WhatsApp message received',
        description: (m.body ?? m.mediaName ?? '[media]').slice(0, 160),
      },
    })
  }

  // Real-time: conversation room + owner + role broadcast
  const events: Parameters<typeof emitSocketEvent>[0][] = [
    { room: `conversation:${convId}`, event: 'whatsapp:new-message', data: { message, conversationId: convId, direction: 'IN' } },
    { room: 'whatsapp', event: 'whatsapp:conversation', data: { conversationId: convId, phone: conv.phone, lastMessage: conv.lastMessage, unreadCount: conv.unreadCount } },
  ]
  for (const ev of events) await emitSocketEvent(ev)

  if (ctx.conversation.ownerId) {
    await notify(
      ctx.conversation.ownerId,
      'New WhatsApp message',
      `${conv.phone}: ${(m.body ?? m.mediaName ?? '[media]').slice(0, 80)}`,
      'WHATSAPP'
    )
    await emitSocketEvent({
      room: `user:${ctx.conversation.ownerId}`,
      event: 'notification',
      data: { title: 'New WhatsApp message', body: `${conv.phone}: ${(m.body ?? m.mediaName ?? '[media]').slice(0, 80)}`, type: 'WHATSAPP' },
    })
  }

  // Automation engine
  await runAutomations('INBOUND_WHATSAPP', {
    leadId,
    conversationId: convId,
    phone: conv.phone,
    messageBody: m.body,
  })

  return {
    summary: ctx.created ? 'New lead + conversation created; message stored.' : 'Message stored in existing conversation.',
    leadId: leadId ?? null,
  }
}

async function handleStatusEvent(s: NormStatus): Promise<string> {
  if (!s.waMessageId) return 'Status event without message id — recorded only.'
  const msg = await db.whatsAppMessage.findFirst({ where: { providerMessageId: s.waMessageId } })
  if (!msg) return `No CRM message matches provider id ${s.waMessageId}.`
  const patch: Record<string, unknown> = { status: s.status }
  if (s.status === 'SENT') patch.sentAt = s.timestamp ?? new Date()
  if (s.status === 'DELIVERED') patch.deliveredAt = s.timestamp ?? new Date()
  if (s.status === 'READ') {
    patch.readAt = s.timestamp ?? new Date()
    patch.deliveredAt = msg.deliveredAt ?? s.timestamp ?? new Date()
  }
  if (s.status === 'FAILED') {
    patch.failedAt = new Date()
    patch.errorCode = s.errorCode
    patch.errorMessage = s.errorMessage ?? 'Message failed at provider'
  }
  const updated = await db.whatsAppMessage.update({ where: { id: msg.id }, data: patch })
  await emitSocketEvent({
    room: `conversation:${msg.conversationId}`,
    event: 'whatsapp:status',
    data: { messageId: msg.id, status: s.status, conversationId: msg.conversationId },
  })
  if (s.status === 'FAILED') {
    await runAutomations('WHATSAPP_FAILED', { leadId: (await db.whatsAppConversation.findUnique({ where: { id: msg.conversationId }, select: { leadId: true } }))?.leadId ?? null, messageId: msg.id })
  }
  return `Message ${msg.id} → ${updated.status}.`
}

// ---------- Voice / SIP ----------

export type VoiceEvent = {
  callId?: string
  event: string // ringing | answered | ended | missed | hold | unhold | recording | transfer
  customerNumber?: string
  agentNumber?: string
  agentExtension?: string
  direction?: 'INCOMING' | 'OUTGOING'
  durationSec?: number
  recordingUrl?: string
  timestamp?: string
}

/** Normalize common voice/SIP webhook payloads into a VoiceEvent. */
export function normalizeVoicePayload(payload: Record<string, unknown>): VoiceEvent | null {
  const ev = (payload.event ?? payload.event_type ?? payload.type ?? payload.status ?? payload.CallStatus) as string | undefined
  if (!ev) return null
  const callId = (payload.call_id ?? payload.callId ?? payload.CallSid ?? payload.call_sid ?? payload.uuid ?? payload.id) as string | undefined
  const customer = (payload.customer_number ?? payload.customerNumber ?? payload.from ?? payload.From ?? payload.caller_number ?? payload.customer) as string | undefined
  const agent = (payload.agent_number ?? payload.agentNumber ?? payload.to ?? payload.To ?? payload.agent ?? payload.extension) as string | undefined
  const direction = (payload.direction ?? payload.call_direction) as string | undefined
  const duration = (payload.duration_sec ?? payload.durationSec ?? payload.duration ?? payload.call_duration) as number | string | undefined
  const recording = (payload.recording_url ?? payload.recordingUrl ?? payload.RecordingUrl ?? payload.recording) as string | undefined
  const normEv = String(ev).toLowerCase().replace(/[\s-]+/g, '_')
  return {
    callId: callId ? String(callId) : undefined,
    event: normEv,
    customerNumber: customer ? String(customer) : undefined,
    agentNumber: agent ? String(agent) : undefined,
    agentExtension: (payload.agent_extension ?? payload.agentExtension) as string | undefined,
    direction: direction ? (String(direction).toUpperCase().includes('IN') ? 'INCOMING' : 'OUTGOING') : undefined,
    durationSec: duration !== undefined ? Math.max(0, Math.round(Number(duration) || 0)) : undefined,
    recordingUrl: recording ? String(recording) : undefined,
    timestamp: (payload.timestamp as string | undefined) ?? undefined,
  }
}

/** Process POST /api/webhooks/voice payload. Idempotent. */
export async function processVoiceWebhook(payload: Record<string, unknown>, ip?: string): Promise<WebhookProcessResult> {
  await markWebhookReceived()
  const voice = normalizeVoicePayload(payload)
  const rawJson = redactSecrets(JSON.stringify(payload))
  const evName = voice?.event ?? 'unknown'

  const dedupeKey = sha(`voice:${voice?.callId ?? 'nocall'}:${evName}:${voice?.timestamp ?? sha(rawJson)}`)
  const existing = await db.webhookEvent.findUnique({ where: { dedupeKey } })
  if (existing && existing.processingStatus === 'PROCESSED') {
    return { status: 'DUPLICATE', detail: 'Voice event already processed.', eventId: existing.id }
  }

  const event = existing
    ? await db.webhookEvent.update({ where: { id: existing.id }, data: { payload: rawJson, ip, processingStatus: 'RECEIVED' } })
    : await db.webhookEvent.create({
        data: {
          dedupeKey,
          provider: 'VOICE',
          eventType: 'CALL_EVENT',
          eventId: voice?.callId,
          payload: rawJson,
          processingStatus: 'RECEIVED',
          ip: ip ?? null,
        },
      })

  try {
    if (!voice) {
      await db.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: 'UNRECOGNIZED', error: 'No recognizable voice event field', processedAt: new Date() } })
      return { status: 'UNRECOGNIZED', detail: 'Payload did not contain a voice event type.', eventId: event.id }
    }
    const summary = await handleVoiceEvent(voice)
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { processingStatus: 'PROCESSED', processedAt: new Date() },
    })
    return { status: 'PROCESSED', detail: summary, eventId: event.id }
  } catch (e) {
    const msg = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 500)
    await db.webhookEvent.update({ where: { id: event.id }, data: { processingStatus: 'FAILED', error: msg, processedAt: new Date() } })
    console.error('[webhook-voice-fail]', e)
    return { status: 'FAILED', detail: msg, eventId: event.id }
  }
}

async function leadInfoFor(leadId: string | null) {
  if (!leadId) return null
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, leadCode: true, customerName: true, mobile: true, department: true,
      source: { select: { label: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  })
  if (!lead) return null
  return {
    id: lead.id,
    leadCode: lead.leadCode,
    customerName: lead.customerName,
    mobile: lead.mobile,
    department: lead.department,
    source: lead.source?.label ?? null,
    assignedTo: lead.assignedTo?.name ?? null,
  }
}

async function handleVoiceEvent(v: VoiceEvent): Promise<string> {
  const now = new Date()
  const ev = v.event
  let call = v.callId
    ? await db.callLog.findFirst({ where: { providerCallId: v.callId } })
    : null

  // Inbound call that we have not seen before → create call log + popup
  if (!call && (['incoming', 'inbound', 'ringing', 'offer', 'dial_in'].includes(ev) || v.direction === 'INCOMING')) {
    const customerNumber = v.customerNumber ?? ''
    const lead = customerNumber ? await findLeadByPhone(customerNumber) : null
    const agentUser = v.agentNumber
      ? await db.user.findFirst({ where: { OR: [{ phone: v.agentNumber }, { sipExtension: v.agentNumber.replace(/\D/g, '') }] } })
      : null
    call = await db.callLog.create({
      data: {
        leadId: lead?.id ?? null,
        userId: agentUser?.id ?? null,
        direction: 'INCOMING',
        status: 'NOT_CONNECTED',
        callStatus: 'RINGING',
        providerCallId: v.callId ?? null,
        customerNumber: customerNumber || null,
        agentNumber: v.agentNumber ?? null,
        channel: 'SIP',
        startAt: now,
      },
    })
    const leadInfo = await leadInfoFor(lead?.id ?? null)
    await emitSocketEvent({
      room: 'call',
      event: 'call:incoming',
      data: {
        callId: call.id,
        providerCallId: call.providerCallId,
        customerNumber,
        known: Boolean(leadInfo),
        lead: leadInfo,
        agentExtension: v.agentExtension ?? v.agentNumber ?? null,
      },
    })
    if (lead?.id) {
      await db.activity.create({ data: { leadId: lead.id, type: 'CALL', title: 'Incoming call ringing', description: `From ${customerNumber}` } })
    }
    return `Incoming call logged (${call.id})${leadInfo ? ' — matched lead ' + leadInfo.leadCode : ' — NEW CALLER'}.`
  }

  if (!call) {
    // Outbound lifecycle events arrive for calls created by click-to-call.
    // If still unknown, ignore silently (already deduped in WebhookEvent).
    return `No matching call for provider id ${v.callId ?? 'n/a'} — event recorded.`
  }

  switch (ev) {
    case 'ringing':
    case 'outgoing_ringing':
    case 'dialing': {
      await db.callLog.update({ where: { id: call.id }, data: { callStatus: 'RINGING', startAt: call.startAt ?? now } })
      await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, callStatus: 'RINGING' } })
      return 'Call ringing.'
    }
    case 'answered':
    case 'answer':
    case 'connected':
    case 'in_progress':
    case 'start': {
      await db.callLog.update({ where: { id: call.id }, data: { callStatus: 'IN_PROGRESS', answerAt: now, status: 'CONNECTED' } })
      await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, callStatus: 'IN_PROGRESS', answerAt: now.toISOString() } })
      return 'Call answered.'
    }
    case 'hold': {
      await db.callLog.update({ where: { id: call.id }, data: { callStatus: 'ON_HOLD' } })
      await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, callStatus: 'ON_HOLD' } })
      return 'Call on hold.'
    }
    case 'unhold':
    case 'resume': {
      await db.callLog.update({ where: { id: call.id }, data: { callStatus: 'IN_PROGRESS' } })
      await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, callStatus: 'IN_PROGRESS' } })
      return 'Call resumed.'
    }
    case 'transfer': {
      const to = v.agentExtension ?? v.agentNumber ?? null
      await db.callLog.update({ where: { id: call.id }, data: { transferedTo: to } })
      await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, transferedTo: to } })
      return `Call transferred to ${to ?? 'unknown'}.`
    }
    case 'recording':
    case 'recording_ready':
    case 'recording_completed': {
      if (v.recordingUrl) {
        await db.callLog.update({ where: { id: call.id }, data: { recordingUrl: v.recordingUrl } })
        return 'Recording URL stored.'
      }
      return 'Recording event without URL.'
    }
    case 'ended':
    case 'completed':
    case 'hangup':
    case 'finish': {
      const answerAt = call.answerAt
      const duration = v.durationSec ?? (answerAt ? Math.round((now.getTime() - answerAt.getTime()) / 1000) : 0)
      const connected = duration > 0 || Boolean(answerAt)
      await db.callLog.update({
        where: { id: call.id },
        data: {
          callStatus: 'COMPLETED',
          endAt: now,
          durationSec: duration,
          status: connected ? 'CONNECTED' : 'NOT_CONNECTED',
        },
      })
      await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, callStatus: 'COMPLETED', durationSec: duration } })
      if (call.leadId) {
        const m = Math.floor(duration / 60), s = duration % 60
        await db.activity.create({
          data: {
            leadId: call.leadId,
            userId: call.userId,
            type: 'CALL',
            title: `${call.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'} call completed${duration > 0 ? ` — ${m > 0 ? `${m}m ${s}s` : `${s}s`}` : ''}`,
          },
        })
        await db.lead.update({ where: { id: call.leadId }, data: { lastContactAt: now } })
      }
      await runAutomations('CALL_COMPLETED', { leadId: call.leadId, callId: call.id, connected })
      return 'Call completed.'
    }
    case 'missed':
    case 'no_answer':
    case 'busy':
    case 'rejected':
    case 'failed':
    case 'cancel': {
      await db.callLog.update({
        where: { id: call.id },
        data: { callStatus: 'MISSED', status: 'MISSED', endAt: now },
      })
      await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, callStatus: 'MISSED' } })
      if (call.leadId) {
        await db.activity.create({ data: { leadId: call.leadId, userId: call.userId, type: 'CALL', title: `Call ${ev.replace('_', ' ')} — missed` } })
      }
      if (['missed', 'no_answer'].includes(ev)) {
        await runAutomations('CALL_MISSED', { leadId: call.leadId, callId: call.id })
      }
      return `Call ${ev}.`
    }
    default:
      return `Unhandled voice event "${ev}" recorded.`
  }
}
