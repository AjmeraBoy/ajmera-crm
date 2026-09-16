import { db } from '@/lib/db'
import { ok, requireUser, route } from '@/lib/api'

/** GET /api/comm/campaign-logs — Alendei campaign send audit trail (management only). */
export const GET = route(async (req) => {
  await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const sp = new URL(req.url).searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 25))
  const success = sp.get('success')
  const where = {
    ...(success === '1' || success === 'true' ? { success: true } : {}),
    ...(success === '0' || success === 'false' ? { success: false } : {}),
  }
  const [logs, total] = await Promise.all([
    db.campaignLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.campaignLog.count({ where }),
  ])
  // enrich with lead/user names (CampaignLog stores ids only)
  const leadIds = [...new Set(logs.map((l) => l.leadId).filter((v): v is string => Boolean(v)))]
  const userIds = [...new Set(logs.map((l) => l.userId).filter((v): v is string => Boolean(v)))]
  const [leads, users] = await Promise.all([
    db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, leadCode: true, customerName: true } }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ])
  const leadMap = new Map(leads.map((l) => [l.id, l]))
  const userMap = new Map(users.map((u) => [u.id, u]))
  const enriched = logs.map((l) => ({
    ...l,
    lead: l.leadId ? (leadMap.get(l.leadId) ?? null) : null,
    user: l.userId ? (userMap.get(l.userId) ?? null) : null,
  }))
  return ok({ logs: enriched, total, page, pageSize })
})
