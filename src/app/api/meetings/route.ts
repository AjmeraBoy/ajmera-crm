import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, deptScope, assertDeptAccess, notify } from '@/lib/api'
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

async function teamUserIds(user: SessionUser): Promise<string[]> {
  if (!user.teamId) return [user.id]
  const members = await db.user.findMany({ where: { teamId: user.teamId }, select: { id: true } })
  return [...new Set([user.id, ...members.map((m) => m.id)])]
}

function randomCode(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

const meetingInclude = {
  lead: { select: { id: true, leadCode: true, customerName: true, department: true } },
  executive: { select: { id: true, name: true } },
} satisfies Prisma.MeetingInclude

// ---------- GET /api/meetings?leadId=&upcoming=1&dept=&from=&to= ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const and: Prisma.MeetingWhereInput[] = []
  if (user.role === 'EXECUTIVE') {
    and.push({ OR: [{ executiveId: user.id }, { lead: { assignedToId: user.id } }] })
  } else if (user.role === 'TEAM_LEADER') {
    const ids = await teamUserIds(user)
    and.push({ OR: [{ executiveId: { in: ids } }, { lead: { assignedToId: { in: ids } } }] })
  } else {
    const scope = deptScope(user)
    if (scope) and.push({ lead: { department: { in: scope } } })
  }
  const dept = sp.get('dept')
  if (dept) and.push({ lead: { department: dept } })
  const leadId = sp.get('leadId')
  if (leadId) and.push({ leadId })
  if (sp.get('upcoming') === '1') and.push({ scheduledAt: { gte: new Date() } })
  const from = toDate(sp.get('from'))
  const to = toDate(sp.get('to'))
  if (from || to) and.push({ scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } })

  const meetings = await db.meeting.findMany({
    where: and.length ? { AND: and } : {},
    orderBy: { scheduledAt: sp.get('upcoming') === '1' ? 'asc' : 'desc' },
    include: meetingInclude,
  })
  return ok({ meetings })
})

// ---------- POST /api/meetings ----------

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ leadId?: string; title?: string; scheduledAt?: string; link?: string }>(req)
  const leadId = str(body.leadId)
  const title = str(body.title)
  const scheduledAt = toDate(body.scheduledAt)
  if (!leadId) throw new ApiError('leadId is required', 400)
  if (!title) throw new ApiError('Meeting title is required', 400)
  if (!scheduledAt) throw new ApiError('Valid scheduledAt is required', 400)

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, department: true, assignedToId: true, customerName: true },
  })
  if (!lead) throw new ApiError('Lead not found', 404)
  if (user.role === 'EXECUTIVE' && lead.assignedToId !== user.id) {
    throw new ApiError('You can only schedule meetings on your own leads', 403)
  }
  assertDeptAccess(user, lead.department)

  const link = str(body.link) || `https://meet.google.com/ajm-${randomCode(6)}`
  const meeting = await db.meeting.create({
    data: {
      leadId,
      title,
      scheduledAt,
      executiveId: lead.assignedToId ?? user.id,
      link,
    },
    include: meetingInclude,
  })

  const when = scheduledAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  await db.activity.create({
    data: {
      leadId,
      userId: user.id,
      type: 'MEETING',
      title: `Meeting scheduled — ${title}`,
      description: `${when} — ${link}`,
    },
  })
  if (lead.assignedToId && lead.assignedToId !== user.id) {
    await notify(lead.assignedToId, 'Meeting scheduled', `${title} — ${lead.customerName} (${when})`, 'INFO')
  }
  return ok({ meeting }, 201)
})

// ---------- PATCH /api/meetings ----------

export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    id?: string
    outcome?: string
    notes?: string
    followUpAction?: string
    scheduledAt?: string
    link?: string
  }>(req)
  const id = str(body.id)
  if (!id) throw new ApiError('Meeting id is required', 400)
  const existing = await db.meeting.findUnique({
    where: { id },
    include: { lead: { select: { id: true, department: true, assignedToId: true } } },
  })
  if (!existing) throw new ApiError('Meeting not found', 404)
  if (user.role === 'EXECUTIVE' && existing.executiveId !== user.id && existing.lead.assignedToId !== user.id) {
    throw new ApiError('You can only update your own meetings', 403)
  }
  assertDeptAccess(user, existing.lead.department)

  const data: Prisma.MeetingUncheckedUpdateInput = {}
  const outcome = str(body.outcome)
  if (body.outcome !== undefined) data.outcome = outcome
  if (body.notes !== undefined) data.notes = str(body.notes)
  if (body.followUpAction !== undefined) data.followUpAction = str(body.followUpAction)
  if (body.link !== undefined) data.link = str(body.link)
  const scheduledAt = toDate(body.scheduledAt)
  if (body.scheduledAt !== undefined) {
    if (!scheduledAt) throw new ApiError('Valid scheduledAt is required', 400)
    data.scheduledAt = scheduledAt
  }

  const meeting = await db.meeting.update({ where: { id }, data, include: meetingInclude })
  if (outcome) {
    await db.activity.create({
      data: {
        leadId: existing.leadId,
        userId: user.id,
        type: 'MEETING',
        title: `Meeting outcome: ${outcome}`,
        description: `${existing.title}${data.notes ? ` — ${str(body.notes)}` : ''}`,
      },
    })
  }
  return ok({ meeting })
})
