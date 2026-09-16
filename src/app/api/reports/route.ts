import { route, ok, requireUser, deptScope, ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'
import { db } from '@/lib/db'

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function resolveScopeUsers(user: SessionUser, deptParam: string | null, teamId: string | null, userId: string | null): Promise<{ userIds: string[] | null; deptFilter: string[] | null }> {
  const scope = deptScope(user)
  let deptFilter = scope
  if (deptParam) {
    if (scope && !scope.includes(deptParam)) throw new ApiError('No access to that department', 403)
    deptFilter = [deptParam]
  }
  let userIds: string[] | null = null
  if (userId) {
    userIds = [userId]
  } else if (teamId) {
    const members = await db.user.findMany({ where: { teamId, isActive: true }, select: { id: true } })
    userIds = members.map((m) => m.id)
  }
  return { userIds, deptFilter }
}

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const type = sp.get('type') || 'lead-conversion'
  const from = sp.get('from') ? new Date(sp.get('from')!) : null
  const to = sp.get('to') ? new Date(sp.get('to')!) : null
  const { userIds, deptFilter } = await resolveScopeUsers(user, sp.get('dept'), sp.get('teamId'), sp.get('userId'))

  const deptWhere = deptFilter ? { department: { in: deptFilter } } : {}
  const userWhere = userIds ? { assignedToId: { in: userIds } } : {}
  const createdUserWhere = userIds ? { createdById: { in: userIds } } : {}
  const rangeWhere = from || to
    ? {
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      }
    : {}

  if (type === 'lead-conversion') {
    const [total, converted, lost] = await Promise.all([
      db.lead.count({ where: { ...deptWhere, ...rangeWhere } }),
      db.lead.count({ where: { ...deptWhere, ...rangeWhere, status: 'CONVERTED' } }),
      db.lead.count({ where: { ...deptWhere, ...rangeWhere, status: 'LOST' } }),
    ])
    const stages = await db.lead.groupBy({ by: ['stageId'], where: { ...deptWhere, ...rangeWhere }, _count: { _all: true } })
    const stageIds = stages.map((s) => s.stageId).filter((x): x is string => !!x)
    const stageMasters = stageIds.length
      ? await db.masterItem.findMany({ where: { id: { in: stageIds } }, select: { id: true, label: true, order: true } })
      : []
    const stageMap = new Map(stageMasters.map((s) => [s.id, s]))
    const funnel = stageMasters
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ stage: s.label, count: stages.find((g) => g.stageId === s.id)?._count._all ?? 0 }))
    return ok({
      summary: { total, converted, lost, conversionPct: total ? Math.round((converted / total) * 100) : 0 },
      funnel,
    })
  }

  if (type === 'executive-performance') {
    const staff = await db.user.findMany({
      where: {
        role: { in: ['EXECUTIVE', 'TEAM_LEADER'] },
        isActive: true,
        ...(deptFilter ? { department: { in: deptFilter } } : {}),
        ...(userIds ? { id: { in: userIds } } : {}),
      },
      select: { id: true, name: true, role: true, team: { select: { name: true } }, dailyCallTarget: true },
    })
    const month = monthKey(new Date())
    const rows: Array<Record<string, unknown>> = []
    for (const u of staff) {
      const [leadsAssigned, calls, connected, followupsDone, conversions, orders] = await Promise.all([
        db.lead.count({ where: { assignedToId: u.id } }),
        db.callLog.count({ where: { userId: u.id, ...(rangeWhere.createdAt ?? {}) ? { createdAt: rangeWhere.createdAt } : {} } }),
        db.callLog.count({ where: { userId: u.id, status: 'CONNECTED' } }),
        db.followUp.count({ where: { assignedToId: u.id, status: 'COMPLETED' } }),
        db.lead.count({ where: { assignedToId: u.id, status: 'CONVERTED' } }),
        db.salesOrder.aggregate({ where: { lead: { assignedToId: u.id } }, _sum: { total: true }, _count: { _all: true } }),
      ])
      const tgt = await db.target.findUnique({ where: { userId_month: { userId: u.id, month } } })
      const achievedAgg = await db.payment.aggregate({
        where: { lead: { assignedToId: u.id }, paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
        _sum: { amount: true },
      })
      const target = tgt?.amount ?? 0
      const achieved = achievedAgg._sum.amount ?? 0
      rows.push({
        userId: u.id,
        name: u.name,
        role: u.role,
        team: u.team?.name ?? '—',
        leadsAssigned,
        calls,
        connected,
        followupsDone,
        conversions,
        salesAmount: orders._sum.total ?? 0,
        orders: orders._count._all,
        target,
        achievementPct: target ? Math.round((achieved / target) * 100) : 0,
      })
    }
    return ok({ rows })
  }

  if (type === 'revenue') {
    const payments = await db.payment.findMany({
      where: { ...deptWhere, ...(userIds ? { lead: { assignedToId: { in: userIds } } } : {}), ...(rangeWhere.createdAt ?? {} ? { createdAt: rangeWhere.createdAt } : {}) },
      select: { amount: true, paidAt: true },
    })
    const orders = await db.salesOrder.findMany({ where: { ...deptWhere, ...createdUserWhere }, select: { total: true, createdAt: true } })
    const map = new Map<string, { revenue: number; orders: number }>()
    for (const p of payments) {
      const k = monthKey(p.paidAt)
      const e = map.get(k) ?? { revenue: 0, orders: 0 }
      e.revenue += p.amount
      map.set(k, e)
    }
    for (const o of orders) {
      const k = monthKey(o.createdAt)
      const e = map.get(k) ?? { revenue: 0, orders: 0 }
      e.orders += 1
      map.set(k, e)
    }
    const rows = Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, ...v }))
    return ok({ rows, totalRevenue: rows.reduce((a, b) => a + b.revenue, 0) })
  }

  if (type === 'geo') {
    const leads = await db.lead.findMany({
      where: { ...deptWhere, ...userWhere },
      select: { status: true, state: { select: { label: true } }, country: { select: { label: true } } },
    })
    const orders = await db.salesOrder.findMany({
      where: { ...deptWhere, ...(userIds ? { lead: { assignedToId: { in: userIds } } } : {}) },
      select: { total: true, lead: { select: { state: { select: { label: true } }, country: { select: { label: true } } } } },
    })
    const map = new Map<string, { leads: number; converted: number; lost: number; pending: number; revenue: number }>()
    const keyOf = (l: { state: { label: string } | null; country: { label: string } | null }) =>
      l.state?.label ?? l.country?.label ?? l.country?.label ?? 'Unknown'
    for (const l of leads) {
      const k = keyOf(l)
      const e = map.get(k) ?? { leads: 0, converted: 0, lost: 0, pending: 0, revenue: 0 }
      e.leads += 1
      if (l.status === 'CONVERTED') e.converted += 1
      else if (l.status === 'LOST') e.lost += 1
      else e.pending += 1
      map.set(k, e)
    }
    for (const o of orders) {
      const k = keyOf(o.lead)
      const e = map.get(k) ?? { leads: 0, converted: 0, lost: 0, pending: 0, revenue: 0 }
      e.revenue += o.total
      map.set(k, e)
    }
    const rows = Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, conversionPct: v.leads ? Math.round((v.converted / v.leads) * 100) : 0 }))
      .sort((a, b) => b.leads - a.leads)
    return ok({ rows })
  }

  if (type === 'source-wise') {
    const leads = await db.lead.findMany({
      where: { ...deptWhere, ...userWhere },
      select: { status: true, source: { select: { label: true } } },
    })
    const map = new Map<string, { leads: number; converted: number }>()
    for (const l of leads) {
      const k = l.source?.label ?? 'Unknown'
      const e = map.get(k) ?? { leads: 0, converted: 0 }
      e.leads += 1
      if (l.status === 'CONVERTED') e.converted += 1
      map.set(k, e)
    }
    const payments = await db.payment.groupBy({
      by: ['leadId'],
      where: { ...deptWhere, ...(userIds ? { lead: { assignedToId: { in: userIds } } } : {}) },
      _sum: { amount: true },
    })
    const leadSources = await db.lead.findMany({
      where: { ...deptWhere, ...(userIds ? { assignedToId: { in: userIds } } : {}), id: { in: payments.map((p) => p.leadId).filter((x): x is string => !!x) } },
      select: { id: true, source: { select: { label: true } } },
    })
    const revenueBySource = new Map<string, number>()
    for (const p of payments) {
      const l = leadSources.find((ls) => ls.id === p.leadId)
      const k = l?.source?.label ?? 'Unknown'
      revenueBySource.set(k, (revenueBySource.get(k) ?? 0) + (p._sum.amount ?? 0))
    }
    const rows = Array.from(map.entries())
      .map(([name, v]) => ({
        name,
        leads: v.leads,
        converted: v.converted,
        conversionPct: v.leads ? Math.round((v.converted / v.leads) * 100) : 0,
        revenue: revenueBySource.get(name) ?? 0,
      }))
      .sort((a, b) => b.leads - a.leads)
    return ok({ rows })
  }

  if (type === 'dispatch') {
    const shipments = await db.shipment.findMany({ where: { ...deptWhere }, select: { stage: true, createdAt: true, deliveredAt: true } })
    const stageCounts = new Map<string, number>()
    for (const s of shipments) stageCounts.set(s.stage, (stageCounts.get(s.stage) ?? 0) + 1)
    const aging = [
      { bucket: '0-2d', count: 0 },
      { bucket: '3-5d', count: 0 },
      { bucket: '6-10d', count: 0 },
      { bucket: '10d+', count: 0 },
    ]
    const now = Date.now()
    for (const s of shipments) {
      if (s.stage === 'DELIVERED') continue
      const days = Math.floor((now - s.createdAt.getTime()) / 86400000)
      if (days <= 2) aging[0].count++
      else if (days <= 5) aging[1].count++
      else if (days <= 10) aging[2].count++
      else aging[3].count++
    }
    const rows = ['PACKING', 'QC', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 }))
    return ok({ rows, aging })
  }

  if (type === 'outstanding') {
    const invoices = await db.invoice.findMany({
      where: { order: { ...deptWhere } },
      include: { order: { include: { lead: { select: { leadCode: true, customerName: true } } } } },
    })
    const now = new Date()
    const rows = invoices
      .filter((i) => i.amount > i.paidAmount)
      .map((i) => {
        const daysOverdue = i.dueDate ? Math.max(0, Math.floor((now.getTime() - i.dueDate.getTime()) / 86400000)) : 0
        return {
          invoiceNo: i.invoiceNo,
          orderNo: i.order.orderNo,
          leadCode: i.order.lead?.leadCode ?? '—',
          customer: i.order.lead?.customerName ?? '—',
          amount: i.amount,
          paidAmount: i.paidAmount,
          dueDate: i.dueDate,
          daysOverdue,
          status: daysOverdue > 0 && i.amount > i.paidAmount ? 'OVERDUE' : 'PENDING',
        }
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
    return ok({
      rows,
      totals: {
        outstanding: rows.reduce((a, b) => a + (b.amount - b.paidAmount), 0),
        overdue: rows.filter((r) => r.status === 'OVERDUE').reduce((a, b) => a + (b.amount - b.paidAmount), 0),
      },
    })
  }

  if (type === 'collection') {
    const payments = await db.payment.findMany({
      where: { ...deptWhere, ...(userIds ? { lead: { assignedToId: { in: userIds } } } : {}) },
      select: { amount: true, paidAt: true },
    })
    const map = new Map<string, { amount: number; count: number }>()
    for (const p of payments) {
      const k = monthKey(p.paidAt)
      const e = map.get(k) ?? { amount: 0, count: 0 }
      e.amount += p.amount
      e.count += 1
      map.set(k, e)
    }
    const rows = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v }))
    return ok({ rows, total: rows.reduce((a, b) => a + b.amount, 0) })
  }

  if (type === 'new-vs-repeat') {
    const orders = await db.salesOrder.findMany({
      where: { ...deptWhere, ...(userIds ? { lead: { assignedToId: { in: userIds } } } : {}) },
      select: { customerType: true, total: true },
    })
    const newOrders = orders.filter((o) => o.customerType === 'NEW')
    const repeatOrders = orders.filter((o) => o.customerType === 'REPEAT')
    return ok({
      newCount: newOrders.length,
      repeatCount: repeatOrders.length,
      newRevenue: newOrders.reduce((a, b) => a + b.total, 0),
      repeatRevenue: repeatOrders.reduce((a, b) => a + b.total, 0),
    })
  }

  if (type === 'call-quality') {
    const staff = await db.user.findMany({
      where: { role: { in: ['EXECUTIVE', 'TEAM_LEADER'] }, isActive: true, ...(deptFilter ? { department: { in: deptFilter } } : {}), ...(userIds ? { id: { in: userIds } } : {}) },
      select: { id: true, name: true },
    })
    const rows: Array<Record<string, unknown>> = []
    for (const u of staff) {
      const calls = await db.callLog.findMany({ where: { userId: u.id }, select: { status: true, durationSec: true } })
      const made = calls.length
      const connected = calls.filter((c) => c.status === 'CONNECTED').length
      const conversions = await db.lead.count({ where: { assignedToId: u.id, status: 'CONVERTED' } })
      rows.push({
        name: u.name,
        callsMade: made,
        connected,
        notConnected: calls.filter((c) => c.status === 'NOT_CONNECTED').length,
        missed: calls.filter((c) => c.status === 'MISSED').length,
        avgTalkTimeSec: connected ? Math.round(calls.filter((c) => c.status === 'CONNECTED').reduce((a, c) => a + c.durationSec, 0) / connected) : 0,
        conversionRatio: made ? Math.round((conversions / made) * 100) : 0,
      })
    }
    return ok({ rows })
  }

  if (type === 'followup-compliance') {
    const staff = await db.user.findMany({
      where: { role: { in: ['EXECUTIVE', 'TEAM_LEADER'] }, isActive: true, ...(deptFilter ? { department: { in: deptFilter } } : {}), ...(userIds ? { id: { in: userIds } } : {}) },
      select: { id: true, name: true },
    })
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    const rows: Array<Record<string, unknown>> = []
    for (const u of staff) {
      const [pending, overdue, completed] = await Promise.all([
        db.followUp.count({ where: { assignedToId: u.id, status: 'PENDING' } }),
        db.followUp.count({ where: { assignedToId: u.id, status: 'PENDING', dueAt: { lt: startToday } } }),
        db.followUp.count({ where: { assignedToId: u.id, status: 'COMPLETED' } }),
      ])
      const total = pending + completed
      rows.push({ name: u.name, pending, overdue, completed, compliancePct: total ? Math.round((completed / total) * 100) : 0 })
    }
    return ok({ rows })
  }

  if (type === 'campaign-roi') {
    const campaigns = await db.campaign.findMany({
      where: { ...(deptFilter ? { department: { in: deptFilter } } : {}) },
      include: { _count: { select: { leads: true, messages: true } } },
    })
    const rows = campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      leads: c._count.leads,
      messages: c._count.messages,
      conversions: 0,
      revenue: 0,
      budget: c.budget,
      roiPct: c.budget ? 0 : 0,
    }))
    // compute conversions/revenue per campaign from linked leads
    for (const r of rows) {
      const c = campaigns.find((x) => x.id === r.id)!
      const conv = await db.lead.count({ where: { campaignId: c.id, status: 'CONVERTED' } })
      const pay = await db.payment.aggregate({ where: { lead: { campaignId: c.id } }, _sum: { amount: true } })
      r.conversions = conv
      r.revenue = pay._sum.amount ?? 0
      r.roiPct = c.budget ? Math.round(((r.revenue - c.budget) / c.budget) * 100) : 0
    }
    return ok({ rows })
  }

  if (type === 'sticky-performance') {
    const staff = await db.user.findMany({
      where: { role: { in: ['EXECUTIVE', 'TEAM_LEADER'] }, isActive: true, ...(deptFilter ? { department: { in: deptFilter } } : {}), ...(userIds ? { id: { in: userIds } } : {}) },
      select: { id: true, name: true },
    })
    const rows: Array<Record<string, unknown>> = []
    for (const u of staff) {
      const [stickyLeads, convertedFromSticky] = await Promise.all([
        db.lead.count({ where: { assignedToId: u.id, isSticky: true } }),
        db.lead.count({ where: { assignedToId: u.id, isSticky: true, status: 'CONVERTED' } }),
      ])
      const sales = await db.salesOrder.aggregate({
        where: { lead: { assignedToId: u.id, isSticky: true } },
        _sum: { total: true },
      })
      rows.push({ name: u.name, stickyLeads, convertedFromSticky, salesFromSticky: sales._sum.total ?? 0 })
    }
    return ok({ rows })
  }

  throw new ApiError(`Unknown report type: ${type}`, 400)
})
