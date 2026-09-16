import type { Lead, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ApiError,
  assertDeptAccess,
  audit,
  deptScope,
  notify,
  ok,
  readBody,
  requireUser,
  route,
} from '@/lib/api'
import { nextCode } from '@/lib/server-utils'
import type { SessionUser } from '@/lib/auth'

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ESCALATED']
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const SLA_HOURS: Record<string, number> = { URGENT: 8, HIGH: 24, MEDIUM: 48, LOW: 72 }

const TICKET_INCLUDE = {
  lead: { select: { id: true, leadCode: true, customerName: true } },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.SupportTicketInclude

function paging(sp: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1))
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(sp.get('pageSize')) || 20)))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

function deptFilter(sp: URLSearchParams, user: SessionUser): string[] | null {
  const scope = deptScope(user)
  const dept = sp.get('dept')
  if (dept) return scope && !scope.includes(dept) ? [] : [dept]
  return scope
}

// GET /api/tickets?status=&dept=&q=&assignedToId=&page=
export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const { page, pageSize, skip, take } = paging(sp)
  const q = sp.get('q')?.trim()
  const status = sp.get('status') || undefined
  const assignedToId = sp.get('assignedToId') || undefined
  const depts = deptFilter(sp, user)
  const AND: Prisma.SupportTicketWhereInput[] = []
  if (depts) AND.push({ department: { in: depts } })
  if (assignedToId) AND.push({ assignedToId })
  if (q) {
    AND.push({
      OR: [
        { ticketNo: { contains: q } },
        { subject: { contains: q } },
        { lead: { customerName: { contains: q } } },
      ],
    })
  }
  const baseWhere: Prisma.SupportTicketWhereInput = AND.length ? { AND } : {}
  const where: Prisma.SupportTicketWhereInput = { ...baseWhere, ...(status ? { status } : {}) }
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const [rows, total, open, inProgress, escalated, resolvedToday] = await Promise.all([
    db.supportTicket.findMany({ where, include: TICKET_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
    db.supportTicket.count({ where }),
    db.supportTicket.count({ where: { ...baseWhere, status: 'OPEN' } }),
    db.supportTicket.count({ where: { ...baseWhere, status: 'IN_PROGRESS' } }),
    db.supportTicket.count({ where: { ...baseWhere, status: 'ESCALATED' } }),
    db.supportTicket.count({
      where: { ...baseWhere, status: { in: ['RESOLVED', 'CLOSED'] }, resolvedAt: { gte: todayStart } },
    }),
  ])
  return ok({
    tickets: rows,
    total,
    summary: { open, inProgress, escalated, resolvedToday },
  })
})

// POST /api/tickets {leadId?, type, priority?, subject, description?, assignedToId?}
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    leadId?: string
    type?: string
    priority?: string
    subject?: string
    description?: string
    assignedToId?: string
  }>(req)
  if (!body.type) throw new ApiError('type is required', 400)
  if (!body.subject || !body.subject.trim()) throw new ApiError('subject is required', 400)
  let lead: Lead | null = null
  let department = user.department || 'ONLINE'
  if (body.leadId) {
    lead = await db.lead.findUnique({ where: { id: body.leadId } })
    if (!lead) throw new ApiError('Lead not found', 404)
    department = lead.department
  }
  assertDeptAccess(user, department)
  const priority = body.priority && TICKET_PRIORITIES.includes(body.priority) ? body.priority : 'MEDIUM'
  const slaDueAt = new Date(Date.now() + (SLA_HOURS[priority] ?? 48) * 60 * 60 * 1000)
  const ticketNo = await nextCode('TKT', 'ticket')
  const ticket = await db.supportTicket.create({
    data: {
      ticketNo,
      leadId: lead?.id ?? null,
      department,
      type: body.type,
      priority,
      subject: body.subject.trim(),
      description: body.description ?? null,
      assignedToId: body.assignedToId || null,
      createdById: user.id,
      slaDueAt,
    },
    include: TICKET_INCLUDE,
  })
  if (lead) {
    await db.activity.create({
      data: {
        leadId: lead.id,
        userId: user.id,
        type: 'TICKET',
        title: `Ticket ${ticketNo}: ${ticket.subject}`,
        description: `${ticket.type} [${priority}]`,
        meta: JSON.stringify({ ticketId: ticket.id, priority }),
      },
    })
  }
  // notify support users + assignee (skip the creator)
  const supporters = await db.user.findMany({ where: { role: 'SUPPORT', isActive: true }, select: { id: true } })
  for (const s of supporters) {
    if (s.id !== user.id) await notify(s.id, `New ticket ${ticketNo}`, `${ticket.subject} [${priority}]`, 'TICKET')
  }
  if (body.assignedToId && body.assignedToId !== user.id) {
    await notify(body.assignedToId, `Ticket ${ticketNo} assigned to you`, ticket.subject, 'TICKET')
  }
  await audit(user, 'CREATE', 'ticket', ticket.id, { ticketNo, priority })
  return ok({ ticket }, 201)
})

// PATCH /api/tickets {id, status?, priority?, assignedToId?, type?}
export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    id?: string
    status?: string
    priority?: string
    assignedToId?: string
    type?: string
  }>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.supportTicket.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Ticket not found', 404)
  assertDeptAccess(user, existing.department)
  if (body.status && !TICKET_STATUSES.includes(body.status)) {
    throw new ApiError(`Invalid status. Allowed: ${TICKET_STATUSES.join(', ')}`, 400)
  }
  if (body.priority && !TICKET_PRIORITIES.includes(body.priority)) {
    throw new ApiError(`Invalid priority. Allowed: ${TICKET_PRIORITIES.join(', ')}`, 400)
  }
  const data: Prisma.SupportTicketUpdateInput = {}
  if (body.status !== undefined) data.status = body.status
  if (body.priority !== undefined) data.priority = body.priority
  if (body.type !== undefined) data.type = body.type
  if (body.assignedToId !== undefined) data.assignedTo = body.assignedToId ? { connect: { id: body.assignedToId } } : { disconnect: true }
  const nowResolved = body.status === 'RESOLVED' || body.status === 'CLOSED'
  if (nowResolved && existing.status !== 'RESOLVED' && existing.status !== 'CLOSED') {
    data.resolvedAt = new Date()
  }
  const ticket = await db.supportTicket.update({ where: { id: existing.id }, data, include: TICKET_INCLUDE })

  const statusChanged = body.status !== undefined && body.status !== existing.status
  const escalated = body.status === 'ESCALATED' && existing.status !== 'ESCALATED'
  if (escalated) {
    const managers = await db.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: 'SUPER_ADMIN' },
          { role: 'MANAGER', department: existing.department },
          { role: 'ADMIN', department: existing.department },
        ],
      },
      select: { id: true },
    })
    for (const m of managers) {
      if (m.id !== user.id) {
        await notify(m.id, `Ticket ${existing.ticketNo} escalated`, existing.subject, 'ALERT')
      }
    }
  }
  const assigneeChanged =
    body.assignedToId !== undefined && (body.assignedToId || null) !== existing.assignedToId
  if (assigneeChanged && body.assignedToId && body.assignedToId !== user.id) {
    await notify(body.assignedToId, `Ticket ${existing.ticketNo} assigned to you`, existing.subject, 'TICKET')
  }
  if (existing.leadId && (statusChanged || assigneeChanged || body.priority)) {
    await db.activity.create({
      data: {
        leadId: existing.leadId,
        userId: user.id,
        type: 'TICKET',
        title: `Ticket ${existing.ticketNo} — ${body.status ?? 'updated'}`,
        description: escalated ? 'Escalated to managers' : undefined,
        meta: JSON.stringify({ ticketId: existing.id, status: body.status, priority: body.priority }),
      },
    })
  }
  await audit(user, 'UPDATE', 'ticket', existing.id, { status: body.status, priority: body.priority })
  return ok({ ticket })
})
