import { db } from '@/lib/db'
import { ok, route } from '@/lib/api'
import { runAutomations } from '@/lib/comm/automation'

/**
 * POST /api/comm/cron/followups — scan due follow-ups and fire FOLLOWUP_DUE
 * automations. Auth: internal secret header OR SUPER_ADMIN.
 * Call this every 5-15 minutes from a system scheduler in production.
 */
export const POST = route(async (req) => {
  const secret = req.headers.get('x-internal-secret')
  const isInternal = secret === (process.env.INTERNAL_EVENT_SECRET || 'dev-internal-secret')
  if (!isInternal) {
    const { getSessionUser } = await import('@/lib/auth')
    const user = await getSessionUser()
    if (!user || user.role !== 'SUPER_ADMIN') {
      return ok({ error: 'unauthorized' }, 401)
    }
  }

  const now = new Date()
  const due = await db.followUp.findMany({
    where: { status: 'PENDING', dueAt: { lte: now } },
    take: 200,
    orderBy: { dueAt: 'asc' },
    select: { id: true, leadId: true, assignedToId: true },
  })

  let processed = 0
  const since = new Date(now.getTime() - 20 * 3600 * 1000)
  for (const fu of due) {
    if (!fu.leadId) continue
    // Dedupe: skip if FOLLOWUP_DUE automations already ran for this lead recently
    const recent = await db.automationLog.findFirst({
      where: { trigger: 'FOLLOWUP_DUE', leadId: fu.leadId, createdAt: { gte: since } },
      select: { id: true },
    })
    if (recent) continue
    await runAutomations('FOLLOWUP_DUE', { leadId: fu.leadId, userId: fu.assignedToId })
    processed++
  }
  return ok({ checked: due.length, processed })
})
