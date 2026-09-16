import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, assertDeptAccess, audit, MANAGEMENT_ROLES } from '@/lib/api'

// ---------- local helpers ----------

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function idList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

// ---------- POST /api/whatsapp/broadcast (TEAM_LEADER+) ----------

export const POST = route(async (req) => {
  const user = await requireUser([...MANAGEMENT_ROLES])
  const body = await readBody<{
    name?: string
    templateId?: string
    body?: string
    dept?: string
    filters?: { stageIds?: unknown; countryIds?: unknown; stateIds?: unknown; dispositionIds?: unknown; status?: unknown }
    campaignId?: string
  }>(req)

  const dept = str(body.dept)
  if (!dept || !['ONLINE', 'EXPORT'].includes(dept)) {
    throw new ApiError('Valid dept (ONLINE or EXPORT) is required', 400)
  }
  assertDeptAccess(user, dept)

  const templateId = str(body.templateId)
  let templateBody: string | undefined
  if (templateId) {
    const template = await db.whatsAppTemplate.findUnique({ where: { id: templateId }, select: { body: true } })
    if (!template) throw new ApiError('Template not found', 400)
    templateBody = template.body
  }
  const text = templateBody ?? str(body.body)
  if (!text) throw new ApiError('body or templateId is required', 400)

  const filters = body.filters ?? {}
  const status = str(filters.status) || 'ACTIVE'
  const leads = await db.lead.findMany({
    where: {
      department: dept,
      status,
      ...(idList(filters.stageIds).length ? { stageId: { in: idList(filters.stageIds) } } : {}),
      ...(idList(filters.countryIds).length ? { countryId: { in: idList(filters.countryIds) } } : {}),
      ...(idList(filters.stateIds).length ? { stateId: { in: idList(filters.stateIds) } } : {}),
      ...(idList(filters.dispositionIds).length ? { dispositionId: { in: idList(filters.dispositionIds) } } : {}),
    },
    select: { id: true, customerName: true, mobile: true, whatsapp: true, assignedToId: true },
    take: 500,
  })
  if (leads.length === 0) throw new ApiError('No leads match the broadcast filters', 400)

  const name = str(body.name)
  let campaignId = str(body.campaignId)
  if (!campaignId && name) {
    const campaign = await db.campaign.create({
      data: {
        name,
        type: 'BROADCAST',
        channel: 'WHATSAPP',
        department: dept,
        createdById: user.id,
        status: 'ACTIVE',
      },
    })
    campaignId = campaign.id
  }

  let sent = 0
  for (const lead of leads) {
    const phone = lead.whatsapp || lead.mobile
    let conv = await db.whatsAppConversation.findFirst({ where: { phone } })
    if (!conv) {
      const owner = lead.assignedToId
        ?? (await db.user.findFirst({ where: { role: 'EXECUTIVE', isActive: true, department: dept }, select: { id: true } }))?.id
        ?? null
      conv = await db.whatsAppConversation.create({
        data: { phone, name: lead.customerName, dept, ownerId: owner, leadId: lead.id },
      })
    }
    await db.whatsAppMessage.create({
      data: {
        conversationId: conv.id,
        userId: user.id,
        direction: 'OUT',
        type: templateId ? 'TEMPLATE' : 'TEXT',
        body: text,
        templateId,
        status: 'SENT',
        campaignId,
      },
    })
    await db.whatsAppConversation.update({
      where: { id: conv.id },
      data: { lastMessage: text, lastMessageAt: new Date() },
    })
    await db.activity.create({
      data: {
        leadId: lead.id,
        userId: user.id,
        type: 'BROADCAST',
        title: `Broadcast sent — ${name ?? 'WhatsApp broadcast'}`,
        description: text.slice(0, 160),
        meta: campaignId ? JSON.stringify({ campaignId }) : undefined,
      },
    })
    sent += 1
  }

  await audit(user, 'BROADCAST', 'campaign', campaignId, { dept, sent, filters })
  return ok({ sent, campaignId }, 201)
})
