import { db } from '@/lib/db'
import { decryptSecret, encryptSecret, maskSecret } from './crypto'

/**
 * Communication configuration resolver.
 *
 * PRIORITY: environment variable > encrypted DB value.
 * This satisfies the requirement that credentials are replaceable from the
 * server environment WITHOUT changing application code, while still allowing
 * admins to configure them from the Settings UI (stored encrypted).
 *
 * SECURITY:
 * - Secrets are stored AES-256-GCM encrypted in the Setting table.
 * - `resolveCommConfig()` is SERVER-ONLY. Never import it from client code.
 * - `maskedCommConfig()` returns display-safe values only.
 */

export type CommConfig = {
  whatsapp: {
    provider: string
    baseUrl: string
    apiKey: string // resolved plaintext — server-side only
    apiKeySource: 'env' | 'db' | 'none'
    businessNumber: string
    defaultCampaign: string
    webhookSecret: string
  }
  sip: {
    provider: string
    server: string
    username: string
    password: string
    passwordSource: 'env' | 'db' | 'none'
    port: string
    transport: string // UDP | TCP | TLS
    outboundProxy: string
    callerId: string
    extension: string
    clickToCallUrl: string // optional full REST template, {agent} {customer} placeholders
    callActionUrl: string // optional REST template for in-call control {call_id} {action} {target}
  }
  security: {
    webhookSecret: string // shared secret required on /api/webhooks/*
  }
}

const DB_PREFIX = 'comm.'

async function dbSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: DB_PREFIX } } })
  return Object.fromEntries(rows.map((r) => [r.key.slice(DB_PREFIX.length), r.value]))
}

export async function getRawCommSettings(): Promise<Record<string, string>> {
  return dbSettings()
}

export async function resolveCommConfig(): Promise<CommConfig> {
  const s = await dbSettings()

  const envWaKey = (process.env.WHATSAPP_API_KEY || '').trim()
  const dbWaKey = decryptSecret(s['wa.api_key_enc'])
  const waKey = envWaKey || dbWaKey

  const envSipPass = (process.env.SIP_PASSWORD || '').trim()
  const dbSipPass = decryptSecret(s['sip.password_enc'])
  const sipPass = envSipPass || dbSipPass

  const webhookSecret =
    process.env.COMM_WEBHOOK_SECRET || s['security.webhook_secret'] || ''

  return {
    whatsapp: {
      provider: s['wa.provider'] || 'Alendei',
      baseUrl:
        (process.env.WHATSAPP_API_BASE_URL || s['wa.api_base_url'] || 'https://autoapi.alendei.io').replace(/\/+$/, ''),
      apiKey: waKey,
      apiKeySource: envWaKey ? 'env' : dbWaKey ? 'db' : 'none',
      businessNumber:
        process.env.WHATSAPP_BUSINESS_NUMBER || s['wa.business_number'] || '+912613547700',
      defaultCampaign: s['wa.default_campaign'] || '',
      webhookSecret,
    },
    sip: {
      provider: process.env.SIP_PROVIDER || s['sip.provider'] || '',
      server: process.env.SIP_SERVER || s['sip.server'] || '',
      username: process.env.SIP_USERNAME || s['sip.username'] || '',
      password: sipPass,
      passwordSource: envSipPass ? 'env' : dbSipPass ? 'db' : 'none',
      port: process.env.SIP_PORT || s['sip.port'] || '5060',
      transport: process.env.SIP_TRANSPORT || s['sip.transport'] || 'UDP',
      outboundProxy: process.env.SIP_OUTBOUND_PROXY || s['sip.outbound_proxy'] || '',
      callerId: process.env.SIP_CALLER_ID || s['sip.caller_id'] || '+912613547700',
      extension: s['sip.extension'] || '',
      clickToCallUrl: s['sip.click_to_call_url'] || '',
      callActionUrl: s['sip.call_action_url'] || '',
    },
    security: { webhookSecret },
  }
}

export type MaskedCommConfig = {
  whatsapp: {
    provider: string
    baseUrl: string
    apiKeyMasked: string
    apiKeySource: string
    hasApiKey: boolean
    businessNumber: string
    defaultCampaign: string
  }
  sip: {
    provider: string
    server: string
    username: string
    passwordMasked: string
    passwordSource: string
    hasPassword: boolean
    port: string
    transport: string
    outboundProxy: string
    callerId: string
    extension: string
    clickToCallUrl: string
    callActionUrl: string
  }
}

/** Display-safe config for the admin UI (no secrets). */
export async function maskedCommConfig(): Promise<MaskedCommConfig> {
  const c = await resolveCommConfig()
  return {
    whatsapp: {
      provider: c.whatsapp.provider,
      baseUrl: c.whatsapp.baseUrl,
      apiKeyMasked: maskSecret(c.whatsapp.apiKey),
      apiKeySource: c.whatsapp.apiKeySource,
      hasApiKey: Boolean(c.whatsapp.apiKey),
      businessNumber: c.whatsapp.businessNumber,
      defaultCampaign: c.whatsapp.defaultCampaign,
    },
    sip: {
      provider: c.sip.provider,
      server: c.sip.server,
      username: c.sip.username,
      passwordMasked: maskSecret(c.sip.password),
      passwordSource: c.sip.passwordSource,
      hasPassword: Boolean(c.sip.password),
      port: c.sip.port,
      transport: c.sip.transport,
      outboundProxy: c.sip.outboundProxy,
      callerId: c.sip.callerId,
      extension: c.sip.extension,
      clickToCallUrl: c.sip.clickToCallUrl,
      callActionUrl: c.sip.callActionUrl,
    },
  }
}

/** Upsert a setting; empty string deletes (except secrets which are skipped). */
export async function setCommSettings(entries: Record<string, string | undefined>) {
  for (const [suffix, value] of Object.entries(entries)) {
    const key = DB_PREFIX + suffix
    if (value === undefined) continue
    if (value === '') {
      await db.setting.deleteMany({ where: { key } })
      continue
    }
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
}

/** Store a secret encrypted. Empty value clears it. */
export async function setSecret(suffix: string, plaintext: string | undefined) {
  const key = DB_PREFIX + suffix
  if (!plaintext) {
    await db.setting.deleteMany({ where: { key } })
    return
  }
  await db.setting.upsert({
    where: { key },
    update: { value: encryptSecret(plaintext) },
    create: { key, value: encryptSecret(plaintext) },
  })
}

/** Mark WhatsApp connection status after a test. */
export async function markWhatsappStatus(status: 'CONNECTED' | 'ERROR' | 'NOT_CONNECTED', detail?: string) {
  await setCommSettings({
    'wa.status': status,
    'wa.last_check': new Date().toISOString(),
    ...(detail !== undefined ? { 'wa.last_check_detail': detail.slice(0, 500) } : {}),
  })
}

export async function markSipStatus(status: 'CONNECTED' | 'ERROR' | 'NOT_CONNECTED', detail?: string) {
  await setCommSettings({
    'sip.status': status,
    'sip.last_check': new Date().toISOString(),
    ...(detail !== undefined ? { 'sip.last_check_detail': detail.slice(0, 500) } : {}),
  })
}

export async function markWebhookReceived() {
  await setCommSettings({ 'security.webhook_last_received_at': new Date().toISOString() })
}
