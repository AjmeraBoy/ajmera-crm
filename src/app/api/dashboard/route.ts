import { db } from '@/lib/db'
import { assertDeptAccess, deptScope, isManagement, ok, requireUser, route } from '@/lib/api'

// ---------------- date helpers ----------------
function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function dayLabel(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

const FOLLOWUP_LIST_SELECT = {
  id: true,
  dueAt: true,
  note: true,
  lead: { select: { id: true, leadCode: true, customerName: true, department: true } },
} as const

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const deptParam = sp.get('dept')
  const teamIdParam = sp.get('teamId')
  const userIdParam = sp.get('userId')
  if (deptParam) assertDeptAccess(user, deptParam)
  const scope = deptParam ? [deptParam] : deptScope(user) // null = all departments

  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const mStart = startOfMonth(now)
  const mEnd = endOfMonth(now)
  const month = monthKey(now)

  // ---------- personal scope users ----------
  // EXECUTIVE → self; TEAM_LEADER → self + own team members; management may pass userId (view-as)
  let scopeUsers: string[] | undefined
  let tlTeamIds: string[] = []
  if (user.role === 'EXECUTIVE') {
    scopeUsers = [user.id]
  } else if (user.role === 'TEAM_LEADER') {
    if (teamIdParam) {
      const t = await db.team.findUnique({ where: { id: teamIdParam }, select: { id: true, leaderId: true } })
      if (t && (t.leaderId === user.id || user.teamId === t.id)) tlTeamIds = [t.id]
    }
    if (tlTeamIds.length === 0) {
      const led = await db.team.findMany({ where: { leaderId: user.id }, select: { id: true } })
      tlTeamIds = led.map((t) => t.id)
      if (user.teamId && !tlTeamIds.includes(user.teamId)) tlTeamIds.push(user.teamId)
    }
    const members = await db.user.findMany({ where: { teamId: { in: tlTeamIds }, isActive: true }, select: { id: true } })
    scopeUsers = Array.from(new Set([user.id, ...members.map((m) => m.id)]))
  } else if (userIdParam && isManagement(user)) {
    scopeUsers = [userIdParam]
  }

  const deptFilter = scope ? { department: { in: scope } } : {}
  const leadWhere = { ...(scopeUsers ? { assignedToId: { in: scopeUsers } } : {}), ...deptFilter }
  const paymentScopeWhere = scopeUsers ? { lead: { assignedToId: { in: scopeUsers }, ...deptFilter } } : { ...deptFilter }

  // ---------- settings & people ----------
  const [settingRows, orgUsers] = await Promise.all([
    db.setting.findMany(),
    db.user.findMany({
      where: { isActive: true, ...(scope ? { department: { in: scope } } : {}) },
      select: { id: true, name: true, role: true, department: true, dailyCallTarget: true },
    }),
  ])
  const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]))
  const workingDays = Number(settings.WORKING_DAYS) || 26

  // ---------- targets & collections ----------
  const targetUserIds = scopeUsers ?? orgUsers.map((u) => u.id)
  const [targetRows, monthPayments, todayPayments, allPayments] = await Promise.all([
    db.target.findMany({ where: { month, userId: { in: targetUserIds } }, select: { userId: true, amount: true } }),
    db.payment.findMany({
      where: { ...paymentScopeWhere, paidAt: { gte: mStart, lte: mEnd } },
      select: { amount: true, lead: { select: { assignedToId: true } } },
    }),
    db.payment.findMany({
      where: { ...paymentScopeWhere, paidAt: { gte: todayStart, lte: todayEnd } },
      select: { amount: true, lead: { select: { assignedToId: true } } },
    }),
    db.payment.findMany({
      where: paymentScopeWhere,
      select: { amount: true, leadId: true, lead: { select: { assignedToId: true } } },
    }),
  ])
  const monthlyTarget = targetRows.reduce((s, t) => s + t.amount, 0)
  const achieved = monthPayments.reduce((s, p) => s + p.amount, 0)
  const todaysAchieved = todayPayments.reduce((s, p) => s + p.amount, 0)
  const todaysTarget = Math.round(monthlyTarget / workingDays)
  const remaining = Math.max(0, monthlyTarget - achieved)

  const targetByUser = new Map(targetRows.map((t) => [t.userId, t.amount]))
  const achievedByUser = new Map<string, number>()
  for (const p of monthPayments) {
    const uid = p.lead?.assignedToId
    if (uid) achievedByUser.set(uid, (achievedByUser.get(uid) ?? 0) + p.amount)
  }
  const todayByUser = new Map<string, number>()
  for (const p of todayPayments) {
    const uid = p.lead?.assignedToId
    if (uid) todayByUser.set(uid, (todayByUser.get(uid) ?? 0) + p.amount)
  }
  const allByUser = new Map<string, number>()
  for (const p of allPayments) {
    const uid = p.lead?.assignedToId
    if (uid) allByUser.set(uid, (allByUser.get(uid) ?? 0) + p.amount)
  }

  // ---------- lead kpis ----------
  const [totalLeads, activeLeads, convertedLeads, lostLeads, stickyLeads, newLeadsToday] = await Promise.all([
    db.lead.count({ where: leadWhere }),
    db.lead.count({ where: { ...leadWhere, status: 'ACTIVE' } }),
    db.lead.count({ where: { ...leadWhere, status: 'CONVERTED' } }),
    db.lead.count({ where: { ...leadWhere, status: 'LOST' } }),
    db.lead.count({ where: { ...leadWhere, isSticky: true, status: 'ACTIVE' } }),
    db.lead.count({ where: { ...leadWhere, createdAt: { gte: todayStart } } }),
  ])

  // ---------- calls today ----------
  const staffIds = scopeUsers ?? orgUsers.map((u) => u.id)
  const callBase = { userId: { in: staffIds }, createdAt: { gte: todayStart, lte: todayEnd } }
  const [callsToday, connectedToday, missedToday] = await Promise.all([
    db.callLog.count({ where: callBase }),
    db.callLog.count({ where: { ...callBase, status: 'CONNECTED' } }),
    db.callLog.count({ where: { ...callBase, status: 'MISSED' } }),
  ])

  // ---------- follow-ups ----------
  const fuScope = scopeUsers ? { assignedToId: { in: scopeUsers } } : { lead: deptFilter }
  const [followupsToday, overdueFollowups] = await Promise.all([
    db.followUp.count({ where: { ...fuScope, status: 'PENDING', dueAt: { gte: todayStart, lte: todayEnd } } }),
    db.followUp.count({ where: { ...fuScope, status: 'PENDING', dueAt: { lt: todayStart } } }),
  ])

  // ---------- chats / orders / shipments / meetings ----------
  const convWhere = scopeUsers
    ? { ownerId: { in: scopeUsers }, unreadCount: { gt: 0 } }
    : { ...(scope ? { dept: { in: scope } } : {}), unreadCount: { gt: 0 } }
  const orderWhere = scopeUsers ? { lead: { assignedToId: { in: scopeUsers }, ...deptFilter } } : deptFilter
  const shipmentWhere = scopeUsers
    ? { stage: { not: 'DELIVERED' }, order: { lead: { assignedToId: { in: scopeUsers }, ...deptFilter } } }
    : { stage: { not: 'DELIVERED' }, ...deptFilter }
  const meetingWhere = scopeUsers
    ? { scheduledAt: { gte: now }, lead: { assignedToId: { in: scopeUsers }, ...deptFilter } }
    : { scheduledAt: { gte: now }, lead: deptFilter }

  const [unreadChats, ordersInProgress, pendingOrdersAgg, pendingOrdersCount, repeatCustomers, shipmentsPending, videoCallsScheduled] =
    await Promise.all([
      db.whatsAppConversation.count({ where: convWhere }),
      db.salesOrder.count({ where: { ...orderWhere, status: { in: ['CONFIRMED', 'IN_PROCESS'] } } }),
      db.salesOrder.aggregate({
        where: { ...orderWhere, paymentStatus: { not: 'PAID' } },
        _sum: { total: true, paidAmount: true },
      }),
      db.salesOrder.count({ where: { ...orderWhere, paymentStatus: { not: 'PAID' } } }),
      db.lead.count({ where: { ...leadWhere, customerType: 'REPEAT' } }),
      db.shipment.count({ where: shipmentWhere }),
      db.meeting.count({ where: meetingWhere }),
    ])
  const pendingPayments = Math.max(0, (pendingOrdersAgg._sum.total ?? 0) - (pendingOrdersAgg._sum.paidAmount ?? 0))

  // ---------- charts: pipeline ----------
  const stageRows = await db.masterItem.findMany({
    where: {
      type: 'pipeline_stage',
      isActive: true,
      ...(scope && scope.length === 1 ? { dept: { in: [scope[0], 'ALL'] } } : {}),
    },
    orderBy: { order: 'asc' },
  })
  const stageCounts = await db.lead.groupBy({
    by: ['stageId'],
    where: { ...leadWhere, stageId: { not: null } },
    _count: { _all: true },
  })
  const countByStage = new Map(stageCounts.map((c) => [c.stageId, c._count._all]))
  const pipelineMap = new Map<string, number>()
  for (const s of stageRows) pipelineMap.set(s.label, (pipelineMap.get(s.label) ?? 0) + (countByStage.get(s.id) ?? 0))
  const pipeline = Array.from(pipelineMap.entries()).map(([name, count]) => ({ name, count }))

  // ---------- charts: sources ----------
  const sourceCounts = await db.lead.groupBy({
    by: ['sourceId'],
    where: { ...leadWhere, sourceId: { not: null } },
    _count: { _all: true },
  })
  const sourceIds = sourceCounts.map((c) => c.sourceId).filter((x): x is string => Boolean(x))
  const sourceItems = sourceIds.length
    ? await db.masterItem.findMany({ where: { id: { in: sourceIds } }, select: { id: true, label: true } })
    : []
  const sourceLabel = new Map(sourceItems.map((s) => [s.id, s.label]))
  // merge counts by label (ONLINE + EXPORT may define the same source label)
  const sourceAgg = new Map<string, number>()
  for (const c of sourceCounts) {
    const name = (c.sourceId && sourceLabel.get(c.sourceId)) || 'Unknown'
    sourceAgg.set(name, (sourceAgg.get(name) ?? 0) + c._count._all)
  }
  const sources = Array.from(sourceAgg.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  // ---------- charts: geo (EXPORT → country, ONLINE → state, mixed → both) ----------
  const geoMode = scope && scope.length === 1 ? (scope[0] === 'EXPORT' ? 'country' : 'state') : 'mixed'
  const geoLeads = await db.lead.findMany({
    where: leadWhere,
    select: {
      id: true,
      status: true,
      department: true,
      country: { select: { label: true } },
      state: { select: { label: true } },
    },
  })
  const geoIndex = new Map(geoLeads.map((l) => [l.id, l]))
  const geoMap = new Map<string, { leads: number; converted: number; revenue: number }>()
  const geoNameFor = (l: (typeof geoLeads)[number]): string | null => {
    if (geoMode === 'country') return l.country?.label ?? null
    if (geoMode === 'state') return l.state?.label ?? null
    return l.department === 'EXPORT' ? (l.country?.label ?? null) : (l.state?.label ?? null)
  }
  for (const l of geoLeads) {
    const name = geoNameFor(l)
    if (!name) continue
    const agg = geoMap.get(name) ?? { leads: 0, converted: 0, revenue: 0 }
    agg.leads += 1
    if (l.status === 'CONVERTED') agg.converted += 1
    geoMap.set(name, agg)
  }
  for (const p of allPayments) {
    if (!p.leadId) continue
    const lead = geoIndex.get(p.leadId)
    if (!lead) continue
    const name = geoNameFor(lead)
    if (!name) continue
    const agg = geoMap.get(name) ?? { leads: 0, converted: 0, revenue: 0 }
    agg.revenue += p.amount
    geoMap.set(name, agg)
  }
  const geo = Array.from(geoMap.entries())
    .map(([name, a]) => ({ name, leads: a.leads, converted: a.converted, revenue: a.revenue }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 12)

  // ---------- charts: 14-day trend ----------
  const trendStart = startOfDay(new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000))
  const [trendLeads, trendPayments] = await Promise.all([
    db.lead.findMany({ where: { ...leadWhere, createdAt: { gte: trendStart } }, select: { createdAt: true } }),
    db.payment.findMany({ where: { ...paymentScopeWhere, paidAt: { gte: trendStart } }, select: { paidAt: true, amount: true } }),
  ])
  const leadsByDay = new Map<string, number>()
  for (const l of trendLeads) {
    const key = dayKey(l.createdAt)
    leadsByDay.set(key, (leadsByDay.get(key) ?? 0) + 1)
  }
  const revenueByDay = new Map<string, number>()
  for (const p of trendPayments) {
    const key = dayKey(p.paidAt)
    revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + p.amount)
  }
  const trend: { date: string; leads: number; revenue: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = startOfDay(new Date(now.getTime() - i * 24 * 60 * 60 * 1000))
    const key = dayKey(d)
    trend.push({ date: dayLabel(d), leads: leadsByDay.get(key) ?? 0, revenue: revenueByDay.get(key) ?? 0 })
  }

  // ---------- charts: teamPerformance (per team in dept scope) ----------
  let teamPerformance: { userId: string; name: string; target: number; achieved: number; pct: number }[] = []
  if (user.role !== 'EXECUTIVE') {
    const teamRows = await db.team.findMany({
      where: {
        ...(user.role === 'TEAM_LEADER' ? { id: { in: tlTeamIds } } : { ...(scope ? { department: { in: scope } } : {}) }),
        ...(teamIdParam ? { id: teamIdParam } : {}),
      },
      select: { id: true, name: true, leaderId: true, members: { select: { id: true } } },
      orderBy: { name: 'asc' },
    })
    teamPerformance = teamRows
      .map((t) => {
        const memberIds = t.members.map((m) => m.id)
        const tTarget = memberIds.reduce((s, id) => s + (targetByUser.get(id) ?? 0), 0)
        const tAchieved = memberIds.reduce((s, id) => s + (achievedByUser.get(id) ?? 0), 0)
        return { userId: t.leaderId ?? t.id, name: t.name, target: tTarget, achieved: tAchieved, pct: pct(tAchieved, tTarget) }
      })
      .sort((a, b) => b.achieved - a.achieved)
  }

  // ---------- lists: follow-ups + recent leads ----------
  const fuListScope = scopeUsers ? { assignedToId: { in: scopeUsers } } : { lead: deptFilter }
  const [todaysFollowups, overdueFollowupRows, recentLeadRows] = await Promise.all([
    db.followUp.findMany({
      where: { ...fuListScope, status: 'PENDING', dueAt: { gte: todayStart, lte: todayEnd } },
      select: FOLLOWUP_LIST_SELECT,
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    db.followUp.findMany({
      where: { ...fuListScope, status: 'PENDING', dueAt: { lt: todayStart } },
      select: FOLLOWUP_LIST_SELECT,
      orderBy: { dueAt: 'asc' },
      take: 20,
    }),
    db.lead.findMany({
      where: leadWhere,
      select: {
        id: true,
        leadCode: true,
        customerName: true,
        department: true,
        createdAt: true,
        stage: { select: { label: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  // ---------- lists: executivePerformance ----------
  const execUserRows = scopeUsers
    ? await db.user.findMany({
        where: { id: { in: scopeUsers }, isActive: true },
        select: { id: true, name: true, dailyCallTarget: true },
      })
    : await db.user.findMany({
        where: { role: 'EXECUTIVE', isActive: true, ...(scope ? { department: { in: scope } } : {}) },
        select: { id: true, name: true, dailyCallTarget: true },
      })
  const execIds = execUserRows.map((u) => u.id)
  const callsByUser = new Map<string, number>()
  const pendingFuByUser = new Map<string, number>()
  const leadsByUser = new Map<string, number>()
  const convertedByUser = new Map<string, number>()
  const stickyByUser = new Map<string, number>()
  if (execIds.length > 0) {
    const [callsG, fuG, leadsG, convG, stickyG] = await Promise.all([
      db.callLog.groupBy({
        by: ['userId'],
        where: { userId: { in: execIds }, createdAt: { gte: todayStart, lte: todayEnd } },
        _count: { _all: true },
      }),
      db.followUp.groupBy({
        by: ['assignedToId'],
        where: { assignedToId: { in: execIds }, status: 'PENDING', dueAt: { lte: todayEnd } },
        _count: { _all: true },
      }),
      db.lead.groupBy({ by: ['assignedToId'], where: { assignedToId: { in: execIds } }, _count: { _all: true } }),
      db.lead.groupBy({
        by: ['assignedToId'],
        where: { assignedToId: { in: execIds }, status: 'CONVERTED' },
        _count: { _all: true },
      }),
      db.lead.groupBy({
        by: ['assignedToId'],
        where: { assignedToId: { in: execIds }, isSticky: true, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ])
    for (const c of callsG) if (c.userId) callsByUser.set(c.userId, c._count._all)
    for (const c of fuG) if (c.assignedToId) pendingFuByUser.set(c.assignedToId, c._count._all)
    for (const c of leadsG) if (c.assignedToId) leadsByUser.set(c.assignedToId, c._count._all)
    for (const c of convG) if (c.assignedToId) convertedByUser.set(c.assignedToId, c._count._all)
    for (const c of stickyG) if (c.assignedToId) stickyByUser.set(c.assignedToId, c._count._all)
  }
  const executivePerformance = execUserRows
    .map((u) => {
      const target = targetByUser.get(u.id) ?? 0
      const uAchieved = achievedByUser.get(u.id) ?? 0
      const total = leadsByUser.get(u.id) ?? 0
      const converted = convertedByUser.get(u.id) ?? 0
      return {
        userId: u.id,
        name: u.name,
        target,
        achieved: uAchieved,
        pct: pct(uAchieved, target),
        todaysTarget: Math.round(target / workingDays),
        todaysAchieved: todayByUser.get(u.id) ?? 0,
        pendingCalls: Math.max(0, u.dailyCallTarget - (callsByUser.get(u.id) ?? 0)),
        pendingFollowups: pendingFuByUser.get(u.id) ?? 0,
        conversionPct: pct(converted, total),
        stickyLeads: stickyByUser.get(u.id) ?? 0,
        salesAmount: allByUser.get(u.id) ?? 0,
      }
    })
    .sort((a, b) => b.achieved - a.achieved)

  return ok({
    role: user.role,
    department: user.department,
    kpis: {
      monthlyTarget,
      todaysTarget,
      achieved,
      remaining,
      achievementPct: pct(achieved, monthlyTarget),
      todaysAchieved,
      todaysProgressPct: pct(todaysAchieved, todaysTarget),
      totalLeads,
      activeLeads,
      convertedLeads,
      lostLeads,
      conversionPct: pct(convertedLeads, totalLeads),
      stickyLeads,
      newLeadsToday,
      callsToday,
      connectedToday,
      missedToday,
      followupsToday,
      overdueFollowups,
      unreadChats,
      pendingPayments,
      pendingPaymentsCount: pendingOrdersCount,
      ordersInProgress,
      shipmentsPending,
      repeatCustomers,
      revenueMonth: achieved,
      videoCallsScheduled,
    },
    charts: { pipeline, sources, geo, trend, teamPerformance },
    lists: {
      todaysFollowups,
      overdueFollowups: overdueFollowupRows,
      recentLeads: recentLeadRows,
      executivePerformance,
    },
  })
})
