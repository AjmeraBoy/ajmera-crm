import { db } from '@/lib/db'

/** Generate next sequential code like EXP-0007 / ONL-0042 / QTN-0001 */
export async function nextCode(prefix: string, counter: 'lead' | 'quotation' | 'order' | 'invoice' | 'payment' | 'ticket' | 'product'): Promise<string> {
  let n = 0
  if (counter === 'lead') n = await db.lead.count() + 1
  else if (counter === 'quotation') n = await db.quotation.count() + 1
  else if (counter === 'order') n = await db.salesOrder.count() + 1
  else if (counter === 'invoice') n = await db.invoice.count() + 1
  else if (counter === 'payment') n = await db.payment.count() + 1
  else if (counter === 'ticket') n = await db.supportTicket.count() + 1
  else if (counter === 'product') n = await db.product.count() + 1
  // ensure uniqueness even after deletes
  let code = `${prefix}-${String(n).padStart(4, '0')}`
  let guard = 0
  while (guard < 100) {
    const exists =
      counter === 'lead' ? await db.lead.findUnique({ where: { leadCode: code } })
      : counter === 'quotation' ? await db.quotation.findUnique({ where: { quoteNo: code } })
      : counter === 'order' ? await db.salesOrder.findUnique({ where: { orderNo: code } })
      : counter === 'invoice' ? await db.invoice.findUnique({ where: { invoiceNo: code } })
      : counter === 'payment' ? await db.payment.findUnique({ where: { receiptNo: code } })
      : counter === 'ticket' ? await db.supportTicket.findUnique({ where: { ticketNo: code } })
      : await db.product.findUnique({ where: { code } })
    if (!exists) return code
    n += 1
    code = `${prefix}-${String(n).padStart(4, '0')}`
    guard += 1
  }
  return `${prefix}-${Date.now()}`
}

/** Lead code prefix per department */
export function leadPrefix(department: string): string {
  return department === 'EXPORT' ? 'EXP' : 'ONL'
}

/** Round-robin (least-loaded) executive selection within a department */
export async function pickExecutiveRoundRobin(department: string): Promise<{ id: string; name: string } | null> {
  const execs = await db.user.findMany({
    where: { role: 'EXECUTIVE', isActive: true, department },
    select: { id: true, name: true },
  })
  if (execs.length === 0) return null
  const counts = await db.lead.groupBy({
    by: ['assignedToId'],
    where: { department, assignedToId: { in: execs.map((e) => e.id) } },
    _count: { _all: true },
  })
  const countMap = new Map(counts.map((c) => [c.assignedToId, c._count._all]))
  let best = execs[0]
  let bestCount = countMap.get(best.id) ?? 0
  for (const e of execs) {
    const c = countMap.get(e.id) ?? 0
    if (c < bestCount) {
      best = e
      bestCount = c
    }
  }
  return best
}

/** Resolve a master item by type+label (used for stage auto-advance) */
export async function findMaster(type: string, label: string, dept?: string): Promise<{ id: string } | null> {
  const item = await db.masterItem.findFirst({
    where: { type, label, isActive: true, ...(dept ? { dept: { in: [dept, 'ALL'] } } : {}) },
    select: { id: true },
  })
  return item
}
