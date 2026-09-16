import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok, route, requireUser, readBody, ApiError, deptScope, assertDeptAccess, isManagement, audit,
} from '@/lib/api'
import { nextCode, leadPrefix, pickExecutiveRoundRobin } from '@/lib/server-utils'
import type { SessionUser } from '@/lib/auth'

// ---------- local helpers ----------

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : undefined
}

function toDate(v: unknown): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const d = v instanceof Date ? v : new Date(String(v))
  return isNaN(d.getTime()) ? undefined : d
}

function dayBounds(d = new Date()) {
  const start = new Date(d)
  start.setHours(0, 0, 0, 0)
  const end = new Date(d)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

async function teamUserIds(user: SessionUser): Promise<string[]> {
  if (!user.teamId) return [user.id]
  const members = await db.user.findMany({ where: { teamId: user.teamId }, select: { id: true } })
  return [...new Set([user.id, ...members.map((m) => m.id)])]
}

/** Same as server-utils.findMaster but without `mode: 'insensitive'` (unsupported by the SQLite connector) */
async function lookupMaster(type: string, label: string, dept?: string): Promise<{ id: string } | null> {
  return db.masterItem.findFirst({
    where: { type, label, isActive: true, ...(dept ? { dept: { in: [dept, 'ALL'] } } : {}) },
    select: { id: true },
  })
}

async function ensureLeadAccess(user: SessionUser, lead: { department: string; assignedToId: string | null }) {
  if (user.role === 'EXECUTIVE' && lead.assignedToId !== user.id) {
    throw new ApiError('You can only access your own leads', 403)
  }
  if (user.role === 'TEAM_LEADER') {
    const ids = await teamUserIds(user)
    if (lead.assignedToId && !ids.includes(lead.assignedToId)) {
      throw new ApiError('This lead belongs to another team', 403)
    }
  }
  assertDeptAccess(user, lead.department)
}

/** Exec → self. TL → self+team (or teamId param). Management → assignedToId param (TL restricted to team). */
async function assigneeFilter(user: SessionUser, sp: URLSearchParams): Promise<string | string[] | undefined> {
  const assignedToId = sp.get('assignedToId') || undefined
  const teamId = sp.get('teamId') || undefined
  if (user.role === 'EXECUTIVE') return user.id
  if (teamId) {
    const members = await db.user.findMany({ where: { teamId }, select: { id: true } })
    let ids = members.map((m) => m.id)
    if (user.role === 'TEAM_LEADER') {
      const own = await teamUserIds(user)
      ids = ids.filter((id) => own.includes(id))
    }
    return ids
  }
  if (assignedToId) {
    if (user.role === 'TEAM_LEADER') {
      const own = await teamUserIds(user)
      if (!own.includes(assignedToId)) return []
    }
    return assignedToId
  }
  if (user.role === 'TEAM_LEADER') return teamUserIds(user)
  return undefined
}

function deptWhere(scope: string[] | null, dept: string | undefined): Prisma.StringFilter | undefined {
  if (!scope && !dept) return undefined
  const f: Prisma.StringFilter = {}
  if (scope) f.in = scope
  if (dept) f.equals = dept
  return f
}

async function listWhere(user: SessionUser, sp: URLSearchParams): Promise<Prisma.LeadWhereInput> {
  const where: Prisma.LeadWhereInput = {}
  const f = await assigneeFilter(user, sp)
  if (f !== undefined) where.assignedToId = Array.isArray(f) ? { in: f } : f
  const dw = deptWhere(deptScope(user), sp.get('dept') || undefined)
  if (dw) where.department = dw
  const q = sp.get('q')
  if (q) {
    where.OR = [
      { customerName: { contains: q } },
      { mobile: { contains: q } },
      { whatsapp: { contains: q } },
      { companyName: { contains: q } },
      { leadCode: { contains: q } },
      { city: { contains: q } },
      { email: { contains: q } },
      { productInterest: { contains: q } },
    ]
  }
  const simple: [keyof Prisma.LeadWhereInput, string][] = [
    ['stageId', 'stageId'],
    ['dispositionId', 'dispositionId'],
    ['subDispositionId', 'subDispositionId'],
    ['sourceId', 'sourceId'],
    ['countryId', 'countryId'],
    ['stateId', 'stateId'],
    ['status', 'status'],
    ['priority', 'priority'],
  ]
  for (const [key, param] of simple) {
    const v = sp.get(param)
    if (v) (where as Record<string, unknown>)[key] = v
  }
  if (sp.get('sticky') === '1') where.isSticky = true
  const { start, end } = dayBounds()
  const followup = sp.get('followup')
  if (followup === 'today') where.nextFollowUpAt = { gte: start, lte: end }
  else if (followup === 'overdue') where.nextFollowUpAt = { lt: start }
  else if (followup === 'upcoming') where.nextFollowUpAt = { gt: end }
  if (followup && !sp.get('status')) where.status = 'ACTIVE'
  if (sp.get('visit') === 'today') where.visitDate = { gte: start, lte: end }
  const from = toDate(sp.get('from'))
  const to = toDate(sp.get('to'))
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
  return where
}

const SORT_FIELDS = ['createdAt', 'nextFollowUpAt', 'customerName', 'priority'] as const

function listOrderBy(sp: URLSearchParams): Prisma.LeadOrderByWithRelationInput {
  const raw = sp.get('sort') || 'createdAt'
  const field = (SORT_FIELDS as readonly string[]).includes(raw) ? raw : 'createdAt'
  const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc'
  return { [field]: dir } as Prisma.LeadOrderByWithRelationInput
}

const leadListInclude: Prisma.LeadInclude = {
  assignedTo: { select: { id: true, name: true } },
  stage: { select: { id: true, label: true, extra: true } },
  disposition: { select: { id: true, label: true, extra: true } },
  subDisposition: { select: { id: true, label: true } },
  source: { select: { id: true, label: true } },
  country: { select: { id: true, label: true } },
  state: { select: { id: true, label: true } },
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

type DispositionExtra = { showCallback?: boolean; showFollowUp?: boolean; showEstimated?: boolean; showPayment?: boolean }

function parseExtra(raw: string | null | undefined): DispositionExtra {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as DispositionExtra
  } catch {
    return {}
  }
}

// ---------- GET /api/leads ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const where = await listWhere(user, sp)
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize')) || 20))
  const [leads, total, statusGroups, stickyCount] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: listOrderBy(sp),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: leadListInclude,
    }),
    db.lead.count({ where }),
    db.lead.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.lead.count({ where: { ...where, isSticky: true } }),
  ])
  const byStatus = new Map(statusGroups.map((g) => [g.status, g._count._all]))
  return ok({
    leads,
    total,
    page,
    pageSize,
    summary: {
      total,
      active: byStatus.get('ACTIVE') ?? 0,
      converted: byStatus.get('CONVERTED') ?? 0,
      lost: byStatus.get('LOST') ?? 0,
      sticky: stickyCount,
    },
  })
})

// ---------- POST /api/leads ----------

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<Record<string, unknown>>(req)
  const department = str(body.department)
  const customerName = str(body.customerName)
  const mobile = str(body.mobile)
  if (!department || !['ONLINE', 'EXPORT'].includes(department)) {
    throw new ApiError('Valid department (ONLINE or EXPORT) is required', 400)
  }
  if (!customerName) throw new ApiError('Customer name is required', 400)
  if (!mobile) throw new ApiError('Mobile number is required', 400)

  const allowDuplicate = body.allowDuplicate === true || body.allowDuplicate === 'true' || body.allowDuplicate === 1
  const existing = await db.lead.findFirst({
    where: { mobile, department },
    select: { id: true, leadCode: true, customerName: true },
  })
  if (existing && !allowDuplicate) {
    return NextResponse.json({ error: 'Duplicate mobile number', existing }, { status: 409 })
  }

  const sourceId = str(body.sourceId)
  let sourceLabel: string | undefined
  if (sourceId) {
    const source = await db.masterItem.findUnique({ where: { id: sourceId }, select: { label: true } })
    if (!source) throw new ApiError('Invalid lead source', 400)
    sourceLabel = source.label
    if (sourceLabel.toLowerCase().includes('visit') && !toDate(body.visitDate)) {
      throw new ApiError('Visit date is required for Visit source leads', 400)
    }
  }

  const stageId = str(body.stageId) || (await lookupMaster('pipeline_stage', 'New Lead', department))?.id
  const masterRefIds = [sourceId, str(body.stateId), str(body.countryId), str(body.businessTypeId), stageId].filter(
    (x): x is string => Boolean(x)
  )
  if (masterRefIds.length) {
    const found = await db.masterItem.findMany({ where: { id: { in: masterRefIds } }, select: { id: true } })
    if (found.length !== new Set(masterRefIds).size) {
      throw new ApiError('Invalid source/state/country/business type/stage reference', 400)
    }
  }
  const campaignId = str(body.campaignId)
  if (campaignId) {
    const camp = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true } })
    if (!camp) throw new ApiError('Invalid campaign', 400)
  }

  let assignedToId: string | undefined
  const requested = str(body.assignedToId)
  if (isManagement(user) && requested) {
    const target = await db.user.findUnique({ where: { id: requested }, select: { id: true, isActive: true } })
    if (!target || !target.isActive) throw new ApiError('Assigned user not found or inactive', 400)
    assignedToId = requested
  } else if (user.role === 'EXECUTIVE') {
    assignedToId = user.id
  } else {
    assignedToId = (await pickExecutiveRoundRobin(department))?.id
  }

  const leadCode = await nextCode(leadPrefix(department), 'lead')
  const lead = await db.lead.create({
    data: {
      leadCode,
      department,
      customerName,
      companyName: str(body.companyName),
      mobile,
      whatsapp: str(body.whatsapp) || (department === 'EXPORT' ? mobile : undefined),
      email: str(body.email),
      city: str(body.city),
      stateId: str(body.stateId),
      countryId: str(body.countryId),
      businessTypeId: str(body.businessTypeId),
      productInterest: str(body.productInterest),
      requirementNotes: str(body.requirementNotes),
      monthlyVolume: toInt(body.monthlyVolume),
      budget: toInt(body.budget),
      sourceId,
      visitDate: toDate(body.visitDate),
      visitTime: str(body.visitTime),
      assignedToId,
      createdById: user.id,
      stageId,
      priority: str(body.priority),
      notes: str(body.notes),
      status: str(body.status) || 'ACTIVE',
      campaignId,
    },
  })

  await db.activity.create({
    data: {
      leadId: lead.id,
      userId: user.id,
      type: 'LEAD',
      title: `New lead created — ${lead.customerName}`,
      description: sourceLabel ? `Source: ${sourceLabel}` : undefined,
    },
  })
  await audit(user, 'CREATE', 'lead', lead.id, { leadCode: lead.leadCode, department })

  const bundle = await leadDetailBundle(lead.id)
  if (!bundle) throw new ApiError('Lead could not be loaded after creation', 500)
  return ok(bundle, 201)
})

// ---------- PATCH /api/leads ----------

export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<Record<string, unknown>>(req)
  const id = str(body.id)
  if (!id) throw new ApiError('Lead id is required', 400)
  const lead = await db.lead.findUnique({ where: { id }, include: { stage: { select: { label: true } } } })
  if (!lead) throw new ApiError('Lead not found', 404)
  await ensureLeadAccess(user, lead)

  const data: Prisma.LeadUncheckedUpdateInput = {}
  const stringFields = [
    'customerName', 'companyName', 'mobile', 'whatsapp', 'email', 'city',
    'stateId', 'countryId', 'businessTypeId', 'productInterest', 'requirementNotes',
    'sourceId', 'visitTime', 'priority', 'notes', 'status', 'customerType', 'campaignId',
  ] as const
  for (const f of stringFields) {
    if (body[f] !== undefined) (data as Record<string, unknown>)[f] = str(body[f])
  }
  for (const f of ['monthlyVolume', 'budget', 'estimatedValue'] as const) {
    if (body[f] !== undefined) {
      const n = toInt(body[f])
      if (n === undefined) throw new ApiError(`${f} must be a number`, 400)
      ;(data as Record<string, unknown>)[f] = n
    }
  }
  if (body.visitDate !== undefined) data.visitDate = toDate(body.visitDate) ?? null
  if (body.nextFollowUpAt !== undefined) data.nextFollowUpAt = toDate(body.nextFollowUpAt) ?? null

  const masterRefIds = ['stateId', 'countryId', 'businessTypeId', 'sourceId']
    .map((f) => str(body[f]))
    .filter((x): x is string => Boolean(x))
  if (masterRefIds.length) {
    const found = await db.masterItem.findMany({ where: { id: { in: masterRefIds } }, select: { id: true } })
    if (found.length !== new Set(masterRefIds).size) {
      throw new ApiError('Invalid state/country/business type/source reference', 400)
    }
  }
  const campaignId = str(body.campaignId)
  if (campaignId) {
    const camp = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true } })
    if (!camp) throw new ApiError('Invalid campaign', 400)
  }

  let stageActivityTitle: string | undefined
  const stageId = str(body.stageId)
  if (stageId && stageId !== lead.stageId) {
    const stage = await db.masterItem.findUnique({ where: { id: stageId }, select: { id: true, label: true } })
    if (!stage) throw new ApiError('Invalid stage', 400)
    data.stageId = stage.id
    stageActivityTitle = `Stage: ${lead.stage?.label ?? 'None'} → ${stage.label}`
  }

  let dispositionLabel: string | undefined
  let dispositionDesc: string | undefined
  let paymentActivity: { title: string; description: string } | null = null
  const duRaw = body.dispositionUpdate
  const du = duRaw && typeof duRaw === 'object' ? (duRaw as Record<string, unknown>) : null
  if (du) {
    const dispositionId = str(du.dispositionId)
    const subDispositionId = str(du.subDispositionId)
    if (!dispositionId) throw new ApiError('dispositionId is required in dispositionUpdate', 400)
    const disposition = await db.masterItem.findUnique({ where: { id: dispositionId } })
    if (!disposition) throw new ApiError('Invalid disposition', 400)
    data.dispositionId = disposition.id
    data.subDispositionId = subDispositionId ?? null

    const extra = parseExtra(disposition.extra)
    const callbackAt = toDate(du.callbackAt)
    const followUpAt = toDate(du.followUpAt)
    const paymentAmount = toInt(du.paymentAmount)
    const estimatedValue = toInt(du.estimatedValue)
    const note = str(du.note)

    const dueAt = extra.showCallback && callbackAt ? callbackAt : extra.showFollowUp && followUpAt ? followUpAt : undefined
    if (dueAt) {
      data.nextFollowUpAt = dueAt
      await db.followUp.create({
        data: { leadId: lead.id, assignedToId: lead.assignedToId, createdById: user.id, dueAt, note, status: 'PENDING' },
      })
    }
    if (extra.showEstimated && estimatedValue !== undefined) data.estimatedValue = estimatedValue
    if (extra.showPayment && paymentAmount !== undefined && paymentAmount > 0) {
      const receiptNo = await nextCode('RCP', 'payment')
      const mode = str(du.mode) || 'UPI'
      await db.payment.create({
        data: { receiptNo, leadId: lead.id, amount: paymentAmount, mode, department: lead.department, notes: note, createdById: user.id },
      })
      paymentActivity = {
        title: `Payment received — ₹${paymentAmount.toLocaleString('en-IN')} via ${mode}`,
        description: `Receipt ${receiptNo}`,
      }
    }

    let subLabel: string | undefined
    if (subDispositionId) {
      const sub = await db.masterItem.findUnique({ where: { id: subDispositionId }, select: { label: true } })
      subLabel = sub?.label
    }
    dispositionLabel = disposition.label
    dispositionDesc = [subLabel, note].filter(Boolean).join(' — ') || undefined
    data.lastContactAt = new Date()
  }

  if (user.role === 'EXECUTIVE' && !lead.isSticky) {
    data.isSticky = true
    data.stickySince = new Date()
  }

  await db.lead.update({ where: { id }, data })
  if (stageActivityTitle) {
    await db.activity.create({ data: { leadId: id, userId: user.id, type: 'STAGE', title: stageActivityTitle } })
  }
  if (dispositionLabel) {
    await db.activity.create({
      data: {
        leadId: id, userId: user.id, type: 'DISPOSITION',
        title: `Disposition: ${dispositionLabel}`, description: dispositionDesc, meta: JSON.stringify(du),
      },
    })
  }
  if (paymentActivity) {
    await db.activity.create({
      data: { leadId: id, userId: user.id, type: 'PAYMENT', title: paymentActivity.title, description: paymentActivity.description },
    })
  }
  await audit(user, 'UPDATE', 'lead', id, { stageId: data.stageId, dispositionId: data.dispositionId })

  const bundle = await leadDetailBundle(id)
  if (!bundle) throw new ApiError('Lead could not be loaded after update', 500)
  return ok(bundle)
})

// ---------- DELETE /api/leads?id= ----------

export const DELETE = route(async (req) => {
  const user = await requireUser(['ADMIN', 'SUPER_ADMIN'])
  const id = new URL(req.url).searchParams.get('id')
  if (!id) throw new ApiError('Lead id is required', 400)
  const lead = await db.lead.findUnique({ where: { id }, select: { id: true, leadCode: true, department: true } })
  if (!lead) throw new ApiError('Lead not found', 404)
  assertDeptAccess(user, lead.department)
  // Meetings have a required lead relation (Restrict) — remove them first; other optional relations are SetNull
  await db.meeting.deleteMany({ where: { leadId: id } })
  await db.lead.delete({ where: { id } })
  await audit(user, 'DELETE', 'lead', id, { leadCode: lead.leadCode })
  return ok({ success: true })
})
