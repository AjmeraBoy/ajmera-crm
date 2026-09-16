import { db } from '@/lib/db'
import { ApiError, ok, readBody, requireUser, route } from '@/lib/api'
import { clickToCall } from '@/lib/comm/dialer'

/**
 * POST /api/calls/click-to-call {leadId, customerNumber?, agentUserId?}
 * CRM → Dialer/SIP service → Agent extension → Customer number.
 * The full lifecycle is tracked via /api/webhooks/voice.
 */
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ leadId?: string; customerNumber?: string; agentUserId?: string }>(req)
  if (!body.leadId) throw new ApiError('leadId is required', 400)

  const lead = await db.lead.findUnique({
    where: { id: body.leadId },
    select: { id: true, assignedToId: true, department: true },
  })
  if (!lead) throw new ApiError('Lead not found', 404)
  if (user.role === 'EXECUTIVE' && lead.assignedToId !== user.id) {
    throw new ApiError('You can only call your own leads', 403)
  }

  const result = await clickToCall({
    leadId: body.leadId,
    userId: user.id,
    customerNumber: body.customerNumber,
    agentUserId: body.agentUserId,
  })
  if (!result.ok) throw new ApiError(result.error ?? 'Click-to-call failed', 422)
  return ok({ ok: true, callId: result.callId, detail: result.detail })
})
