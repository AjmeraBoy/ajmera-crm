import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, deptScope, assertDeptAccess, isManagement } from '@/lib/api'
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

function toDate(v: string | null | undefined): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

async function teamUserIds(user: SessionUser): Promise<string[]> {
  if (!user.teamId) return [user.id]
  const members = await db.user.findMany({ where: { teamId: user.teamId }, select: { id: true } })
  return [...new Set([user.id, ...members.map((m) => m.id)])]
}

/** Exec → own calls. TL → self+team. Management → dept scope via lead.department. */
async function userFilter(user: SessionUser, sp: URLSearchParams): Promise<string | string[] | undefined> {
  const userId = sp.get('userId') || undefined
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
  if (userId) {
    if (user.role === 'TEAM_LEADER') {
      const own = await teamUserIds(user)
      if (!own.includes(userId)) return []
    }
    return userId
  }
  if (user.role === 'TEAM_LEADER') return teamUserIds(user)
  return undefined
}

const callInclude = {
  lead: { select: { id: true, leadCode: true, customerName: true, mobile: true, department: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.CallLogInclude

// ---------- GET /api/calls ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const where: Prisma.CallLogWhereInput = {}
  const f = await userFilter(user, sp)
  if (f !== undefined) where.userId = Array.isArray(f) ? { in: f } : f
  const leadId = sp.get('leadId')
  if (leadId) where.leadId = leadId
  const direction = sp.get('direction')
  if (direction) where.direction = direction
  const status = sp.get('status')
  if (status) where.status = status
  const scope = deptScope(user)
  const dept = sp.get('dept') || undefined
  if (scope || dept) {
    const df: Prisma.StringFilter = {}
    if (scope) df.in = scope
    if (dept) df.equals = dept
    where.lead = { department: df }
  }
  const from = toDate(sp.get('from'))
  const to = toDate(sp.get('to'))
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }

  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize')) || 20))
  const [calls, total, dirGroups, statusGroups, avgAgg] = await Promise.all([
    db.callLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: callInclude,
    }),
    db.callLog.count({ where }),
    db.callLog.groupBy({ by: ['direction'], where, _count: { _all: true } }),
    db.callLog.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.callLog.aggregate({ where, _avg: { durationSec: true } }),
  ])
  const byDir = new Map(dirGroups.map((g) => [g.direction, g._count._all]))
  const byStatus = new Map(statusGroups.map((g) => [g.status, g._count._all]))
  return ok({
    calls,
    total,
    page,
    pageSize,
    summary: {
      total,
      incoming: byDir.get('INCOMING') ?? 0,
      outgoing: byDir.get('OUTGOING') ?? 0,
      missed: byStatus.get('MISSED') ?? 0,
      connected: byStatus.get('CONNECTED') ?? 0,
      notConnected: byStatus.get('NOT_CONNECTED') ?? 0,
      avgTalkTimeSec: Math.round(avgAgg._avg.durationSec ?? 0),
    },
  })
})

// ---------- POST /api/calls ----------

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    leadId?: string
    direction?: string
    status?: string
    durationSec?: number
    notes?: string
    isVideo?: boolean
    channel?: string
  }>(req)
  const leadId = str(body.leadId)
  if (!leadId) throw new ApiError('leadId is required', 400)
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: { id: true, department: true, assignedToId: true, isSticky: true },
  })
  if (!lead) throw new ApiError('Lead not found', 404)
  if (user.role === 'EXECUTIVE' && lead.assignedToId !== user.id) {
    throw new ApiError('You can only log calls on your own leads', 403)
  }
  assertDeptAccess(user, lead.department)

  const direction = str(body.direction) || 'OUTGOING'
  const status = str(body.status) || 'CONNECTED'
  if (!['INCOMING', 'OUTGOING'].includes(direction)) {
    throw new ApiError('direction must be INCOMING or OUTGOING', 400)
  }
  if (!['CONNECTED', 'NOT_CONNECTED', 'MISSED'].includes(status)) {
    throw new ApiError('status must be CONNECTED, NOT_CONNECTED or MISSED', 400)
  }
  const durationSec = toInt(body.durationSec) ?? 0

  const call = await db.callLog.create({
    data: {
      leadId,
      userId: user.id,
      direction,
      status,
      durationSec,
      notes: str(body.notes),
      isVideo: body.isVideo === true,
      channel: str(body.channel) || 'CRM',
    },
    include: callInclude,
  })

  const now = new Date()
  await db.lead.update({
    where: { id: leadId },
    data: {
      lastContactAt: now,
      ...(user.role === 'EXECUTIVE' && !lead.isSticky ? { isSticky: true, stickySince: now } : {}),
    },
  })

  const m = Math.floor(durationSec / 60)
  const s = durationSec % 60
  const durLabel = durationSec > 0 ? ` (${m > 0 ? `${m}m ${s}s` : `${s}s`})` : ''
  const statusLabel = status === 'CONNECTED' ? 'Connected' : status === 'MISSED' ? 'Missed' : 'Not connected'
  await db.activity.create({
    data: {
      leadId,
      userId: user.id,
      type: 'CALL',
      title: `${direction === 'INCOMING' ? 'Incoming' : 'Outgoing'} call — ${statusLabel}${durLabel}`,
      description: str(body.notes),
    },
  })
  return ok({ call }, 201)
})

// ---------- PATCH /api/calls { callId, notes?, dispositionId? } ----------

export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ callId?: string; notes?: string; dispositionId?: string | null }>(req)
  const callId = str(body.callId)
  if (!callId) throw new ApiError('callId is required', 400)

  const call = await db.callLog.findUnique({ where: { id: callId } })
  if (!call) throw new ApiError('Call not found', 404)
  if (call.userId !== user.id && !isManagement(user)) {
    throw new ApiError('You can only update your own calls', 403)
  }

  const data: Record<string, unknown> = {}
  if (body.notes !== undefined) data.notes = String(body.notes).trim() === '' ? null : String(body.notes)
  if (body.dispositionId !== undefined) {
    data.dispositionId = body.dispositionId === null || String(body.dispositionId).trim() === '' ? null : String(body.dispositionId)
  }
  if (Object.keys(data).length === 0) throw new ApiError('Nothing to update (send notes and/or dispositionId)', 400)

  const updated = await db.callLog.update({ where: { id: callId }, data, include: callInclude })

  if (body.notes !== undefined && call.leadId) {
    await db.activity.create({
      data: {
        leadId: call.leadId,
        userId: user.id,
        type: 'CALL',
        title: 'Call note added',
        description: String(body.notes).slice(0, 160) || undefined,
      },
    })
  }
  return ok({ call: updated })
})
