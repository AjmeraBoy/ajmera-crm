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
import type { SessionUser } from '@/lib/auth'

const STAGES = ['PACKING', 'QC', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED']

const SHIPMENT_INCLUDE = {
  order: {
    select: {
      orderNo: true,
      total: true,
      status: true,
      lead: { select: { id: true, leadCode: true, customerName: true, department: true, mobile: true } },
    },
  },
} satisfies Prisma.ShipmentInclude

function paging(sp: URLSearchParams) {
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1))
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(sp.get('pageSize')) || 20)))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

// GET /api/shipments?stage=&dept=&q=&page=
export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const { page, pageSize, skip, take } = paging(sp)
  const q = sp.get('q')?.trim()
  const stage = sp.get('stage') || undefined
  const scope = deptScope(user)
  const dept = sp.get('dept')
  const depts = dept ? (scope && !scope.includes(dept) ? [] : [dept]) : scope
  const AND: Prisma.ShipmentWhereInput[] = []
  if (depts) AND.push({ department: { in: depts } })
  if (q) {
    AND.push({
      OR: [
        { awbNumber: { contains: q } },
        { courierName: { contains: q } },
        { order: { orderNo: { contains: q } } },
        { order: { lead: { customerName: { contains: q } } } },
      ],
    })
  }
  const scopeWhere: Prisma.ShipmentWhereInput = AND.length ? { AND } : {}
  const where: Prisma.ShipmentWhereInput = { ...scopeWhere, ...(stage ? { stage } : {}) }
  const [rows, total, byStage] = await Promise.all([
    db.shipment.findMany({ where, include: SHIPMENT_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
    db.shipment.count({ where }),
    db.shipment.groupBy({ by: ['stage'], where: scopeWhere, _count: { _all: true } }),
  ])
  const countOf = (s: string) => byStage.find((g) => g.stage === s)?._count._all ?? 0
  return ok({
    shipments: rows,
    total,
    summary: {
      packing: countOf('PACKING'),
      qc: countOf('QC'),
      dispatched: countOf('DISPATCHED'),
      inTransit: countOf('IN_TRANSIT'),
      delivered: countOf('DELIVERED'),
    },
  })
})

// POST /api/shipments {orderId, courierName?, awbNumber?, notes?}
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ orderId?: string; courierName?: string; awbNumber?: string; notes?: string }>(req)
  if (!body.orderId) throw new ApiError('orderId is required', 400)
  const order = await db.salesOrder.findUnique({ where: { id: body.orderId } })
  if (!order) throw new ApiError('Order not found', 404)
  assertDeptAccess(user, order.department)
  const existing = await db.shipment.findUnique({ where: { orderId: order.id }, select: { id: true } })
  if (existing) throw new ApiError('A shipment already exists for this order', 409)
  const shipment = await db.shipment.create({
    data: {
      orderId: order.id,
      leadId: order.leadId,
      department: order.department,
      stage: 'PACKING',
      courierName: body.courierName ?? null,
      awbNumber: body.awbNumber ?? null,
      notes: body.notes ?? null,
    },
    include: SHIPMENT_INCLUDE,
  })
  await db.salesOrder.update({ where: { id: order.id }, data: { status: 'IN_PROCESS' } })
  await db.activity.create({
    data: {
      leadId: order.leadId,
      userId: user.id,
      type: 'DISPATCH',
      title: `Shipment created — ${order.orderNo}`,
      description: 'Stage: PACKING',
      meta: JSON.stringify({ shipmentId: shipment.id }),
    },
  })
  await audit(user, 'CREATE', 'shipment', shipment.id, { orderNo: order.orderNo })
  return ok({ shipment }, 201)
})

// PATCH /api/shipments {id, stage?, courierName?, awbNumber?, trackingUrl?, proofUrl?, notes?}
export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    id?: string
    stage?: string
    courierName?: string
    awbNumber?: string
    trackingUrl?: string
    proofUrl?: string
    notes?: string
  }>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.shipment.findUnique({
    where: { id: body.id },
    include: { order: { include: { lead: true } } },
  })
  if (!existing) throw new ApiError('Shipment not found', 404)
  assertDeptAccess(user, existing.department)
  if (body.stage && !STAGES.includes(body.stage)) {
    throw new ApiError(`Invalid stage. Allowed: ${STAGES.join(', ')}`, 400)
  }
  const data: Prisma.ShipmentUpdateInput = {}
  let newStage: string | null = null
  if (body.stage && body.stage !== existing.stage) {
    if (STAGES.indexOf(body.stage) < STAGES.indexOf(existing.stage)) {
      throw new ApiError('Shipment stage cannot move backward', 400)
    }
    data.stage = body.stage
    newStage = body.stage
  }
  if (newStage) {
    // forward jump past DISPATCHED still stamps dispatchedAt
    if (STAGES.indexOf(newStage) >= STAGES.indexOf('DISPATCHED') && !existing.dispatchedAt) {
      data.dispatchedAt = new Date()
    }
    if (newStage === 'DELIVERED') data.deliveredAt = new Date()
  }
  if (body.courierName !== undefined) data.courierName = body.courierName
  if (body.awbNumber !== undefined) data.awbNumber = body.awbNumber
  if (body.trackingUrl !== undefined) data.trackingUrl = body.trackingUrl
  if (body.proofUrl !== undefined) data.proofUrl = body.proofUrl
  if (body.notes !== undefined) data.notes = body.notes
  const shipment = await db.shipment.update({ where: { id: existing.id }, data, include: SHIPMENT_INCLUDE })

  if (newStage === 'DISPATCHED' || newStage === 'DELIVERED') {
    await db.salesOrder.update({
      where: { id: existing.orderId },
      data: { status: newStage === 'DISPATCHED' ? 'DISPATCHED' : 'DELIVERED' },
    })
  }

  // WhatsApp notification to the lead conversation on dispatch
  if (newStage === 'DISPATCHED') {
    const lead = existing.order.lead
    const phone = lead?.whatsapp || lead?.mobile
    if (lead && phone) {
      let conversation = await db.whatsAppConversation.findFirst({ where: { leadId: lead.id } })
      if (!conversation) {
        conversation = await db.whatsAppConversation.create({
          data: {
            leadId: lead.id,
            phone,
            name: lead.customerName,
            dept: existing.department,
            ownerId: lead.assignedToId,
          },
        })
      }
      const messageBody = `📦 Your order ${existing.order.orderNo} has been dispatched via ${shipment.courierName || 'courier'}. AWB: ${shipment.awbNumber || '—'}.`
      await db.whatsAppMessage.create({
        data: {
          conversationId: conversation.id,
          userId: user.id,
          direction: 'OUT',
          type: 'TEXT',
          body: messageBody,
          status: 'SENT',
        },
      })
      await db.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { lastMessage: messageBody, lastMessageAt: new Date() },
      })
    }
  }

  if (newStage) {
    const titles: Record<string, string> = {
      PACKING: 'Packing started',
      QC: 'Quality check',
      DISPATCHED: 'Dispatched',
      IN_TRANSIT: 'In transit',
      DELIVERED: 'Delivered',
    }
    await db.activity.create({
      data: {
        leadId: existing.leadId,
        userId: user.id,
        type: 'DISPATCH',
        title: `Shipment ${existing.order.orderNo} — ${titles[newStage]}`,
        description:
          newStage === 'DISPATCHED' && shipment.awbNumber
            ? `AWB ${shipment.awbNumber}${shipment.courierName ? ` via ${shipment.courierName}` : ''}`
            : undefined,
        meta: JSON.stringify({ shipmentId: existing.id, stage: newStage }),
      },
    })
  }
  await audit(user, 'UPDATE', 'shipment', existing.id, { stage: newStage ?? existing.stage })
  return ok({ shipment })
})
