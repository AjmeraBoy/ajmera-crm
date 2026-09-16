import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ApiError,
  assertDeptAccess,
  audit,
  deptScope,
  ok,
  readBody,
  requireUser,
  route,
} from '@/lib/api'
import { findMaster, nextCode } from '@/lib/server-utils'
import type { SessionUser } from '@/lib/auth'

type OrderItem = { productId: string | null; name: string; qty: number; price: number }

/** Normalize + clamp item rows coming from the client (trust but clamp) */
function normalizeItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) throw new ApiError('items must be an array', 400)
  const items: OrderItem[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const o = entry as Record<string, unknown>
    const qty = Math.max(1, Math.floor(Number(o.qty) || 0))
    const price = Math.max(0, Math.floor(Number(o.price) || 0))
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Item'
    const productId = typeof o.productId === 'string' && o.productId ? o.productId : null
    items.push({ productId, name, qty, price })
  }
  if (items.length === 0) throw new ApiError('At least one item is required', 400)
  return items
}

function subtotalOf(items: OrderItem[]): number {
  return items.reduce((sum, it) => sum + it.qty * it.price, 0)
}

const ORDER_INCLUDE = {
  lead: { select: { id: true, leadCode: true, customerName: true, department: true, mobile: true } },
  shipment: true,
  invoices: { orderBy: { createdAt: 'desc' as const } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.SalesOrderInclude

const ORDER_STATUSES = ['CONFIRMED', 'IN_PROCESS', 'DISPATCHED', 'DELIVERED', 'CANCELLED']
const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID']

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

// GET /api/orders?leadId=&status=&paymentStatus=&q=&dept=&page=
export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const { page, pageSize, skip, take } = paging(sp)
  const q = sp.get('q')?.trim()
  const leadId = sp.get('leadId') || undefined
  const status = sp.get('status') || undefined
  const paymentStatus = sp.get('paymentStatus') || undefined
  const depts = deptFilter(sp, user)
  const AND: Prisma.SalesOrderWhereInput[] = []
  if (depts) AND.push({ department: { in: depts } })
  if (user.role === 'EXECUTIVE') AND.push({ lead: { assignedToId: user.id } })
  if (q) {
    AND.push({
      OR: [
        { orderNo: { contains: q } },
        { lead: { customerName: { contains: q } } },
        { lead: { leadCode: { contains: q } } },
      ],
    })
  }
  const baseWhere: Prisma.SalesOrderWhereInput = {
    ...(leadId ? { leadId } : {}),
    ...(AND.length ? { AND } : {}),
  }
  const where: Prisma.SalesOrderWhereInput = {
    ...baseWhere,
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
  }
  const [rows, total, agg, byPaymentStatus] = await Promise.all([
    db.salesOrder.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
    db.salesOrder.count({ where }),
    db.salesOrder.aggregate({ where: baseWhere, _sum: { total: true } }),
    db.salesOrder.groupBy({ by: ['paymentStatus'], where: baseWhere, _count: { _all: true } }),
  ])
  const countOf = (ps: string) => byPaymentStatus.find((g) => g.paymentStatus === ps)?._count._all ?? 0
  return ok({
    orders: rows,
    total,
    summary: {
      count: total,
      total: agg._sum.total ?? 0,
      pending: countOf('PENDING'),
      partial: countOf('PARTIAL'),
      paid: countOf('PAID'),
    },
  })
})

// POST /api/orders {leadId, quotationId?, items:[{productId,name,qty,price}], discount?, customerType?, notes?}
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    leadId?: string
    quotationId?: string
    items?: unknown
    discount?: number
    customerType?: string
    notes?: string
  }>(req)
  let leadId = body.leadId
  let department: string | null = null
  let quotation: { id: string; leadId: string; department: string; status: string } | null = null
  if (body.quotationId) {
    const quo = await db.quotation.findUnique({ where: { id: body.quotationId } })
    if (!quo) throw new ApiError('Quotation not found', 404)
    quotation = { id: quo.id, leadId: quo.leadId, department: quo.department, status: quo.status }
    if (!leadId) leadId = quo.leadId
    department = quo.department
  }
  if (!leadId) throw new ApiError('leadId is required', 400)
  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new ApiError('Lead not found', 404)
  if (!department) department = lead.department
  assertDeptAccess(user, department)
  const items = normalizeItems(body.items)
  const subtotal = subtotalOf(items)
  const discount = Math.max(0, Math.floor(Number(body.discount) || 0))
  const total = Math.max(0, subtotal - discount)
  const priorOrders = await db.salesOrder.count({ where: { leadId: lead.id } })
  const customerType = body.customerType || (priorOrders > 0 ? 'REPEAT' : 'NEW')
  const orderNo = await nextCode('SO', 'order')
  const order = await db.salesOrder.create({
    data: {
      orderNo,
      leadId: lead.id,
      quotationId: quotation?.id ?? null,
      department,
      items: JSON.stringify(items),
      total,
      customerType,
      status: 'CONFIRMED',
      notes: body.notes ?? null,
      createdById: user.id,
    },
    include: ORDER_INCLUDE,
  })
  if (quotation && quotation.status !== 'CONVERTED') {
    await db.quotation.update({ where: { id: quotation.id }, data: { status: 'CONVERTED' } })
  }
  // advance lead: status CONVERTED + stage "Order Confirmed" for its department
  const stage = await findMaster('pipeline_stage', 'Order Confirmed', department)
  await db.lead.update({
    where: { id: lead.id },
    data: { status: 'CONVERTED', ...(stage ? { stageId: stage.id } : {}) },
  })
  await db.activity.create({
    data: {
      leadId: lead.id,
      userId: user.id,
      type: 'ORDER',
      title: `Order ${orderNo} confirmed`,
      description: `₹${total} — ${items.length} item(s)`,
      meta: JSON.stringify({ orderId: order.id, total, quotationId: quotation?.id ?? null }),
    },
  })
  await audit(user, 'CREATE', 'order', order.id, { orderNo, total, quotationId: quotation?.id ?? null })
  return ok({ order }, 201)
})

// PATCH /api/orders {id, status?, paymentStatus?, notes?}
export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ id?: string; status?: string; paymentStatus?: string; notes?: string }>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.salesOrder.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Order not found', 404)
  assertDeptAccess(user, existing.department)
  if (body.status && !ORDER_STATUSES.includes(body.status)) {
    throw new ApiError(`Invalid status. Allowed: ${ORDER_STATUSES.join(', ')}`, 400)
  }
  if (body.paymentStatus && !PAYMENT_STATUSES.includes(body.paymentStatus)) {
    throw new ApiError(`Invalid paymentStatus. Allowed: ${PAYMENT_STATUSES.join(', ')}`, 400)
  }
  const data: Prisma.SalesOrderUpdateInput = {}
  if (body.status !== undefined) data.status = body.status
  if (body.paymentStatus !== undefined) data.paymentStatus = body.paymentStatus
  if (body.notes !== undefined) data.notes = body.notes
  const order = await db.salesOrder.update({ where: { id: existing.id }, data, include: ORDER_INCLUDE })
  await audit(user, 'UPDATE', 'order', existing.id, data)
  return ok({ order })
})
