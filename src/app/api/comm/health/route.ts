import { db } from '@/lib/db'
import { ok, requireUser, route } from '@/lib/api'
import { getRawCommSettings, resolveCommConfig } from '@/lib/comm/settings'

/**
 * GET /api/comm/health — Communication Health Dashboard data.
 */

function originOf(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
}

export const GET = route(async (req) => {
  await requireUser()
  const [raw, cfg] = await Promise.all([getRawCommSettings(), resolveCommConfig()])
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const since24h = new Date(Date.now() - 24 * 3600 * 1000)

  // Database check
  let databaseOk = true
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    databaseOk = false
  }

  // Realtime relay check
  let socket: { ok: boolean; connections?: number; uptimeSec?: number } = { ok: false }
  try {
    const res = await fetch(process.env.SOCKET_SERVICE_URL || 'http://127.0.0.1:3004/health', {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) socket = (await res.json()) as { ok: boolean; connections?: number; uptimeSec?: number }
  } catch {
    socket = { ok: false }
  }

  const [waMessagesToday, callsToday, missedCalls24h, apiFailures24h, webhookEvents24h, webhookFailed] = await Promise.all([
    db.whatsAppMessage.count({ where: { createdAt: { gte: startOfDay } } }),
    db.callLog.count({ where: { createdAt: { gte: startOfDay } } }),
    db.callLog.count({ where: { status: 'MISSED', createdAt: { gte: since24h } } }),
    db.apiLog.count({ where: { success: false, createdAt: { gte: since24h } } }),
    db.webhookEvent.count({ where: { receivedAt: { gte: since24h } } }),
    db.webhookEvent.count({ where: { processingStatus: { in: ['FAILED', 'UNRECOGNIZED'] } } }),
  ])

  return ok({
    whatsapp: {
      status: raw['wa.status'] || 'NOT_CONNECTED',
      provider: cfg.whatsapp.provider,
      baseUrl: cfg.whatsapp.baseUrl,
      businessNumber: cfg.whatsapp.businessNumber,
      lastCheck: raw['wa.last_check'] || null,
      lastCheckDetail: raw['wa.last_check_detail'] || null,
    },
    sip: {
      status: raw['sip.status'] || 'NOT_CONNECTED',
      provider: cfg.sip.provider,
      server: cfg.sip.server,
      callerId: cfg.sip.callerId,
      lastCheck: raw['sip.last_check'] || null,
      lastCheckDetail: raw['sip.last_check_detail'] || null,
    },
    webhook: {
      active: Boolean(cfg.security.webhookSecret),
      url: `${originOf(req)}/api/webhooks/whatsapp`,
      lastReceivedAt: raw['security.webhook_last_received_at'] || null,
    },
    database: { connected: databaseOk },
    socket,
    stats: {
      waMessagesToday,
      callsToday,
      missedCalls24h,
      apiFailures24h,
      webhookEvents24h,
      webhookFailed,
    },
  })
})
