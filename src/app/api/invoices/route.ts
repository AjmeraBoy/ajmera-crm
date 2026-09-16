import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ApiError,
  assertDeptAccess,
  audit,
  deptScope,
  ok,
  parseDate,
  readBody,
  requireUser,
  route,
} from '@/lib/api'
import { nextCode } from '@/lib/server-utils'
import type { SessionUser } from '@/lib/auth'

const INVOICE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE']

const INVOICE_INCLUDE = {
  order: {
    select: {
      orderNo: true,
      department: true,
      lead: { select: { id: true, leadCode: true, customerName: true, department: true } },
    },
  },
} satisfies Prisma.InvoiceInclude

function paging(sp: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1))
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(sp.get('pageSize')) || 20)))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

// GET /api/invoices?status=&q=&dept=&page=
export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const { page, pageSize, skip, take } = paging(sp)
  const q = sp.get('q')?.trim()
  const status = sp.get('status') || undefined
  const scope = deptScope(user)
  const dept = sp.get('dept')
  const depts = dept ? (scope && !scope.includes(dept) ? [] : [dept]) : scope
  const AND: Prisma.InvoiceWhereInput[] = []
  if (depts) AND.push({ order: { department: { in: depts } } })
  if (user.role === 'EXECUTIVE') AND.push({ order: { lead: { assignedToId: user.id } } })
  if (q) {
    AND.push({
      OR: [
        { invoiceNo: { contains: q } },
        { order: { orderNo: { contains: q } } },
        { order: { lead: { customerName: { contains: q } } } },
      ],
    })
  }
  const where: Prisma.InvoiceWhereInput = {
    ...(status ? { status } : {}),
    ...(AND.length ? { AND } : {}),
  }
  const [rows, total, sumAll, sumUnpaid] = await Promise.all([
    db.invoice.findMany({ where, include: INVOICE_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
    db.invoice.count({ where }),
    db.invoice.aggregate({ where, _sum: { amount: true } }),
    db.invoice.aggregate({ where: { ...where, NOT: { status: 'PAID' } }, _sum: { amount: true, paidAmount: true } }),
  ])
  const outstanding = Math.max(0, (sumUnpaid._sum.amount ?? 0) - (sumUnpaid._sum.paidAmount ?? 0))
  return ok({
    invoices: rows,
    total,
    summary: { totalAmount: sumAll._sum.amount ?? 0, outstanding },
  })
})

// POST /api/invoices {orderId, dueDate?}
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ orderId?: string; dueDate?: string; notes?: string }>(req)
  if (!body.orderId) throw new ApiError('orderId is required', 400)
  const order = await db.salesOrder.findUnique({ where: { id: body.orderId } })
  if (!order) throw new ApiError('Order not found', 404)
  assertDeptAccess(user, order.department)
  const existing = await db.invoice.findFirst({ where: { orderId: order.id }, select: { id: true } })
  if (existing) throw new ApiError('An invoice already exists for this order', 409)
  const invoiceNo = await nextCode('INV', 'invoice')
  const fullyPaid = order.total > 0 && order.paidAmount >= order.total
  const invoice = await db.invoice.create({
    data: {
      invoiceNo,
      orderId: order.id,
      amount: order.total,
      paidAmount: fullyPaid ? order.total : 0,
      status: fullyPaid ? 'PAID' : 'UNPAID',
      dueDate: parseDate(body.dueDate) ?? null,
      notes: body.notes ?? null,
    },
    include: INVOICE_INCLUDE,
  })
  await audit(user, 'CREATE', 'invoice', invoice.id, { invoiceNo, amount: order.total, orderNo: order.orderNo })
  return ok({ invoice }, 201)
})

// PATCH /api/invoices {id, status?, dueDate?, notes?}
export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ id?: string; status?: string; dueDate?: string; notes?: string }>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.invoice.findUnique({ where: { id: body.id }, include: INVOICE_INCLUDE })
  if (!existing) throw new ApiError('Invoice not found', 404)
  assertDeptAccess(user, existing.order.department)
  if (body.status && !INVOICE_STATUSES.includes(body.status)) {
    throw new ApiError(`Invalid status. Allowed: ${INVOICE_STATUSES.join(', ')}`, 400)
  }
  const data: Prisma.InvoiceUpdateInput = {}
  if (body.status !== undefined) data.status = body.status
  if (body.dueDate !== undefined) data.dueDate = parseDate(body.dueDate) ?? null
  if (body.notes !== undefined) data.notes = body.notes
  const invoice = await db.invoice.update({ where: { id: existing.id }, data, include: INVOICE_INCLUDE })
  await audit(user, 'UPDATE', 'invoice', existing.id, data)
  return ok({ invoice })
})
