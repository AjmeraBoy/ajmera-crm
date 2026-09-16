import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, deptScope } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'

// ---------- local helpers (mirrors list filters from /api/leads, no pagination) ----------

function toDate(v: string | null | undefined): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
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
  stage: { select: { id: true, label: true } },
  disposition: { select: { id: true, label: true } },
  subDisposition: { select: { id: true, label: true } },
  source: { select: { id: true, label: true } },
  country: { select: { id: true, label: true } },
  state: { select: { id: true, label: true } },
}

// ---------- GET /api/leads/export ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const where = await listWhere(user, sp)
  const leads = await db.lead.findMany({ where, orderBy: listOrderBy(sp), take: 5000, include: leadListInclude })
  const rows = leads.map((l) => ({
    leadCode: l.leadCode,
    customerName: l.customerName,
    companyName: l.companyName,
    mobile: l.mobile,
    whatsapp: l.whatsapp,
    city: l.city,
    state: l.state?.label ?? null,
    country: l.country?.label ?? null,
    source: l.source?.label ?? null,
    stage: l.stage?.label ?? null,
    disposition: l.disposition?.label ?? null,
    subDisposition: l.subDisposition?.label ?? null,
    priority: l.priority,
    estimatedValue: l.estimatedValue,
    assignedTo: l.assignedTo?.name ?? null,
    status: l.status,
    nextFollowUpAt: l.nextFollowUpAt,
    createdAt: l.createdAt,
  }))
  return ok({ rows })
})
