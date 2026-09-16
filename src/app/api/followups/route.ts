import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, deptScope, assertDeptAccess } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'

// ---------- local helpers ----------

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
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

const followupInclude = {
  lead: {
    select: {
      id: true, leadCode: true, customerName: true, mobile: true, department: true,
      stage: { select: { id: true, label: true } },
    },
  },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.FollowUpInclude

function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---------- GET /api/followups ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const where: Prisma.FollowUpWhereInput = {}
  const f = await assigneeFilter(user, sp)
  if (f !== undefined) where.assignedToId = Array.isArray(f) ? { in: f } : f
  const dw = deptWhere(deptScope(user), sp.get('dept') || undefined)
  if (dw) where.lead = { department: dw }

  const due = sp.get('due') || 'all'
  const { start, end } = dayBounds()
  if (due === 'today') {
    where.dueAt = { gte: start, lte: end }
    where.status = 'PENDING'
  } else if (due === 'overdue') {
    where.dueAt = { lt: start }
    where.status = 'PENDING'
  } else if (due === 'upcoming') {
    where.dueAt = { gt: end }
    where.status = 'PENDING'
  } else if (due === 'completed') {
    where.status = 'COMPLETED'
  }

  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize')) || 20))
  const [followups, total] = await Promise.all([
    db.followUp.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: followupInclude,
    }),
    db.followUp.count({ where }),
  ])
  return ok({ followups, total, page, pageSize })
})

// ---------- POST /api/followups ----------

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ leadId?: string; dueAt?: string; note?: string }>(req)
  const leadId = str(body.leadId)
  const dueAt = toDate(body.dueAt)
  if (!leadId) throw new ApiError('leadId is required', 400)
  if (!dueAt) throw new ApiError('Valid dueAt is required', 400)

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, customerName: true, department: true, assignedToId: true },
  })
  if (!lead) throw new ApiError('Lead not found', 404)
  await ensureLeadAccess(user, lead)

  const followup = await db.followUp.create({
    data: {
      leadId,
      assignedToId: lead.assignedToId ?? user.id,
      createdById: user.id,
      dueAt,
      note: str(body.note),
      status: 'PENDING',
    },
    include: followupInclude,
  })
  await db.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: dueAt } })
  await db.activity.create({
    data: {
      leadId,
      userId: user.id,
      type: 'FOLLOWUP',
      title: `Follow-up scheduled — ${dateLabel(dueAt)}`,
      description: str(body.note),
    },
  })
  return ok({ followup }, 201)
})

// ---------- PATCH /api/followups ----------

export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ id?: string; status?: string; outcome?: string; rescheduleTo?: string; note?: string }>(req)
  const id = str(body.id)
  if (!id) throw new ApiError('Follow-up id is required', 400)
  const existing = await db.followUp.findUnique({
    where: { id },
    include: { lead: { select: { id: true, department: true, assignedToId: true } } },
  })
  if (!existing) throw new ApiError('Follow-up not found', 404)
  if (user.role === 'EXECUTIVE' && existing.assignedToId !== user.id && existing.createdById !== user.id) {
    throw new ApiError('You can only update your own follow-ups', 403)
  }
  assertDeptAccess(user, existing.lead.department)

  const data: Prisma.FollowUpUncheckedUpdateInput = {}
  const status = str(body.status)
  const outcome = str(body.outcome)
  const note = str(body.note)
  const rescheduleTo = toDate(body.rescheduleTo)
  if (status) data.status = status
  if (body.outcome !== undefined) data.outcome = outcome
  if (body.note !== undefined) data.note = note

  if (status === 'COMPLETED') {
    data.completedAt = new Date()
    await db.lead.update({ where: { id: existing.leadId }, data: { lastFollowUpAt: new Date() } })
    await db.activity.create({
      data: {
        leadId: existing.leadId,
        userId: user.id,
        type: 'FOLLOWUP',
        title: `Follow-up completed${outcome ? ` — ${outcome}` : ''}`,
        description: note,
      },
    })
  }
  if (status === 'RESCHEDULED') {
    if (!rescheduleTo) throw new ApiError('rescheduleTo is required when status is RESCHEDULED', 400)
    data.dueAt = rescheduleTo
    await db.lead.update({ where: { id: existing.leadId }, data: { nextFollowUpAt: rescheduleTo } })
    await db.activity.create({
      data: {
        leadId: existing.leadId,
        userId: user.id,
        type: 'FOLLOWUP',
        title: `Follow-up rescheduled — ${dateLabel(rescheduleTo)}`,
        description: note,
      },
    })
  }

  const followup = await db.followUp.update({ where: { id }, data, include: followupInclude })
  return ok({ followup })
})
