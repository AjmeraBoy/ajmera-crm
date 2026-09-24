import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, assertDeptAccess, audit, notify, MANAGEMENT_ROLES } from '@/lib/api'

// ---------- POST /api/leads/assign ----------

export const POST = route(async (req) => {
  const user = await requireUser([...MANAGEMENT_ROLES])
  const body = await readBody<{ leadIds?: unknown; assignedToId?: string; unsticky?: boolean }>(req)
  const leadIds = Array.isArray(body.leadIds)
    ? body.leadIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : []
  const assignedToId = typeof body.assignedToId === 'string' ? body.assignedToId.trim() : ''
  if (leadIds.length === 0) throw new ApiError('leadIds array is required', 400)
  if (!assignedToId) throw new ApiError('assignedToId is required', 400)

  const target = await db.user.findUnique({ where: { id: assignedToId }, select: { id: true, name: true, isActive: true } })
  if (!target || !target.isActive) throw new ApiError('Target user not found or inactive', 400)

  const leads = await db.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, leadCode: true, customerName: true, department: true },
  })
  if (leads.length === 0) throw new ApiError('No matching leads found', 404)

  let updated = 0
  for (const lead of leads) {
    assertDeptAccess(user, lead.department)
    await db.lead.update({
      where: { id: lead.id },
      data: {
        assignedToId,
        isSticky: !body.unsticky,
        stickySince: body.unsticky ? null : new Date(),
      },
    })
    // move WhatsApp conversations to the new owner
    await db.whatsAppConversation.updateMany({ where: { leadId: lead.id }, data: { ownerId: assignedToId } })
    await db.activity.create({
      data: {
        leadId: lead.id,
        userId: user.id,
        type: 'ASSIGNMENT',
        title: `Lead assigned to ${target.name}`,
        description: `Reassigned by ${user.name}`,
      },
    })
    await notify(assignedToId, 'New lead assigned', `${lead.leadCode} — ${lead.customerName}`, 'LEAD')
    updated += 1
  }

  await audit(user, 'ASSIGN', 'lead', undefined, { leadIds, assignedToId, updated, unsticky: Boolean(body.unsticky) })
  return ok({ updated })
})
