import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'

/**
 * PATCH /api/leads/optin {leadId, optInStatus: 'OPTED_IN'|'NOT_OPTED_IN'|'UNKNOWN'}
 * Management only. WhatsApp business-initiated sending is blocked unless OPTED_IN.
 */
export const PATCH = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const body = await readBody<{ leadId?: string; optInStatus?: string }>(req)
  if (!body.leadId) throw new ApiError('leadId is required', 400)
  const status = (body.optInStatus ?? '').toUpperCase()
  if (!['OPTED_IN', 'NOT_OPTED_IN', 'UNKNOWN'].includes(status)) {
    throw new ApiError("optInStatus must be OPTED_IN, NOT_OPTED_IN or UNKNOWN", 400)
  }
  const lead = await db.lead.findUnique({ where: { id: body.leadId }, select: { id: true } })
  if (!lead) throw new ApiError('Lead not found', 404)

  const updated = await db.lead.update({
    where: { id: lead.id },
    data: {
      optInStatus: status,
      ...(status === 'OPTED_IN' ? { optInAt: new Date(), optInSource: 'MANUAL' } : {}),
      ...(status === 'UNKNOWN' ? { optInAt: null, optInSource: null } : {}),
    },
  })
  await db.activity.create({
    data: {
      leadId: lead.id,
      userId: user.id,
      type: 'SYSTEM',
      title: `WhatsApp opt-in set to ${status.replace(/_/g, ' ').toLowerCase()}`,
    },
  })
  await audit(user, 'LEAD_OPTIN_UPDATE', 'Lead', lead.id, { optInStatus: status })
  return ok({ lead: { id: updated.id, optInStatus: updated.optInStatus, optInAt: updated.optInAt } })
})
