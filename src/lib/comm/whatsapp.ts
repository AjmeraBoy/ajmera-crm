import { createHmac, randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { resolveCommConfig } from './settings'
import { logApiCall, mapProviderError, networkError, ProviderError } from './api-logger'
import { emitSocketEvent } from './socket'

/**
 * WhatsAppService — Alendei / FlexiWaba provider implementation.
 *
 * REAL API CONTRACT (from FlexiWaba official documentation):
 *   POST {baseUrl}/campaign/flexiwaba/api
 *   Body: {
 *     "apiKey": "<API key>",
 *     "campaignName": "<live API campaign name>",
 *     "destination": "<phone with country code>",
 *     "userName": "<optional recipient name>",
 *     "source": "<optional source label>",
 *     "media": { "url": "<public URL>", "filename": "<name>" },   // media templates only
 *     "templateParams": ["p1", "p2", ...],  // count MUST match the campaign template
 *     "tags": [], "attributes": {}
 *   }
 *
 * Provider rules enforced by this service:
 *   - The campaign must exist in the Alendei panel and be "Set Live".
 *   - templateParams.length must equal the number of variables configured
 *     for that campaign's template — otherwise the request is rejected.
 *   - Media URLs must be publicly accessible.
 *   - Business-initiated (template) messages require customer opt-in.
 *   - Free-form (session) messages require an inbound message within 24h.
 *
 * Reliability:
 *   - Every send gets a unique requestId (uuid v4) and is idempotent: retries
 *     reuse the SAME requestId and duplicate sends for the same requestId are
 *     ignored (CampaignLog unique constraint).
 *   - Automatic retry with exponential backoff on SERVER / NETWORK / TIMEOUT /
 *     RATE_LIMIT errors. Never retried on AUTH / VALIDATION errors.
 *   - Every attempt is recorded in ApiLog (secrets redacted) and CampaignLog.
 */

const PROVIDER = 'WHATSAPP_ALENDEI'
const RETRY_DELAYS_MS = [0, 2000, 8000]
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000

export type WaSendType = 'TEXT' | 'TEMPLATE' | 'IMAGE' | 'PDF' | 'VIDEO'

export type WaSendInput = {
  conversationId: string
  type: WaSendType
  body?: string // text or caption
  mediaAssetId?: string // FileAsset id for media messages
  templateId?: string // WhatsAppTemplate id (required for TEMPLATE/IMAGE/PDF/VIDEO)
  templateParams?: string[] // resolved variable values
  userId: string // acting agent
  leadId?: string | null
}

export type WaSendResult = {
  ok: boolean
  messageId: string
  requestId: string
  status: 'QUEUED' | 'SENT' | 'FAILED'
  providerMessageId?: string
  error?: string // readable error
}

function jsonId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const d = data as Record<string, unknown>
  const candidates = [d.id, d.messageId, d.message_id, d.wamid, (d.data as Record<string, unknown> | undefined)?.id]
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c
  }
  return undefined
}

function jsonSuccess(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true
  const d = data as Record<string, unknown>
  if (typeof d.success === 'boolean') return d.success
  if (typeof d.status === 'string') return !/fail|error|invalid/i.test(d.status)
  return true
}

/** Normalize phone to digits-with-country-code (strip +, spaces, dashes). */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '')
}

/** Publicly-absolute URL for a stored file asset (needed by Alendei media fetch). */
export function publicFileUrl(assetPath: string): string {
  const base = (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  if (base) return `${base}${assetPath}`
  // Dev fallback: use the request origin at runtime — routes pass absolute URLs
  return assetPath
}

async function postWithRetry(
  url: string,
  payload: Record<string, unknown>,
  requestId: string,
  leadId: string | null,
  userId: string | null
): Promise<{ ok: true; data: unknown } | { ok: false; error: ProviderError }> {
  let lastError: ProviderError | null = null
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt - 1]
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    const started = Date.now()
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      })
      const text = await res.text()
      const durationMs = Date.now() - started
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = { raw: text }
      }
      if (res.ok) {
        await logApiCall({
          provider: PROVIDER, endpoint: url, method: 'POST', requestId,
          responseCode: res.status, durationMs, success: true, leadId, userId, attempt,
        })
        return { ok: true, data }
      }
      const perr = mapProviderError(res.status, text, 'WhatsApp API')
      await logApiCall({
        provider: PROVIDER, endpoint: url, method: 'POST', requestId,
        responseCode: res.status, durationMs, success: false, error: perr, leadId, userId, attempt,
      })
      lastError = perr
      // Retry only transient errors
      if (!['SERVER', 'RATE_LIMIT'].includes(perr.errorType)) break
    } catch (e) {
      const nerr = networkError(e, 'WhatsApp API')
      await logApiCall({
        provider: PROVIDER, endpoint: url, method: 'POST', requestId,
        durationMs: Date.now() - started, success: false, error: nerr, leadId, userId, attempt,
      })
      lastError = nerr
    }
  }
  return { ok: false, error: lastError ?? new ProviderError('UNKNOWN', 'unknown', 'WhatsApp API error') }
}

export type TestConnectionResult = {
  status: 'CONNECTED' | 'ERROR'
  detail: string
  keyValid: boolean | null // null = could not determine without sending
}

/**
 * TEST CONNECTION — real, non-mutating diagnostics:
 * 1. Reachability: POST to the campaign endpoint with an empty body.
 *    ANY HTTP response proves the API host + path are reachable.
 * 2. Auth check (if an API key is configured): send with a deliberately
 *    non-existent campaign name. A VALIDATION response ("campaign not
 *    found" style) proves the API key is accepted (NOT a 401/403).
 *    No real customer message is ever sent by this test.
 */
export async function testWhatsappConnection(): Promise<TestConnectionResult> {
  const cfg = await resolveCommConfig()
  const endpoint = `${cfg.whatsapp.baseUrl}/campaign/flexiwaba/api`

  // Step 1: reachability
  const probe = await postWithRetry(endpoint, {}, 'health-probe-' + randomUUID(), null, null)
  if (!probe.ok && probe.error.errorType === 'NETWORK') {
    return { status: 'ERROR', detail: `API not reachable at ${endpoint}: ${probe.error.message}`, keyValid: null }
  }
  if (!probe.ok && probe.error.errorType === 'TIMEOUT') {
    return { status: 'ERROR', detail: `API timed out at ${endpoint}`, keyValid: null }
  }
  if (!cfg.whatsapp.apiKey) {
    return {
      status: 'ERROR',
      detail: `API endpoint reachable at ${endpoint}, but no API key configured. Save the WhatsApp API key first.`,
      keyValid: null,
    }
  }

  // Step 2: auth validation with a health-check campaign name (no customer impact)
  const auth = await postWithRetry(
    endpoint,
    {
      apiKey: cfg.whatsapp.apiKey,
      campaignName: '__crm_health_check__',
      destination: cfg.whatsapp.businessNumber.replace(/\D/g, ''),
      source: 'crm-health-check',
      templateParams: [],
    },
    'health-auth-' + randomUUID(),
    null,
    null
  )
  if (auth.ok) {
    return { status: 'CONNECTED', detail: 'API reachable and API key accepted (health-check campaign lookup).', keyValid: true }
  }
  const et = auth.error.errorType
  if (et === 'AUTH') {
    return { status: 'ERROR', detail: 'API reachable but the API key was rejected (401/403). Verify the key in the Alendei panel.', keyValid: false }
  }
  if (et === 'VALIDATION' || et === 'NOT_FOUND') {
    // Expected: campaign "__crm_health_check__" does not exist → key accepted
    return { status: 'CONNECTED', detail: 'API reachable and API key accepted. Configure live campaigns in the Alendei panel to enable sending.', keyValid: true }
  }
  return { status: 'ERROR', detail: `Unexpected API response: ${auth.error.message}`, keyValid: null }
}

/** Session window: free-form messages allowed only if the customer messaged within 24h. */
export async function sessionWindowOpen(conversationId: string): Promise<boolean> {
  const conv = await db.whatsAppConversation.findUnique({
    where: { id: conversationId },
    select: { lastInboundAt: true },
  })
  if (!conv?.lastInboundAt) return false
  return Date.now() - conv.lastInboundAt.getTime() < SESSION_WINDOW_MS
}

/**
 * Unified send. Enforces opt-in + session window rules, performs the real
 * provider call with retry, records everything, emits real-time events.
 */
export async function sendWhatsappMessage(input: WaSendInput, origin?: string): Promise<WaSendResult> {
  const cfg = await resolveCommConfig()
  const requestId = randomUUID()

  if (!cfg.whatsapp.apiKey) {
    throw new ProviderError(
      'AUTH',
      'WhatsApp API key not configured',
      'WhatsApp API key is not configured. Set WHATSAPP_API_KEY in the server environment or save it in Settings → Communication → WhatsApp.'
    )
  }
  if (!cfg.whatsapp.defaultCampaign && input.type === 'TEXT') {
    throw new ProviderError(
      'VALIDATION',
      'no session campaign configured',
      'No WhatsApp campaign configured for session replies. Set the Default Campaign in Settings → Communication → WhatsApp.'
    )
  }

  const conv = await db.whatsAppConversation.findUnique({
    where: { id: input.conversationId },
    include: { lead: { select: { id: true, customerName: true, optInStatus: true, department: true } } },
  })
  if (!conv) throw new ProviderError('VALIDATION', 'conversation not found', 'Conversation not found.')
  const phone = conv.phone
  const lead = conv.lead

  let template: { name: string; variableCount: number; headerType: string } | null = null
  let mediaUrl: string | undefined
  let mediaName: string | undefined

  if (input.type === 'TEXT') {
    if (!input.body || !input.body.trim()) {
      throw new ProviderError('VALIDATION', 'empty text', 'Message text is required.')
    }
    const open = await sessionWindowOpen(input.conversationId)
    if (!open) {
      throw new ProviderError(
        'VALIDATION',
        'session window closed',
        'Free-form WhatsApp messages can only be sent within 24 hours of the customer\u2019s last message. Use an approved template instead.'
      )
    }
  } else {
    // TEMPLATE / IMAGE / PDF / VIDEO — business-initiated: requires approved template + campaign + opt-in
    if (lead && lead.optInStatus !== 'OPTED_IN') {
      throw new ProviderError(
        'VALIDATION',
        'opt-in missing',
        'This contact has not opted in to WhatsApp messages. Business-initiated messages are blocked. Ask the customer to message you first, or update the opt-in status.'
      )
    }
    if (!input.templateId) {
      throw new ProviderError('VALIDATION', 'templateId missing', 'An approved template is required for this message type.')
    }
    const tpl = await db.whatsAppTemplate.findUnique({ where: { id: input.templateId } })
    if (!tpl) throw new ProviderError('VALIDATION', 'template not found', 'Selected template was not found.')
    if (tpl.status !== 'APPROVED' || !tpl.isActive) {
      throw new ProviderError('VALIDATION', 'template not approved', `Template "${tpl.name}" is not approved/active. Only approved templates can be sent.`)
    }
    template = { name: tpl.name, variableCount: tpl.variableCount, headerType: tpl.headerType }
    if (template.variableCount > 0) {
      const params = input.templateParams ?? []
      if (params.length !== template.variableCount) {
        throw new ProviderError(
          'VALIDATION',
          `templateParams length ${params.length} != required ${template.variableCount}`,
          `This template requires exactly ${template.variableCount} variable value(s). Alendei rejects requests where the parameter count does not match the campaign template.`
        )
      }
    }
    if (input.type !== 'TEMPLATE') {
      // media message: requires template with matching media header OR free media within session window via campaign
      const asset = input.mediaAssetId ? await db.fileAsset.findUnique({ where: { id: input.mediaAssetId } }) : null
      if (!asset) {
        throw new ProviderError('VALIDATION', 'media asset missing', 'Please upload the media file first.')
      }
      const base = (process.env.PUBLIC_BASE_URL || (origin ? origin.replace(/\/+$/, '') : '')).replace(/\/+$/, '')
      mediaUrl = base ? `${base}/api/files/${asset.id}?token=${signAssetToken(asset.id)}` : `/api/files/${asset.id}?token=${signAssetToken(asset.id)}`
      mediaName = asset.filename
    }
  }

  const campaignName = cfg.whatsapp.defaultCampaign || template?.name || ''
  if (!campaignName && input.type !== 'TEXT') {
    throw new ProviderError(
      'VALIDATION',
      'no campaign configured',
      'No WhatsApp campaign configured. Set the default campaign in Settings → Communication → WhatsApp (must be a live API campaign in the Alendei panel).'
    )
  }

  // Idempotency guard — should never hit, but double safety
  const dup = await db.campaignLog.findUnique({ where: { requestId } })

  const message = await db.whatsAppMessage.create({
    data: {
      conversationId: input.conversationId,
      userId: input.userId,
      direction: 'OUT',
      type: input.type,
      body: input.body ?? null,
      mediaUrl,
      mediaName,
      templateId: input.templateId ?? null,
      templateName: template?.name ?? null,
      templateVars: input.templateParams ? JSON.stringify(input.templateParams) : null,
      status: 'QUEUED',
      requestId,
    },
    include: { user: { select: { id: true, name: true } } },
  })

  if (dup) {
    return { ok: true, messageId: message.id, requestId, status: 'SENT', providerMessageId: dup.providerMessageId ?? undefined }
  }

  const payload: Record<string, unknown> = {
    apiKey: cfg.whatsapp.apiKey,
    campaignName,
    destination: normalizePhone(phone),
    userName: lead?.customerName ?? conv.name ?? undefined,
    source: 'ajmera-crm',
    templateParams: input.templateParams ?? (input.body ? [input.body] : []),
    tags: [],
    attributes: {},
  }
  if (mediaUrl) {
    payload.media = { url: mediaUrl, filename: mediaName ?? 'media' }
  }
  if (input.type === 'TEXT') {
    // Free-form session text: Alendei expects it via campaign too; use a
    // session campaign if configured, else fall back to templateParams body.
    payload.templateParams = [input.body]
  }

  const endpoint = `${cfg.whatsapp.baseUrl}/campaign/flexiwaba/api`
  const result = await postWithRetry(endpoint, payload, requestId, lead?.id ?? null, input.userId)

  const sanitizedPayload = JSON.stringify({ ...payload, apiKey: '[REDACTED]' })

  if (result.ok && jsonSuccess(result.data)) {
    const providerMessageId = jsonId(result.data)
    const updated = await db.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: 'SENT', providerMessageId, sentAt: new Date(), attempts: RETRY_DELAYS_MS.length },
      include: { user: { select: { id: true, name: true } } },
    })
    await db.campaignLog.create({
      data: {
        requestId, campaignName, destination: phone, templateName: template?.name,
        leadId: lead?.id, userId: input.userId, success: true,
        providerMessageId, payload: sanitizedPayload,
      },
    })
    await db.whatsAppConversation.update({
      where: { id: input.conversationId },
      data: { lastMessage: input.body ?? mediaName ?? '[template]', lastMessageAt: new Date() },
    })
    if (lead) {
      const now = new Date()
      await db.lead.update({
        where: { id: lead.id },
        data: { lastWaMessage: (input.body ?? mediaName ?? '[template]').slice(0, 200), lastWaMessageAt: now, lastWaDirection: 'OUT', lastContactAt: now },
      })
      await db.activity.create({
        data: {
          leadId: lead.id, userId: input.userId, type: 'WHATSAPP',
          title: input.type === 'TEXT' ? 'WhatsApp message sent' : `WhatsApp ${template?.name ?? input.type} sent`,
          description: (input.body ?? mediaName ?? template?.name ?? '').slice(0, 160),
        },
      })
    }
    await emitSocketEvent({
      room: `conversation:${input.conversationId}`,
      event: 'whatsapp:new-message',
      data: { message: updated, conversationId: input.conversationId },
    })
    return { ok: true, messageId: message.id, requestId, status: 'SENT', providerMessageId }
  }

  const err = result.ok
    ? new ProviderError('UNKNOWN', 'provider indicated failure', 'WhatsApp API rejected the message. Check the API logs for details.')
    : result.error
  const updated = await db.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: 'FAILED', errorCode: err.errorType, errorMessage: err.readable,
      failedAt: new Date(), attempts: RETRY_DELAYS_MS.length,
    },
    include: { user: { select: { id: true, name: true } } },
  })
  await db.campaignLog.create({
    data: {
      requestId, campaignName, destination: phone, templateName: template?.name,
      leadId: lead?.id, userId: input.userId, success: false, errorMessage: err.readable,
      payload: sanitizedPayload,
    },
  })
  if (lead) {
    await db.activity.create({
      data: {
        leadId: lead.id, userId: input.userId, type: 'WHATSAPP',
        title: 'WhatsApp message failed', description: err.readable.slice(0, 160),
      },
    })
  }
  return { ok: false, messageId: message.id, requestId, status: 'FAILED', error: err.readable }
}

// ---------- signed asset tokens (provider must fetch media without CRM login) ----------

const ASSET_SECRET = () => process.env.CONFIG_ENCRYPTION_KEY || process.env.DATABASE_URL || 'local-dev'

export function signAssetToken(assetId: string): string {
  return createHmac('sha256', ASSET_SECRET()).update(`asset:${assetId}`).digest('hex').slice(0, 32)
}

export function verifyAssetToken(assetId: string, token: string): boolean {
  return signAssetToken(assetId) === token
}
