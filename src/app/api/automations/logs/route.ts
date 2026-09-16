import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, requireUser, route } from '@/lib/api'

/** GET /api/automations/logs?ruleId=&leadId=&page= — automation execution log. */
export const GET = route(async (req) => {
  await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const sp = new URL(req.url).searchParams
  const where: Prisma.AutomationLogWhereInput = {}
  const ruleId = sp.get('ruleId')
  if (ruleId) where.ruleId = ruleId
  const leadId = sp.get('leadId')
  if (leadId) where.leadId = leadId

  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 25))
  const [logs, total] = await Promise.all([
    db.automationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { rule: { select: { id: true, name: true, trigger: true } } },
    }),
    db.automationLog.count({ where }),
  ])
  return ok({ logs, total, page, pageSize })
})
