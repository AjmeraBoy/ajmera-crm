import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, ApiError, assertDeptAccess } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'

// ---------- local helpers ----------

async function teamUserIds(user: SessionUser): Promise<string[]> {
  if (!user.teamId) return [user.id]
  const members = await db.user.findMany({ where: { teamId: user.teamId }, select: { id: true } })
  return [...new Set([user.id, ...members.map((m) => m.id)])]
}

async function ensureLeadAccess(user: SessionUser, lead: { department: string; assignedToId: string | null }) {
  if (user.role === 'EXECUTIVE' && lead.assignedToId !== user.id) {
    throw new ApiError('You can only view your own leads', 403)
  }
  if (user.role === 'TEAM_LEADER') {
    const ids = await teamUserIds(user)
    if (lead.assignedToId && !ids.includes(lead.assignedToId)) {
      throw new ApiError('This lead belongs to another team', 403)
    }
  }
  assertDeptAccess(user, lead.department)
}

const leadDetailInclude: Prisma.LeadInclude = {
  assignedTo: { select: { id: true, name: true, role: true, phone: true, email: true } },
  createdBy: { select: { id: true, name: true } },
  stage: true,
  disposition: true,
  subDisposition: true,
  source: true,
  country: true,
  state: true,
  businessType: true,
  campaign: { select: { id: true, name: true } },
}

async function leadDetailBundle(leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId }, include: leadDetailInclude })
  if (!lead) return null
  const [activities, followups, callLogs, quotations, orders, payments, tickets, meetings, documents, conversations] =
    await Promise.all([
      db.activity.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { id: true, name: true } } } }),
      db.followUp.findMany({ where: { leadId }, orderBy: { dueAt: 'desc' }, include: { assignedTo: { select: { id: true, name: true } } } }),
      db.callLog.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, name: true } } } }),
      db.quotation.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
      db.salesOrder.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' }, include: { invoices: true, shipment: true } }),
      db.payment.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
      db.supportTicket.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
      db.meeting.findMany({ where: { leadId }, orderBy: { scheduledAt: 'desc' } }),
      db.document.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
      db.whatsAppConversation.findMany({ where: { leadId }, select: { id: true, phone: true, unreadCount: true, lastMessageAt: true } }),
    ])
  return { lead, activities, followups, callLogs, quotations, orders, payments, tickets, meetings, documents, conversations }
}

// ---------- GET /api/leads/detail?id= ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) throw new ApiError('Lead id is required', 400)
  const lead = await db.lead.findUnique({
    where: { id },
    select: { id: true, department: true, assignedToId: true },
  })
  if (!lead) throw new ApiError('Lead not found', 404)
  await ensureLeadAccess(user, lead)
  const bundle = await leadDetailBundle(id)
  if (!bundle) throw new ApiError('Lead not found', 404)
  return ok(bundle)
})
