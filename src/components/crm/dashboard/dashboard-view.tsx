'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  IndianRupee,
  LifeBuoy,
  MessageCircle,
  Package,
  PhoneCall,
  RefreshCw,
  Repeat,
  ShoppingCart,
  Target,
  Truck,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, qs } from '@/lib/client'
import { formatDateTime, formatINR, formatTime, timeAgo } from '@/lib/format'
import { DEPT_BADGE, DEPT_LABELS, ROLE_LABELS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { PageHeader } from '@/components/crm/shared/page-header'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { EmptyState } from '@/components/crm/shared/empty-state'
import { masterExtra, useMasters } from '@/components/crm/shared/use-masters'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

// ---------------- types ----------------
type DashKpis = {
  monthlyTarget: number; todaysTarget: number; achieved: number; remaining: number
  achievementPct: number; todaysAchieved: number; todaysProgressPct: number
  totalLeads: number; activeLeads: number; convertedLeads: number; lostLeads: number
  conversionPct: number; stickyLeads: number; newLeadsToday: number
  callsToday: number; connectedToday: number; missedToday: number
  followupsToday: number; overdueFollowups: number; unreadChats: number
  pendingPayments: number; pendingPaymentsCount: number; ordersInProgress: number
  shipmentsPending: number; repeatCustomers: number; revenueMonth: number; videoCallsScheduled: number
}
type FollowupItem = { id: string; lead: { id: string; leadCode: string; customerName: string; department: string }; dueAt: string; note?: string | null }
type RecentLead = { id: string; leadCode: string; customerName: string; department: string; createdAt: string; stage: { label: string } | null }
type ExecRow = {
  userId: string; name: string; target: number; achieved: number; pct: number
  todaysTarget: number; todaysAchieved: number; pendingCalls: number; pendingFollowups: number
  conversionPct: number; stickyLeads: number; salesAmount: number
}
type DashboardResp = {
  role: string; department: string | null
  kpis: DashKpis
  charts: {
    pipeline: { name: string; count: number }[]
    sources: { name: string; count: number }[]
    geo: { name: string; leads: number; converted: number; revenue: number }[]
    trend: { date: string; leads: number; revenue: number }[]
    teamPerformance: { userId: string; name: string; target: number; achieved: number; pct: number }[]
  }
  lists: { todaysFollowups: FollowupItem[]; overdueFollowups: FollowupItem[]; recentLeads: RecentLead[]; executivePerformance: ExecRow[] }
}
type Team = { id: string; name: string; department: string; leader: { id: string; name: string }; members: { id: string; name: string; role: string }[] }
type ShipSummary = { packing: number; qc: number; dispatched: number; inTransit: number; delivered: number }
type TicketSummary = { open: number; inProgress: number; escalated: number; resolvedToday: number }
type InvSummary = { totalAmount: number; outstanding: number }
type ShipmentsResp = { shipments: unknown[]; total: number; summary: ShipSummary }
type TicketsResp = { tickets: unknown[]; total: number; summary: TicketSummary }
type InvoicesResp = { invoices: unknown[]; total: number; summary: InvSummary }

const PALETTE = ['#059669', '#d97706', '#0d9488', '#7c3aed', '#dc2626', '#65a30d', '#db2777', '#2563eb']

function DeptTag({ dept }: { dept: string | null | undefined }) {
  if (!dept) return <span className="text-stone-400">—</span>
  return (
    <span className={cn('rounded-full border px-1.5 py-px text-[10px] font-semibold', DEPT_BADGE[dept] ?? 'border-stone-200 bg-stone-100 text-stone-600')}>
      {dept}
    </span>
  )
}

function ProgressBar({ pct }: { pct: number }) {
  const p = Math.min(100, Math.max(0, Math.round(pct)))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-100" aria-hidden>
        <div
          className={cn('h-full rounded-full', p >= 100 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-500' : 'bg-rose-400')}
          style={{ width: `${Math.max(2, p)}%` }}
        />
      </div>
      <span className="text-xs font-medium text-stone-600">{p}%</span>
    </div>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-stone-800">{title}</p>
      {subtitle ? <p className="text-xs text-stone-500">{subtitle}</p> : null}
      <div className="mt-3 h-64">{children}</div>
    </div>
  )
}

function moneyTooltip(value: unknown): string {
  const n = Array.isArray(value) ? Number(value[0]) : Number(value)
  return Number.isFinite(n) && Math.abs(n) >= 1000 ? formatINR(n, true) : String(n)
}

function FollowupListCard({
  title, subtitle, items, emptyText, tone, onOpen,
}: {
  title: string
  subtitle?: string
  items: FollowupItem[]
  emptyText: string
  tone: 'amber' | 'rose'
  onOpen: (leadId: string) => void
}) {
  return (
    <div className="flex flex-col rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-stone-800">{title}</p>
          {subtitle ? <p className="text-xs text-stone-500">{subtitle}</p> : null}
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>
          {items.length}
        </span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-stone-400">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {items.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => onOpen(f.lead.id)}
                  className="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-800">{f.lead.customerName}</p>
                    <p className="truncate text-xs text-stone-500">
                      {f.lead.leadCode} · {f.note ? f.note : 'No note'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-stone-600">{formatTime(f.dueAt)}</p>
                    <DeptTag dept={f.lead.department} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function DashboardView() {
  const user = useAppStore((s) => s.user)
  const deptFilter = useAppStore((s) => s.deptFilter)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const { items } = useMasters()

  const role = user?.role ?? 'VIEWER'
  const isExec = role === 'EXECUTIVE'
  const isTL = role === 'TEAM_LEADER'
  const isManagerPlus = role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'VIEWER'
  const showTeam = isTL || isManagerPlus
  const showExecTable = isTL || isManagerPlus

  const [range, setRange] = useState<'today' | 'week' | 'month'>('month')
  const [teamId, setTeamId] = useState('')
  const [data, setData] = useState<DashboardResp | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [shipSummary, setShipSummary] = useState<ShipSummary | null>(null)
  const [ticketSummary, setTicketSummary] = useState<TicketSummary | null>(null)
  const [invSummary, setInvSummary] = useState<InvSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const deptParam = deptFilter || user?.department || ''

  const stageColorMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of items('pipeline_stage')) {
      const c = masterExtra(s.extra).color
      if (typeof c === 'string' && !m.has(s.label)) m.set(s.label, c)
    }
    return m
  }, [items])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const extraPromise: Promise<ShipmentsResp | TicketsResp | InvoicesResp | null> =
        role === 'DISPATCH'
          ? api<ShipmentsResp>(`/api/shipments${qs({ dept: deptParam })}`)
          : role === 'SUPPORT'
            ? api<TicketsResp>(`/api/tickets${qs({ dept: deptParam })}`)
            : role === 'ACCOUNTS'
              ? api<InvoicesResp>(`/api/invoices${qs({ dept: deptParam })}`)
              : Promise.resolve(null)

      const [d, t, ex] = await Promise.all([
        api<DashboardResp>(`/api/dashboard${qs({ dept: deptParam, range, teamId })}`),
        showTeam ? api<{ teams: Team[] }>(`/api/teams${qs({ dept: deptParam })}`) : Promise.resolve({ teams: [] as Team[] }),
        extraPromise,
      ])
      setData(d)
      setTeams(t.teams)
      if (ex) {
        if ('shipments' in ex) setShipSummary(ex.summary)
        else if ('tickets' in ex) setTicketSummary(ex.summary)
        else if ('invoices' in ex) setInvSummary(ex.summary)
      }
    } catch (e) {
      const msg = (e as Error).message || 'Failed to load dashboard'
      setError(msg)
      toast({ title: 'Failed to load dashboard', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [deptParam, range, teamId, role, showTeam, toast])

  useEffect(() => { load() }, [load])

  // Reset team filter when department scope changes
  useEffect(() => { setTeamId('') }, [deptFilter])

  const teamOptions = useMemo(
    () =>
      teams.filter((t) => {
        if (isTL) return t.leader?.id === user?.id || user?.teamId === t.id
        return true
      }),
    [teams, isTL, user]
  )
  const teamNameByUser = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of teams) for (const mem of t.members) m.set(mem.id, t.name)
    return m
  }, [teams])

  const k = data?.kpis
  const go = useCallback(
    (v: string, leadId?: string) => setView(v, leadId ? { leadId } : undefined),
    [setView]
  )

  // ---------------- loading / error ----------------
  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle={user ? `${ROLE_LABELS[user.role] ?? user.role} · ${user.department ? (DEPT_LABELS[user.department] ?? user.department) : 'All Departments'}` : undefined} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={`sk-kpi-${i}`} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={`sk-ch-${i}`} className="h-72 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Overview" />
        <EmptyState
          icon={AlertTriangle}
          title="Could not load dashboard"
          subtitle={error}
          action={
            <Button onClick={load} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          }
        />
      </div>
    )
  }

  if (!data || !k) return null

  const kpiGrid = 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4'
  const execGrid = 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'

  const sourcesPie = buildSourcesPie(data.charts.sources)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${ROLE_LABELS[role] ?? role} · ${data.department ? (DEPT_LABELS[data.department] ?? data.department) : 'All Departments'}${deptFilter ? ` · Filter: ${DEPT_LABELS[deptFilter] ?? deptFilter}` : ''}`}
      >
        {showTeam && teamOptions.length > 0 ? (
          <Select value={teamId || 'ALL_TEAMS'} onValueChange={(v) => setTeamId(v === 'ALL_TEAMS' ? '' : v)}>
            <SelectTrigger size="sm" className="w-[150px]" aria-label="Filter by team">
              <SelectValue placeholder="All Teams" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL_TEAMS">All Teams</SelectItem>
              {teamOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={range} onValueChange={(v) => setRange(v as 'today' | 'week' | 'month')}>
          <SelectTrigger size="sm" className="w-[130px]" aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9" onClick={load} aria-label="Refresh dashboard">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden /> Refresh
        </Button>
      </PageHeader>

      {/* ---------- KPI sections ---------- */}
      {isExec ? (
        <>
          <div className={execGrid}>
            <KpiCard label="Monthly Target" value={formatINR(k.monthlyTarget, true)} sub={`${k.achievementPct}% achieved`} icon={<Target className="h-4 w-4" />} progress={k.achievementPct} onClick={() => go('targets')} />
            <KpiCard label="Today's Target" value={formatINR(k.todaysTarget, true)} sub={`${k.todaysProgressPct}% progress today`} icon={<CalendarClock className="h-4 w-4" />} onClick={() => go('targets')} />
            <KpiCard label="Total Achieved" value={formatINR(k.achieved, true)} sub="This month" icon={<IndianRupee className="h-4 w-4" />} tone="positive" onClick={() => go('payments')} />
            <KpiCard label="Remaining Target" value={formatINR(k.remaining, true)} sub="To close this month" icon={<Activity className="h-4 w-4" />} tone="warning" onClick={() => go('targets')} />
            <KpiCard label="Achievement %" value={`${k.achievementPct}%`} sub="vs monthly target" icon={<BarChart3 className="h-4 w-4" />} progress={k.achievementPct} />
            <KpiCard label="Today's Progress %" value={`${k.todaysProgressPct}%`} sub={`${formatINR(k.todaysAchieved, true)} collected today`} icon={<Activity className="h-4 w-4" />} progress={k.todaysProgressPct} />
          </div>
          <div className={cn(execGrid, 'mt-3')}>
            <KpiCard label="Unique Leads" value={k.totalLeads} sub={`${k.activeLeads} active`} icon={<Users className="h-4 w-4" />} onClick={() => go('leads')} />
            <KpiCard label="Sticky Leads" value={k.stickyLeads} sub="Locked to you" icon={<ArrowLeftRight className="h-4 w-4" />} tone="positive" onClick={() => go('pipeline')} />
            <KpiCard label="Sales Conversion" value={`${k.conversionPct}%`} sub={`${k.convertedLeads} converted`} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => go('reports')} />
            <KpiCard label="Sales Amount" value={formatINR(data.lists.executivePerformance[0]?.salesAmount ?? 0, true)} sub="All-time" icon={<IndianRupee className="h-4 w-4" />} onClick={() => go('payments')} />
            <KpiCard label="Calls Today" value={k.callsToday} sub={`${k.connectedToday} connected · ${k.missedToday} missed`} icon={<PhoneCall className="h-4 w-4" />} onClick={() => go('dialer')} />
            <KpiCard label="Follow-ups Today" value={k.followupsToday} sub={`${k.overdueFollowups} overdue`} icon={<CalendarClock className="h-4 w-4" />} tone={k.overdueFollowups > 0 ? 'warning' : 'default'} onClick={() => go('followups')} />
          </div>
        </>
      ) : null}

      {isTL ? (
        <>
          <div className={execGrid}>
            <KpiCard label="Monthly Target" value={formatINR(k.monthlyTarget, true)} sub={`${k.achievementPct}% achieved`} icon={<Target className="h-4 w-4" />} progress={k.achievementPct} onClick={() => go('targets')} />
            <KpiCard label="Today's Target" value={formatINR(k.todaysTarget, true)} sub={`${k.todaysProgressPct}% today`} icon={<CalendarClock className="h-4 w-4" />} onClick={() => go('targets')} />
            <KpiCard label="Total Achieved" value={formatINR(k.achieved, true)} sub="This month" icon={<IndianRupee className="h-4 w-4" />} tone="positive" onClick={() => go('payments')} />
            <KpiCard label="Remaining Target" value={formatINR(k.remaining, true)} sub="This month" icon={<Activity className="h-4 w-4" />} tone="warning" onClick={() => go('targets')} />
            <KpiCard label="Achievement %" value={`${k.achievementPct}%`} sub="vs monthly target" icon={<BarChart3 className="h-4 w-4" />} progress={k.achievementPct} />
            <KpiCard label="Today's Progress %" value={`${k.todaysProgressPct}%`} sub={`${formatINR(k.todaysAchieved, true)} today`} icon={<Activity className="h-4 w-4" />} progress={k.todaysProgressPct} />
          </div>
          <div className={cn(execGrid, 'mt-3')}>
            <KpiCard label="Unique Leads" value={k.totalLeads} sub={`${k.activeLeads} active · ${k.newLeadsToday} new today`} icon={<Users className="h-4 w-4" />} onClick={() => go('leads')} />
            <KpiCard label="Sticky Leads" value={k.stickyLeads} sub="Active & locked" icon={<ArrowLeftRight className="h-4 w-4" />} tone="positive" onClick={() => go('pipeline')} />
            <KpiCard label="Sales Conversion" value={`${k.conversionPct}%`} sub={`${k.convertedLeads} converted`} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => go('reports')} />
            <KpiCard label="Team Pending Calls" value={sumExec(data.lists.executivePerformance, 'pendingCalls')} sub="Across executives today" icon={<PhoneCall className="h-4 w-4" />} onClick={() => go('dialer')} />
            <KpiCard label="Team Pending Follow-ups" value={sumExec(data.lists.executivePerformance, 'pendingFollowups')} sub={`+${k.overdueFollowups} overdue overall`} icon={<CalendarClock className="h-4 w-4" />} onClick={() => go('followups')} />
            <KpiCard label="Calls Today" value={k.callsToday} sub={`${k.connectedToday} connected`} icon={<PhoneCall className="h-4 w-4" />} onClick={() => go('dialer')} />
          </div>
        </>
      ) : null}

      {isManagerPlus ? (
        <>
          <div className={kpiGrid}>
            <KpiCard label="Total Leads" value={k.totalLeads} sub={`${k.newLeadsToday} new today`} icon={<Users className="h-4 w-4" />} onClick={() => go('leads')} />
            <KpiCard label="Active Leads" value={k.activeLeads} sub={`${k.lostLeads} lost`} icon={<Activity className="h-4 w-4" />} onClick={() => go('leads')} />
            <KpiCard label="Conversion Ratio" value={`${k.conversionPct}%`} sub={`${k.convertedLeads} of ${k.totalLeads} converted`} icon={<CheckCircle2 className="h-4 w-4" />} tone="positive" onClick={() => go('reports')} />
            <KpiCard label="Revenue (Month)" value={formatINR(k.revenueMonth, true)} sub={`${formatINR(k.todaysAchieved, true)} today`} icon={<IndianRupee className="h-4 w-4" />} tone="positive" onClick={() => go('payments')} />
            <KpiCard label="Pending Payments" value={formatINR(k.pendingPayments, true)} sub={`${k.pendingPaymentsCount} orders unpaid`} icon={<AlertTriangle className="h-4 w-4" />} tone="warning" onClick={() => go('payments')} />
            <KpiCard label="Shipments Pending" value={k.shipmentsPending} sub={`${k.ordersInProgress} orders in process`} icon={<Truck className="h-4 w-4" />} onClick={() => go('dispatch')} />
            <KpiCard label="Repeat Customers" value={k.repeatCustomers} sub="New vs repeat business" icon={<Repeat className="h-4 w-4" />} onClick={() => go('leads')} />
            <KpiCard label="Sticky Leads" value={k.stickyLeads} sub="Locked to executives" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => go('pipeline')} />
          </div>
          {k.monthlyTarget > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Monthly Target" value={formatINR(k.monthlyTarget, true)} sub="Team target this month" icon={<Target className="h-4 w-4" />} onClick={() => go('targets')} />
              <KpiCard label="Achieved" value={formatINR(k.achieved, true)} sub={`${k.achievementPct}% of target`} icon={<IndianRupee className="h-4 w-4" />} tone="positive" progress={k.achievementPct} onClick={() => go('payments')} />
              <KpiCard label="Remaining" value={formatINR(k.remaining, true)} sub="Gap to close" icon={<Activity className="h-4 w-4" />} tone="warning" onClick={() => go('payments')} />
              <KpiCard label="Today's Target" value={formatINR(k.todaysTarget, true)} sub={`${k.todaysProgressPct}% done today`} icon={<CalendarClock className="h-4 w-4" />} progress={k.todaysProgressPct} onClick={() => go('targets')} />
            </div>
          ) : null}
        </>
      ) : null}

      {role === 'ACCOUNTS' ? (
        <>
          <div className={kpiGrid}>
            <KpiCard label="Revenue (Month)" value={formatINR(k.revenueMonth, true)} sub="Collections this month" icon={<IndianRupee className="h-4 w-4" />} tone="positive" onClick={() => go('payments')} />
            <KpiCard label="Pending Payments" value={formatINR(k.pendingPayments, true)} sub={`${k.pendingPaymentsCount} orders unpaid`} icon={<AlertTriangle className="h-4 w-4" />} tone="warning" onClick={() => go('payments')} />
            <KpiCard label="Invoices Outstanding" value={formatINR(invSummary?.outstanding ?? 0, true)} sub="Unsettled invoices" icon={<Package className="h-4 w-4" />} onClick={() => go('payments')} />
            <KpiCard label="Payments Today" value={formatINR(k.todaysAchieved, true)} sub="Collected today" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => go('payments')} />
          </div>
          <div className={cn(kpiGrid, 'mt-3')}>
            <KpiCard label="Orders In Progress" value={k.ordersInProgress} sub="Confirmed / in process" icon={<ShoppingCart className="h-4 w-4" />} onClick={() => go('orders')} />
            <KpiCard label="Shipments Pending" value={k.shipmentsPending} sub="Not yet delivered" icon={<Truck className="h-4 w-4" />} onClick={() => go('dispatch')} />
            <KpiCard label="Converted Leads" value={k.convertedLeads} sub={`${k.conversionPct}% conversion`} icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => go('reports')} />
            <KpiCard label="Repeat Customers" value={k.repeatCustomers} sub="Repeat business" icon={<Repeat className="h-4 w-4" />} onClick={() => go('leads')} />
          </div>
        </>
      ) : null}

      {role === 'DISPATCH' ? (
        <>
          <div className={kpiGrid}>
            <KpiCard label="Shipments Pending" value={k.shipmentsPending} sub="Packing / QC / transit" icon={<Truck className="h-4 w-4" />} tone="warning" onClick={() => go('dispatch')} />
            <KpiCard label="In Transit" value={shipSummary?.inTransit ?? 0} sub={`${shipSummary?.dispatched ?? 0} dispatched`} icon={<Truck className="h-4 w-4" />} onClick={() => go('dispatch')} />
            <KpiCard label="Delivered (All Time)" value={shipSummary?.delivered ?? 0} sub="Completed shipments" icon={<CheckCircle2 className="h-4 w-4" />} tone="positive" onClick={() => go('dispatch')} />
            <KpiCard
              label="Dispatch Efficiency"
              value={`${dispatchEfficiency(shipSummary)}%`}
              sub="Delivered vs total shipments"
              icon={<BarChart3 className="h-4 w-4" />}
              progress={dispatchEfficiency(shipSummary)}
            />
          </div>
          <div className={cn(kpiGrid, 'mt-3')}>
            <KpiCard label="In Packing" value={shipSummary?.packing ?? 0} sub="Ready to process" icon={<Package className="h-4 w-4" />} onClick={() => go('dispatch')} />
            <KpiCard label="In QC" value={shipSummary?.qc ?? 0} sub="Quality check" icon={<Package className="h-4 w-4" />} onClick={() => go('dispatch')} />
            <KpiCard label="Orders In Progress" value={k.ordersInProgress} sub="Awaiting dispatch" icon={<ShoppingCart className="h-4 w-4" />} onClick={() => go('dispatch')} />
            <KpiCard label="Support Tickets" value={ticketSummary ? ticketSummary.open + ticketSummary.inProgress : 0} sub="Open + in progress" icon={<LifeBuoy className="h-4 w-4" />} onClick={() => go('tickets')} />
          </div>
        </>
      ) : null}

      {role === 'SUPPORT' ? (
        <>
          <div className={kpiGrid}>
            <KpiCard label="Open Tickets" value={ticketSummary?.open ?? 0} sub="Awaiting first response" icon={<LifeBuoy className="h-4 w-4" />} tone="warning" onClick={() => go('tickets')} />
            <KpiCard label="In Progress" value={ticketSummary?.inProgress ?? 0} sub="Being worked on" icon={<Activity className="h-4 w-4" />} onClick={() => go('tickets')} />
            <KpiCard label="Escalated" value={ticketSummary?.escalated ?? 0} sub="Needs manager attention" icon={<AlertTriangle className="h-4 w-4" />} tone="negative" onClick={() => go('tickets')} />
            <KpiCard label="Resolved Today" value={ticketSummary?.resolvedToday ?? 0} sub="Closed today" icon={<CheckCircle2 className="h-4 w-4" />} tone="positive" onClick={() => go('tickets')} />
          </div>
          <div className={cn(kpiGrid, 'mt-3')}>
            <KpiCard label="New Leads Today" value={k.newLeadsToday} sub={`${k.totalLeads} total leads`} icon={<Users className="h-4 w-4" />} onClick={() => go('leads')} />
            <KpiCard label="Calls Today" value={k.callsToday} sub={`${k.connectedToday} connected`} icon={<PhoneCall className="h-4 w-4" />} onClick={() => go('dialer')} />
            <KpiCard label="Follow-ups Today" value={k.followupsToday} sub={`${k.overdueFollowups} overdue`} icon={<CalendarClock className="h-4 w-4" />} onClick={() => go('followups')} />
            <KpiCard label="Unread Chats" value={k.unreadChats} sub="WhatsApp conversations" icon={<MessageCircle className="h-4 w-4" />} onClick={() => go('whatsapp')} />
          </div>
        </>
      ) : null}

      {/* ---------- Charts ---------- */}
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Pipeline Funnel" subtitle="Leads per stage">
          {data.charts.pipeline.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">No pipeline data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...data.charts.pipeline].reverse()} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e5e4" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#78716c' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#57534e' }} />
                <Tooltip cursor={{ fill: 'rgba(16,185,129,0.06)' }} formatter={(v) => moneyTooltip(v)} />
                <Bar dataKey="count" name="Leads" radius={[0, 4, 4, 0]} barSize={14}>
                  {data.charts.pipeline.map((entry) => (
                    <Cell key={entry.name} fill={stageColorMap.get(entry.name) ?? '#059669'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="14-Day Trend" subtitle="New leads & collections">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.charts.trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#78716c' }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#78716c' }} allowDecimals={false} width={32} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: '#78716c' }}
                width={52}
                tickFormatter={(v: number) => formatINR(v, true).replace('₹', '')}
              />
              <Tooltip formatter={(v) => moneyTooltip(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="leads" name="New Leads" stroke="#059669" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue ₹" stroke="#d97706" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead Sources" subtitle="Where leads come from">
          {sourcesPie.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">No source data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sourcesPie} dataKey="count" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {sourcesPie.map((entry, i) => (
                    <Cell key={entry.name} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => moneyTooltip(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Top Locations" subtitle={data.department === 'EXPORT' ? 'By country' : data.department === 'ONLINE' ? 'By state' : 'Country / state of leads'}>
          {data.charts.geo.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">No geo data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...data.charts.geo].slice(0, 8).reverse()} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e5e4" />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#78716c' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#57534e' }} />
                <Tooltip
                  cursor={{ fill: 'rgba(16,185,129,0.06)' }}
                  formatter={(v, name) => [name === 'revenue' ? formatINR(Array.isArray(v) ? Number(v[0]) : Number(v)) : moneyTooltip(v), name === 'revenue' ? 'Revenue' : String(name)]}
                />
                <Bar dataKey="leads" name="Leads" fill="#059669" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* ---------- Follow-up lists ---------- */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FollowupListCard
          title="Today's Follow-ups"
          subtitle="Scheduled for today"
          items={data.lists.todaysFollowups}
          emptyText="Nothing due today 🎉"
          tone="amber"
          onOpen={(leadId) => go('lead-detail', leadId)}
        />
        <FollowupListCard
          title="Overdue Follow-ups"
          subtitle="Pending from earlier days"
          items={data.lists.overdueFollowups}
          emptyText="No overdue follow-ups"
          tone="rose"
          onOpen={(leadId) => go('lead-detail', leadId)}
        />
      </div>

      {/* ---------- Recent leads ---------- */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-800">Recent Leads</h3>
          <Button variant="ghost" size="sm" className="text-emerald-700 hover:text-emerald-800" onClick={() => go('leads')}>
            View all →
          </Button>
        </div>
        <DataTable<RecentLead>
          columns={[
            { key: 'leadCode', header: 'Lead Code', className: 'font-medium text-stone-900' },
            { key: 'customerName', header: 'Customer' },
            { key: 'department', header: 'Dept', render: (r) => <DeptTag dept={r.department} /> },
            { key: 'stage', header: 'Stage', render: (r) => r.stage?.label ?? '—' },
            { key: 'createdAt', header: 'Created', render: (r) => timeAgo(r.createdAt) },
          ] as Column<RecentLead>[]}
          rows={data.lists.recentLeads}
          loading={loading && !data}
          emptyMessage="No leads yet"
          onRowClick={(r) => go('lead-detail', r.id)}
        />
      </div>

      {/* ---------- Executive performance ---------- */}
      {showExecTable ? (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-stone-800">Executive Performance — This Month</h3>
          <DataTable<ExecRow>
            columns={[
              { key: 'name', header: 'Executive', render: (r) => <span className="font-medium text-stone-900">{r.name}</span> },
              { key: 'team', header: 'Team', render: (r) => teamNameByUser.get(r.userId) ?? '—' },
              { key: 'target', header: 'Target', render: (r) => formatINR(r.target) },
              { key: 'achieved', header: 'Achieved', render: (r) => formatINR(r.achieved) },
              { key: 'pct', header: 'Achievement %', render: (r) => <ProgressBar pct={r.pct} /> },
              { key: 'todaysAchieved', header: 'Today', render: (r) => formatINR(r.todaysAchieved, true) },
              { key: 'pendingCalls', header: 'Pending Calls', render: (r) => (r.pendingCalls > 0 ? <span className="font-semibold text-amber-700">{r.pendingCalls}</span> : '0') },
              { key: 'pendingFollowups', header: 'Pending FU', render: (r) => (r.pendingFollowups > 0 ? <span className="font-semibold text-rose-700">{r.pendingFollowups}</span> : '0') },
              { key: 'conversionPct', header: 'Conversion %', render: (r) => `${r.conversionPct}%` },
            ] as Column<ExecRow>[]}
            rows={data.lists.executivePerformance}
            loading={loading && !data}
            emptyMessage="No executives in scope"
          />
        </div>
      ) : null}

      <p className="mt-6 text-center text-[11px] text-stone-400">
        Data as of {formatDateTime(new Date())} · All amounts in ₹ INR
      </p>
    </div>
  )
}

// ---------------- helpers (module scope) ----------------
function sumExec(rows: ExecRow[], key: 'pendingCalls' | 'pendingFollowups'): number {
  return rows.reduce((s, r) => s + r[key], 0)
}

function dispatchEfficiency(s: ShipSummary | null): number {
  if (!s) return 0
  const total = s.packing + s.qc + s.dispatched + s.inTransit + s.delivered
  return total > 0 ? Math.round((s.delivered / total) * 100) : 0
}

function buildSourcesPie(sources: { name: string; count: number }[]): { name: string; count: number }[] {
  const top = sources.slice(0, 6)
  const rest = sources.slice(6).reduce((s, x) => s + x.count, 0)
  const out = top.map((s) => ({ name: s.name, count: s.count }))
  if (rest > 0) out.push({ name: 'Others', count: rest })
  return out
}
