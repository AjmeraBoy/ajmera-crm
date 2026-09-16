import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'
import {
  getRawCommSettings,
  maskedCommConfig,
  setCommSettings,
  setSecret,
  resolveCommConfig,
} from '@/lib/comm/settings'

/**
 * GET  /api/comm/settings — masked configuration for the admin UI (no secrets).
 * PUT  /api/comm/settings — save configuration. Secrets (apiKey/password):
 *        undefined/'' → unchanged; '-' → clear stored secret; other value →
 *        store encrypted (AES-256-GCM). Env vars always take priority.
 */

const WA_STATUSES = ['CONNECTED', 'ERROR', 'NOT_CONNECTED']

function originOf(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

export const GET = route(async (req) => {
  await requireUser(['SUPER_ADMIN', 'ADMIN'])
  const [masked, raw, cfg] = await Promise.all([maskedCommConfig(), getRawCommSettings(), resolveCommConfig()])
  const origin = originOf(req)
  return ok({
    whatsapp: masked.whatsapp,
    sip: masked.sip,
    waStatus: {
      status: raw['wa.status'] || 'NOT_CONNECTED',
      lastCheck: raw['wa.last_check'] || null,
      detail: raw['wa.last_check_detail'] || null,
    },
    sipStatus: {
      status: raw['sip.status'] || 'NOT_CONNECTED',
      lastCheck: raw['sip.last_check'] || null,
      detail: raw['sip.last_check_detail'] || null,
    },
    webhook: {
      url: `${origin}/api/webhooks/whatsapp`,
      urlWithSecret: cfg.security.webhookSecret ? `${origin}/api/webhooks/whatsapp?secret=${encodeURIComponent(cfg.security.webhookSecret)}` : null,
      voiceUrl: `${origin}/api/webhooks/voice`,
      secret: cfg.security.webhookSecret,
      active: Boolean(cfg.security.webhookSecret),
      lastReceivedAt: raw['security.webhook_last_received_at'] || null,
    },
    env: {
      publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
      apiKeyFromEnv: Boolean(process.env.WHATSAPP_API_KEY),
      sipPasswordFromEnv: Boolean(process.env.SIP_PASSWORD),
    },
  })
})

type SettingsBody = {
  whatsapp?: {
    provider?: string
    baseUrl?: string
    apiKey?: string
    businessNumber?: string
    defaultCampaign?: string
  }
  sip?: {
    provider?: string
    server?: string
    username?: string
    password?: string
    port?: string
    transport?: string
    outboundProxy?: string
    callerId?: string
    extension?: string
    clickToCallUrl?: string
    callActionUrl?: string
  }
}

const SIP_TRANSPORTS = ['UDP', 'TCP', 'TLS']

export const PUT = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN'])
  const body = await readBody<SettingsBody>(req)

  const auditDetails: string[] = []

  if (body.whatsapp) {
    const w = body.whatsapp
    const fields: Record<string, string | undefined> = {}
    if (w.provider !== undefined) fields['wa.provider'] = String(w.provider)
    if (w.baseUrl !== undefined) fields['wa.api_base_url'] = String(w.baseUrl).trim().replace(/\/+$/, '')
    if (w.businessNumber !== undefined) fields['wa.business_number'] = String(w.businessNumber).trim()
    if (w.defaultCampaign !== undefined) fields['wa.default_campaign'] = String(w.defaultCampaign).trim()
    await setCommSettings(fields)
    if (Object.keys(fields).length) auditDetails.push(`whatsapp:${Object.keys(fields).join(',')}`)

    if (w.apiKey !== undefined) {
      const key = String(w.apiKey).trim()
      if (key === '-') {
        await setSecret('wa.api_key_enc', undefined)
        auditDetails.push('whatsapp:apiKey cleared')
      } else if (key !== '') {
        await setSecret('wa.api_key_enc', key)
        auditDetails.push('whatsapp:apiKey updated')
      }
    }
    // Reset status after config change so operators re-test
    if (Object.keys(fields).length || (w.apiKey !== undefined && w.apiKey.trim() !== '')) {
      await setCommSettings({ 'wa.status': 'NOT_CONNECTED' })
    }
  }

  if (body.sip) {
    const s = body.sip
    const fields: Record<string, string | undefined> = {}
    if (s.provider !== undefined) fields['sip.provider'] = String(s.provider)
    if (s.server !== undefined) fields['sip.server'] = String(s.server).trim()
    if (s.username !== undefined) fields['sip.username'] = String(s.username).trim()
    if (s.port !== undefined) {
      const port = String(s.port).trim()
      if (port && !/^\d{1,5}$/.test(port)) throw new ApiError('SIP port must be numeric', 400)
      fields['sip.port'] = port
    }
    if (s.transport !== undefined) {
      const transport = String(s.transport).toUpperCase()
      if (!SIP_TRANSPORTS.includes(transport)) throw new ApiError(`transport must be one of ${SIP_TRANSPORTS.join(', ')}`, 400)
      fields['sip.transport'] = transport
    }
    if (s.outboundProxy !== undefined) fields['sip.outbound_proxy'] = String(s.outboundProxy).trim()
    if (s.callerId !== undefined) fields['sip.caller_id'] = String(s.callerId).trim()
    if (s.extension !== undefined) fields['sip.extension'] = String(s.extension).trim()
    if (s.clickToCallUrl !== undefined) fields['sip.click_to_call_url'] = String(s.clickToCallUrl).trim()
    if (s.callActionUrl !== undefined) fields['sip.call_action_url'] = String(s.callActionUrl).trim()
    await setCommSettings(fields)
    if (Object.keys(fields).length) auditDetails.push(`sip:${Object.keys(fields).join(',')}`)

    if (s.password !== undefined) {
      const pass = String(s.password).trim()
      if (pass === '-') {
        await setSecret('sip.password_enc', undefined)
        auditDetails.push('sip:password cleared')
      } else if (pass !== '') {
        await setSecret('sip.password_enc', pass)
        auditDetails.push('sip:password updated')
      }
    }
    if (Object.keys(fields).length || (s.password !== undefined && s.password.trim() !== '')) {
      await setCommSettings({ 'sip.status': 'NOT_CONNECTED' })
    }
  }

  await audit(user, 'COMM_SETTINGS_UPDATE', 'Setting', undefined, { fields: auditDetails })
  return GET(req)
})

// keep WaStatuses referenced (future validation of manually marked statuses)
void WA_STATUSES
void db
