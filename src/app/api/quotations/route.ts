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

type QuoteItem = { productId: string | null; name: string; qty: number; price: number }

/** Normalize + clamp item rows coming from the client (trust but clamp) */
function normalizeItems(raw: unknown): QuoteItem[] {
  if (!Array.isArray(raw)) throw new ApiError('items must be an array', 400)
  const items: QuoteItem[] = []
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

function subtotalOf(items: QuoteItem[]): number {
  return items.reduce((sum, it) => sum + it.qty * it.price, 0)
}

const QUOTE_INCLUDE = {
  lead: {
    select: { id: true, leadCode: true, customerName: true, companyName: true, department: true, mobile: true },
  },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.QuotationInclude

const QUOTE_STATUSES = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED']

function paging(sp: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1))
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(sp.get('pageSize')) || 20)))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

/** department filter honouring deptScope + explicit dept param (empty scope → matches nothing) */
function deptFilter(sp: URLSearchParams, user: SessionUser): string[] | null {
  const scope = deptScope(user)
  const dept = sp.get('dept')
  if (dept) return scope && !scope.includes(dept) ? [] : [dept]
  return scope
}

// GET /api/quotations?leadId=&status=&q=&dept=&page=
export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const { page, pageSize, skip, take } = paging(sp)
  const q = sp.get('q')?.trim()
  const leadId = sp.get('leadId') || undefined
  const status = sp.get('status') || undefined
  const depts = deptFilter(sp, user)
  const AND: Prisma.QuotationWhereInput[] = []
  if (depts) AND.push({ department: { in: depts } })
  if (user.role === 'EXECUTIVE') AND.push({ lead: { assignedToId: user.id } })
  if (q) {
    AND.push({
      OR: [
        { quoteNo: { contains: q } },
        { lead: { customerName: { contains: q } } },
        { lead: { leadCode: { contains: q } } },
      ],
    })
  }
  const where: Prisma.QuotationWhereInput = {
    ...(leadId ? { leadId } : {}),
    ...(status ? { status } : {}),
    ...(AND.length ? { AND } : {}),
  }
  const [rows, total] = await Promise.all([
    db.quotation.findMany({ where, include: QUOTE_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
    db.quotation.count({ where }),
  ])
  return ok({ quotations: rows, total })
})

// POST /api/quotations {leadId, items:[{productId,name,qty,price}], discount?, validUntil?, notes?}
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    leadId?: string
    items?: unknown
    discount?: number
    validUntil?: string
    notes?: string
  }>(req)
  if (!body.leadId) throw new ApiError('leadId is required', 400)
  const items = normalizeItems(body.items)
  const lead = await db.lead.findUnique({ where: { id: body.leadId } })
  if (!lead) throw new ApiError('Lead not found', 404)
  assertDeptAccess(user, lead.department)
  const subtotal = subtotalOf(items)
  const discount = Math.max(0, Math.floor(Number(body.discount) || 0))
  const total = Math.max(0, subtotal - discount)
  const quoteNo = await nextCode('QTN', 'quotation')
  const quotation = await db.quotation.create({
    data: {
      quoteNo,
      leadId: lead.id,
      department: lead.department,
      items: JSON.stringify(items),
      subtotal,
      discount,
      total,
      status: 'DRAFT',
      validUntil: parseDate(body.validUntil) ?? null,
      notes: body.notes ?? null,
      createdById: user.id,
    },
    include: QUOTE_INCLUDE,
  })
  await db.activity.create({
    data: {
      leadId: lead.id,
      userId: user.id,
      type: 'QUOTATION',
      title: `Quotation ${quoteNo} created`,
      description: `${items.length} item(s) — ₹${total}`,
      meta: JSON.stringify({ quotationId: quotation.id, total }),
    },
  })
  await audit(user, 'CREATE', 'quotation', quotation.id, { quoteNo, total })
  return ok({ quotation }, 201)
})

// PATCH /api/quotations {id, status?, items?, discount?, validUntil?, notes?}
export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    id?: string
    status?: string
    items?: unknown
    discount?: number
    validUntil?: string
    notes?: string
  }>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.quotation.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Quotation not found', 404)
  assertDeptAccess(user, existing.department)
  if (body.status === 'CONVERTED') throw new ApiError('Use Orders API to convert a quotation', 400)
  if (body.status && !QUOTE_STATUSES.includes(body.status)) {
    throw new ApiError(`Invalid status. Allowed: ${QUOTE_STATUSES.join(', ')}`, 400)
  }
  const data: Prisma.QuotationUpdateInput = {}
  let becameSent = false
  if (body.status && body.status !== existing.status) {
    data.status = body.status
    if (body.status === 'SENT' && !existing.sentAt) {
      data.sentAt = new Date()
      becameSent = true
    }
  }
  let subtotal = existing.subtotal
  let discount = existing.discount
  if (body.items !== undefined) {
    const items = normalizeItems(body.items)
    subtotal = subtotalOf(items)
    data.items = JSON.stringify(items)
    data.subtotal = subtotal
  }
  if (body.discount !== undefined) {
    discount = Math.max(0, Math.floor(Number(body.discount) || 0))
    data.discount = discount
  }
  if (data.items !== undefined || data.discount !== undefined) {
    data.total = Math.max(0, subtotal - discount)
  }
  if (body.validUntil !== undefined) data.validUntil = parseDate(body.validUntil) ?? null
  if (body.notes !== undefined) data.notes = body.notes
  const quotation = await db.quotation.update({ where: { id: existing.id }, data, include: QUOTE_INCLUDE })
  if (becameSent) {
    await db.activity.create({
      data: {
        leadId: existing.leadId,
        userId: user.id,
        type: 'QUOTATION',
        title: `Quotation ${existing.quoteNo} sent`,
        meta: JSON.stringify({ quotationId: existing.id }),
      },
    })
  }
  await audit(user, 'UPDATE', 'quotation', existing.id, { status: data.status })
  return ok({ quotation })
})
