import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, deptScope, assertDeptAccess, audit } from '@/lib/api'

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

// ---------- GET /api/campaigns?dept=&status= ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const where: Prisma.CampaignWhereInput = {}
  const scope = deptScope(user)
  const dept = sp.get('dept') || undefined
  if (scope || dept) {
    const df: Prisma.StringNullableFilter = {}
    if (scope) df.in = scope
    if (dept) df.equals = dept
    where.department = df
  }
  const status = sp.get('status')
  if (status) where.status = status

  const campaigns = await db.campaign.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { leads: true, messages: true } },
    },
  })
  return ok({
    campaigns: campaigns.map(({ _count, ...c }) => ({
      ...c,
      leadsCount: _count.leads,
      messagesCount: _count.messages,
    })),
  })
})

// ---------- POST /api/campaigns ----------

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    name?: string
    type?: string
    channel?: string
    department?: string
    description?: string
    startDate?: string
    endDate?: string
    budget?: number
  }>(req)
  const name = str(body.name)
  if (!name) throw new ApiError('Campaign name is required', 400)
  const department = str(body.department)
  assertDeptAccess(user, department)
  const type = str(body.type) || 'OUTGOING'
  const channel = str(body.channel) || 'WHATSAPP'
  if (!['INCOMING', 'OUTGOING', 'BROADCAST'].includes(type)) throw new ApiError('Invalid campaign type', 400)
  if (!['WHATSAPP', 'CALL', 'SMS', 'EMAIL'].includes(channel)) throw new ApiError('Invalid campaign channel', 400)

  const campaign = await db.campaign.create({
    data: {
      name,
      type,
      channel,
      department,
      description: str(body.description),
      startDate: toDate(body.startDate),
      endDate: toDate(body.endDate),
      budget: toInt(body.budget) ?? 0,
      createdById: user.id,
    },
  })
  await audit(user, 'CREATE', 'campaign', campaign.id, { name })
  return ok({ campaign }, 201)
})

// ---------- PATCH /api/campaigns ----------

export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    id?: string
    status?: string
    description?: string
    budget?: number
    conversions?: number
    revenue?: number
    startDate?: string
    endDate?: string
    name?: string
  }>(req)
  const id = str(body.id)
  if (!id) throw new ApiError('Campaign id is required', 400)
  const existing = await db.campaign.findUnique({ where: { id } })
  if (!existing) throw new ApiError('Campaign not found', 404)
  assertDeptAccess(user, existing.department)

  const data: Prisma.CampaignUncheckedUpdateInput = {}
  if (body.name !== undefined) data.name = str(body.name)
  if (body.status !== undefined) {
    const status = str(body.status)
    if (!status || !['ACTIVE', 'PAUSED', 'COMPLETED'].includes(status)) {
      throw new ApiError('status must be ACTIVE, PAUSED or COMPLETED', 400)
    }
    data.status = status
  }
  if (body.description !== undefined) data.description = str(body.description)
  if (body.budget !== undefined) data.budget = toInt(body.budget) ?? 0
  if (body.conversions !== undefined) data.conversions = Math.max(0, toInt(body.conversions) ?? 0)
  if (body.revenue !== undefined) data.revenue = Math.max(0, toInt(body.revenue) ?? 0)
  if (body.startDate !== undefined) data.startDate = toDate(body.startDate) ?? null
  if (body.endDate !== undefined) data.endDate = toDate(body.endDate) ?? null

  const campaign = await db.campaign.update({ where: { id }, data })
  await audit(user, 'UPDATE', 'campaign', id, { status: data.status })
  return ok({ campaign })
})
