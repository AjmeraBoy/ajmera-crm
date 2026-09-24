import { db } from '@/lib/db'
import { ApiError, audit, notify, ok, readBody, requireUser, route } from '@/lib/api'

const OUTCOMES = ['Answered', 'Failed', 'Confirmed', 'Rejected']

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ leadId?: string; outcome?: string }>(req)
  if (!body.leadId) throw new ApiError('leadId is required', 400)
  const outcome = body.outcome && OUTCOMES.includes(body.outcome) ? body.outcome : 'Answered'
  const lead = await db.lead.findUnique({
    where: { id: body.leadId },
    select: { id: true, leadCode: true, customerName: true, assignedToId: true },
  })
  if (!lead) throw new ApiError('Lead not found', 404)

  const status = outcome === 'Failed' ? 'NOT_CONNECTED' : 'CONNECTED'
  const notes = `AI Reminder Call — Ajay Sir voice — ${outcome}`
  await db.callLog.create({
    data: {
      leadId: lead.id,
      userId: user.id,
      direction: 'OUTGOING',
      status,
      channel: 'AI_REMINDER',
      durationSec: 0,
      notes,
    },
  })
  await db.activity.create({
    data: { leadId: lead.id, userId: user.id, type: 'AI_CALL', title: 'AI Reminder Call', description: notes },
  })
  if (lead.assignedToId) {
    await notify(
      lead.assignedToId,
      'AI Reminder Call',
      `${notes} — ${lead.customerName} (${lead.leadCode})`,
      'CALL',
      `/?lead=${lead.id}`
    )
  }
  await audit(user, 'AI_REMINDER_CALL', 'Lead', lead.id, { outcome })
  return ok({ ok: true, outcome })
})
