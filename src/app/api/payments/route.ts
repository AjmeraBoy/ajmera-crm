import type { Invoice, Lead, Prisma, SalesOrder } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ApiError,
  assertDeptAccess,
  audit,
  deptScope,
  notify,
  ok,
  parseDate,
  readBody,
  requireUser,
  route,
} from '@/lib/api'
import { nextCode } from '@/lib/server-utils'
import type { SessionUser } from '@/lib/auth'

const PAYMENT_INCLUDE = {
  lead: { select: { id: true, leadCode: true, customerName: true } },
  order: { select: { orderNo: true } },
  invoice: { select: { invoiceNo: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.PaymentInclude

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

// GET /api/payments?leadId=&orderId=&dept=&mode=&from=&to=&q=&page=
export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const { page, pageSize, skip, take } = paging(sp)
  const q = sp.get('q')?.trim()
  const leadId = sp.get('leadId') || undefined
  const orderId = sp.get('orderId') || undefined
  const mode = sp.get('mode') || undefined
  const from = parseDate(sp.get('from'))
  const to = parseDate(sp.get('to'))
  const depts = deptFilter(sp, user)
  const AND: Prisma.PaymentWhereInput[] = []
  if (depts) AND.push({ department: { in: depts } })
  // EXECUTIVE sees only payments tied to their own leads
  if (user.role === 'EXECUTIVE') AND.push({ lead: { assignedToId: user.id } })
  if (q) {
    AND.push({
      OR: [
        { receiptNo: { contains: q } },
        { reference: { contains: q } },
        { lead: { customerName: { contains: q } } },
      ],
    })
  }
  const baseWhere: Prisma.PaymentWhereInput = {
    ...(leadId ? { leadId } : {}),
    ...(orderId ? { orderId } : {}),
    ...(mode ? { mode } : {}),
    ...(AND.length ? { AND } : {}),
  }
  const where: Prisma.PaymentWhereInput = {
    ...baseWhere,
    ...(from || to ? { paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  }
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const [rows, total, sumAll, sumMonth, sumToday] = await Promise.all([
    db.payment.findMany({ where, include: PAYMENT_INCLUDE, orderBy: { paidAt: 'desc' }, skip, take }),
    db.payment.count({ where }),
    db.payment.aggregate({ where, _sum: { amount: true } }),
    db.payment.aggregate({ where: { ...baseWhere, paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { ...baseWhere, paidAt: { gte: todayStart } }, _sum: { amount: true } }),
  ])
  return ok({
    payments: rows,
    total,
    summary: {
      total: sumAll._sum.amount ?? 0,
      thisMonth: sumMonth._sum.amount ?? 0,
      today: sumToday._sum.amount ?? 0,
    },
  })
})

// POST /api/payments {leadId?, orderId?, invoiceId?, amount, mode?, reference?, isAdvance?, notes?, paidAt?}
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    leadId?: string
    orderId?: string
    invoiceId?: string
    amount?: number
    mode?: string
    reference?: string
    isAdvance?: boolean
    notes?: string
    paidAt?: string
  }>(req)
  const amount = Math.floor(Number(body.amount) || 0)
  if (amount <= 0) throw new ApiError('amount must be a positive integer', 400)

  let invoice: Invoice | null = null
  if (body.invoiceId) {
    invoice = await db.invoice.findUnique({ where: { id: body.invoiceId } })
    if (!invoice) throw new ApiError('Invoice not found', 404)
  }
  let order: SalesOrder | null = null
  const orderId = body.orderId || invoice?.orderId
  if (orderId) {
    order = await db.salesOrder.findUnique({ where: { id: orderId } })
    if (!order) throw new ApiError('Order not found', 404)
  }
  let lead: Lead | null = null
  const leadId = body.leadId || order?.leadId || null
  if (leadId) {
    lead = await db.lead.findUnique({ where: { id: leadId } })
    if (!lead) throw new ApiError('Lead not found', 404)
  }
  const department = lead?.department || order?.department || user.department || 'ONLINE'
  assertDeptAccess(user, department)

  const receiptNo = await nextCode('RCP', 'payment')
  const payment = await db.payment.create({
    data: {
      receiptNo,
      leadId: lead?.id ?? null,
      orderId: order?.id ?? null,
      invoiceId: invoice?.id ?? null,
      department,
      amount,
      mode: body.mode || 'BANK_TRANSFER',
      reference: body.reference ?? null,
      isAdvance: !!body.isAdvance,
      notes: body.notes ?? null,
      paidAt: parseDate(body.paidAt) ?? new Date(),
      createdById: user.id,
    },
    include: PAYMENT_INCLUDE,
  })

  // update invoice: paidAmount + status (OVERDUE stays OVERDUE until fully paid)
  if (invoice) {
    const paid = invoice.paidAmount + amount
    const status =
      paid >= invoice.amount ? 'PAID' : invoice.status === 'OVERDUE' ? 'OVERDUE' : paid > 0 ? 'PARTIAL' : 'UNPAID'
    await db.invoice.update({ where: { id: invoice.id }, data: { paidAmount: paid, status } })
  }
  // update order: paidAmount + paymentStatus
  if (order) {
    const paid = order.paidAmount + amount
    const paymentStatus = paid >= order.total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING'
    await db.salesOrder.update({ where: { id: order.id }, data: { paidAmount: paid, paymentStatus } })
  }
  if (lead) {
    await db.activity.create({
      data: {
        leadId: lead.id,
        userId: user.id,
        type: 'PAYMENT',
        title: `Payment received ₹${amount}`,
        description: `${receiptNo}${order ? ` — order ${order.orderNo}` : ''} via ${payment.mode}`,
        meta: JSON.stringify({ paymentId: payment.id, amount, receiptNo }),
      },
    })
    if (lead.assignedToId) {
      await notify(
        lead.assignedToId,
        'Payment received',
        `₹${amount} received for ${lead.leadCode} (${receiptNo})`,
        'PAYMENT'
      )
    }
  }
  await audit(user, 'CREATE', 'payment', payment.id, { receiptNo, amount, orderId: order?.id ?? null })
  return ok({ payment }, 201)
})

// PATCH /api/payments {id, notes?, mode?, reference?}
export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ id?: string; notes?: string; mode?: string; reference?: string }>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.payment.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Payment not found', 404)
  assertDeptAccess(user, existing.department)
  const data: Prisma.PaymentUpdateInput = {}
  if (body.notes !== undefined) data.notes = body.notes
  if (body.mode !== undefined) data.mode = body.mode
  if (body.reference !== undefined) data.reference = body.reference
  const payment = await db.payment.update({ where: { id: existing.id }, data, include: PAYMENT_INCLUDE })
  await audit(user, 'UPDATE', 'payment', existing.id, data)
  return ok({ payment })
})
