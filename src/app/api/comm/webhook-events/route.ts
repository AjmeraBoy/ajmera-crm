import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, requireUser, route } from '@/lib/api'

/** GET /api/comm/webhook-events — inbound webhook archive (management only). */
export const GET = route(async (req) => {
  await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const sp = new URL(req.url).searchParams
  const where: Prisma.WebhookEventWhereInput = {}
  const status = sp.get('status')
  if (status) where.processingStatus = status
  const provider = sp.get('provider')
  if (provider) where.provider = provider

  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 25))
  const [events, total] = await Promise.all([
    db.webhookEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        provider: true,
        eventType: true,
        eventId: true,
        processingStatus: true,
        phoneNumber: true,
        leadId: true,
        payload: true,
        error: true,
        receivedAt: true,
        processedAt: true,
      },
    }),
    db.webhookEvent.count({ where }),
  ])
  return ok({ events, total, page, pageSize })
})
