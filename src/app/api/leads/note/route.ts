import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, assertDeptAccess } from '@/lib/api'

// ---------- local helpers ----------

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

// ---------- POST /api/leads/note ----------

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ leadId?: string; note?: string }>(req)
  const leadId = str(body.leadId)
  const note = str(body.note)
  if (!leadId) throw new ApiError('leadId is required', 400)
  if (!note) throw new ApiError('note is required', 400)

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, notes: true, department: true, assignedToId: true, isSticky: true },
  })
  if (!lead) throw new ApiError('Lead not found', 404)
  if (user.role === 'EXECUTIVE' && lead.assignedToId !== user.id) {
    throw new ApiError('You can only add notes to your own leads', 403)
  }
  assertDeptAccess(user, lead.department)

  const now = new Date()
  await db.lead.update({
    where: { id: leadId },
    data: {
      notes: lead.notes ? `${lead.notes}\n${note}` : note,
      lastContactAt: now,
      ...(user.role === 'EXECUTIVE' && !lead.isSticky ? { isSticky: true, stickySince: now } : {}),
    },
  })
  const activity = await db.activity.create({
    data: { leadId, userId: user.id, type: 'NOTE', title: 'Note added', description: note },
  })
  return ok({ activity }, 201)
})
