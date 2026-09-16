import { resolveCommConfig } from '@/lib/comm/settings'
import { processWhatsappWebhook } from '@/lib/comm/webhook-service'
import { ok, route, readBody } from '@/lib/api'

/**
 * PUBLIC WEBHOOK: POST /api/webhooks/whatsapp
 *
 * Receives WhatsApp events from Alendei / FlexiWaba (WhatsApp Business API).
 * Security: `x-webhook-secret` header OR `?secret=` query must equal the
 * configured CRM webhook secret (Settings → Communication → WhatsApp).
 * Also supports Meta-style GET verification (hub.challenge echo).
 *
 * Processing is IDEMPOTENT — duplicate deliveries never create duplicate
 * messages (see WebhookService / WebhookEvent.dedupeKey).
 */

function clientIp(req: Request): string | undefined {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? undefined
}

async function authorize(req: Request, sp: URLSearchParams): Promise<boolean> {
  const cfg = await resolveCommConfig()
  const secret = cfg.security.webhookSecret
  if (!secret) return false
  const provided = req.headers.get('x-webhook-secret') || sp.get('secret') || ''
  return provided === secret
}

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams
  const mode = sp.get('hub.mode')
  const token = sp.get('hub.verify_token')
  const challenge = sp.get('hub.challenge')
  const cfg = await resolveCommConfig()

  if (mode === 'subscribe' && challenge) {
    if (!cfg.security.webhookSecret || token !== cfg.security.webhookSecret) {
      return new Response('Forbidden', { status: 403 })
    }
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return ok({ service: 'whatsapp-webhook', status: 'ready' })
})

export const POST = route(async (req) => {
  const sp = new URL(req.url).searchParams

  // Meta/Alendei health-check pings may POST without our secret — challenge pattern
  const body = await readBody<Record<string, unknown>>(req)
  if (body && typeof body === 'object' && body.hub_challenge) {
    return ok({ result: { status: 'PROCESSED', detail: 'verification challenge acknowledged' } })
  }

  const authorized = await authorize(req, sp)
  if (!authorized) {
    const cfg = await resolveCommConfig()
    if (!cfg.security.webhookSecret) {
      return ok({ error: 'Webhook secret not configured. Set it in Settings → Communication → WhatsApp.' }, 503)
    }
    return ok({ error: 'Invalid webhook secret' }, 401)
  }

  const result = await processWhatsappWebhook(body, clientIp(req))
  // Always 200 for provider deliveries so they do not retry-storm; details in result.
  return ok({ result })
})
