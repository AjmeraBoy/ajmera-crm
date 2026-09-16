import { resolveCommConfig } from '@/lib/comm/settings'
import { processVoiceWebhook } from '@/lib/comm/webhook-service'
import { ok, route, readBody } from '@/lib/api'

/**
 * PUBLIC WEBHOOK: POST /api/webhooks/voice
 *
 * Receives SIP / dialer call events from the telephony provider:
 * incoming call, ringing, answered, hold, unhold, transfer, recording ready,
 * ended (with duration), missed / no-answer / busy / failed, etc.
 *
 * Security: `x-webhook-secret` header OR `?secret=` query must equal the
 * configured CRM webhook secret. Processing is idempotent.
 */

function clientIp(req: Request): string | undefined {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? undefined
}

export const POST = route(async (req) => {
  const sp = new URL(req.url).searchParams
  const cfg = await resolveCommConfig()
  const provided = req.headers.get('x-webhook-secret') || sp.get('secret') || ''
  if (!cfg.security.webhookSecret) {
    return ok({ error: 'Webhook secret not configured. Set it in Settings → Communication.' }, 503)
  }
  if (provided !== cfg.security.webhookSecret) {
    return ok({ error: 'Invalid webhook secret' }, 401)
  }
  const body = await readBody<Record<string, unknown>>(req)
  const result = await processVoiceWebhook(body, clientIp(req))
  return ok({ result })
})
