'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  CalendarCheck,
  Download,
  Filter,
  Globe,
  IndianRupee,
  Megaphone,
  PhoneCall,
  Pin,
  RefreshCw,
  Repeat,
  Share2,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { cn } from '@/lib/utils'
import { formatDate, formatDuration, formatINR } from '@/lib/format'
import { DEPARTMENTS, DEPT_LABELS, SHIPMENT_STAGE_LABELS } from '@/lib/constants'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { useAppStore } from '@/store/app-store'

// ---------- report catalogue ----------

const CHART_COLORS = ['#059669', '#d97706', '#0d9488', '#7c3aed', '#dc2626', '#65a30d', '#db2777', '#2563eb']
const AXIS_TICK = { fontSize: 11, fill: '#78716c' }

const REPORTS: { id: ReportId; label: string; icon: LucideIcon; desc: string }[] = [
  { id: 'lead-conversion', label: 'Lead Conversion', icon: Filter, desc: 'Funnel stages & conversion rate' },
  { id: 'executive-performance', label: 'Executive Performance', icon: Users, desc: 'Per-executive scorecard' },
  { id: 'revenue', label: 'Revenue', icon: IndianRupee, desc: 'Monthly revenue trend' },
  { id: 'geo', label: 'Geo Performance', icon: Globe, desc: 'State / country-wise results' },
  { id: 'source-wise', label: 'Source-wise', icon: Share2, desc: 'Lead source effectiveness' },
  { id: 'dispatch', label: 'Dispatch', icon: Truck, desc: 'Shipment stages & aging' },
  { id: 'outstanding', label: 'Outstanding Payments', icon: Wallet, desc: 'Unpaid & overdue invoices' },
  { id: 'collection', label: 'Collection', icon: Banknote, desc: 'Monthly collections' },
  { id: 'new-vs-repeat', label: 'New vs Repeat', icon: Repeat, desc: 'Customer mix & revenue split' },
  { id: 'call-quality', label: 'Call Quality', icon: PhoneCall, desc: 'Connect rate & talk time' },
  { id: 'followup-compliance', label: 'Follow-up Compliance', icon: CalendarCheck, desc: 'Pending vs completed follow-ups' },
  { id: 'campaign-roi', label: 'Campaign ROI', icon: Megaphone, desc: 'Campaign cost vs return' },
  { id: 'sticky-performance', label: 'Sticky Performance', icon: Pin, desc: 'Sticky ownership results' },
]

type ReportId =
  | 'lead-conversion'
  | 'executive-performance'
  | 'revenue'
  | 'geo'
  | 'source-wise'
  | 'dispatch'
  | 'outstanding'
  | 'collection'
  | 'new-vs-repeat'
  | 'call-quality'
  | 'followup-compliance'
  | 'campaign-roi'
  | 'sticky-performance'

// ---------- response shapes (docs/api-contract.md — Reports) ----------

type LeadConversionResp = { summary: { total: number; converted: number; lost: number; conversionPct: number }; funnel: { stage: string; count: number }[] }
type ExecPerformanceResp = { rows: { userId: string; name: string; team: string; leadsAssigned: number; calls: number; connected: number; followupsDone: number; conversions: number; salesAmount: number; target: number; achievementPct: number }[] }
type RevenueResp = { rows: { month: string; orders: number; revenue: number }[]; totalRevenue: number }
type GeoResp = { rows: { name: string; leads: number; converted: number; lost: number; pending: number; revenue: number; conversionPct: number }[] }
type SourceResp = { rows: { name: string; leads: number; converted: number; conversionPct: number; revenue: number }[] }
type DispatchResp = { rows: { stage: string; count: number }[]; aging: { bucket: string; count: number }[] }
type OutstandingResp = { rows: { invoiceNo: string; orderNo: string; leadCode: string; customer: string; amount: number; paidAmount: number; dueDate: string | null; daysOverdue: number; status: string }[]; totals: { outstanding: number; overdue: number } }
type CollectionResp = { rows: { month: string; amount: number; count: number }[]; total: number }
type NewVsRepeatResp = { newCount: number; repeatCount: number; newRevenue: number; repeatRevenue: number }
type CallQualityResp = { rows: { name: string; callsMade: number; connected: number; notConnected: number; missed: number; avgTalkTimeSec: number; conversionRatio: number }[] }
type FollowupResp = { rows: { name: string; pending: number; overdue: number; completed: number; compliancePct: number }[] }
type CampaignRoiResp = { rows: { id: string; name: string; type: string; leads: number; messages: number; conversions: number; revenue: number; budget: number | null; roiPct: number }[] }
type StickyResp = { rows: { name: string; stickyLeads: number; convertedFromSticky: number; salesFromSticky: number }[] }

// ---------- small shared pieces ----------

function monthLabel(m: string): string {
  const [y, mo] = m.split('-')
  const d = new Date(Number(y), Number(mo) - 1, 1)
  if (isNaN(d.getTime())) return m
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  )
}

function MiniBar({ pct }: { pct: number }) {
  const v = Math.min(100, Math.max(0, Math.round(pct)))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-100" aria-hidden>
        <div
          className={cn('h-full rounded-full', v >= 100 ? 'bg-emerald-500' : v >= 60 ? 'bg-amber-500' : 'bg-rose-400')}
          style={{ width: `${Math.max(3, v)}%` }}
        />
      </div>
      <span className="text-xs font-medium text-stone-600">{pct}%</span>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50/60 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">{title}</p>
      {children}
    </div>
  )
}

function EmptyRows({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-stone-400">{label}</p>
}

// ---------- main view ----------

export default function ReportsView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const [type, setType] = useState<ReportId>('lead-conversion')
  const [dept, setDept] = useState(user?.department ?? '__all__')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const canPickDept = !user?.department

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const toParam = to ? `${to}T23:59:59` : undefined
      const res = await api<Record<string, unknown>>(
        `/api/reports${qs({ type, dept: dept === '__all__' ? undefined : dept, from: from || undefined, to: toParam })}`
      )
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load report', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [type, dept, from, to, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const selectReport = (id: ReportId) => {
    setType(id)
    setData(null)
  }

  const exportCsv = () => {
    const rows = buildCsvRows(type, data)
    if (!rows.length) {
      toast({ title: 'Nothing to export', description: 'The report has no rows yet.' })
      return
    }
    const meta = REPORTS.find((r) => r.id === type)
    downloadCSV(`${type}-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast({ title: 'Export ready', description: `${rows.length} row(s) from “${meta?.label}” exported.` })
  }

  const activeReport = REPORTS.find((r) => r.id === type)

  return (
    <div>
      <PageHeader title="Reports & Analytics" subtitle="13 report types across sales, calls, dispatch, campaigns & geography">
        <Button variant="outline" size="sm" className="h-9" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </Button>
        <Button size="sm" className="h-9 bg-amber-500 text-white hover:bg-amber-600" onClick={exportCsv} disabled={loading}>
          <Download className="mr-1 h-4 w-4" aria-hidden /> Export CSV
        </Button>
      </PageHeader>

      {/* common filters */}
      <div className="mb-4 flex flex-wrap items-end gap-2" role="search">
        {canPickDept ? (
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="h-9 w-full bg-white sm:w-44" aria-label="Department">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All departments</SelectItem>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600">
            {DEPT_LABELS[user?.department ?? ''] ?? user?.department}
          </span>
        )}
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full bg-white sm:w-40" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full bg-white sm:w-40" aria-label="To date" />
        <span className="text-[11px] text-stone-400">Date range applies where relevant</span>
      </div>

      {/* mobile chip strip */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden" role="tablist" aria-label="Reports">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={type === r.id}
            onClick={() => selectReport(r.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              type === r.id ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400'
            )}
          >
            <r.icon className="h-3.5 w-3.5" aria-hidden />
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* desktop report nav */}
        <nav className="hidden rounded-xl border border-stone-200 bg-white p-2 shadow-sm lg:block" aria-label="Reports">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => selectReport(r.id)}
              aria-pressed={type === r.id}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors',
                type === r.id ? 'bg-emerald-50' : 'hover:bg-stone-50'
              )}
            >
              <r.icon className={cn('mt-0.5 h-4 w-4 shrink-0', type === r.id ? 'text-emerald-600' : 'text-stone-400')} aria-hidden />
              <span className="min-w-0">
                <span className={cn('block truncate text-sm', type === r.id ? 'font-medium text-emerald-700' : 'text-stone-700')}>{r.label}</span>
                <span className="block truncate text-[11px] text-stone-400">{r.desc}</span>
              </span>
            </button>
          ))}
        </nav>

        {/* report content */}
        <section className="min-w-0 space-y-4">
          {loading && !data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={`sk-kpi-${i}`} className="h-24 animate-pulse rounded-xl border border-stone-200 bg-white" />
                ))}
              </div>
              <div className="h-80 animate-pulse rounded-xl border border-stone-200 bg-white" />
            </div>
          ) : (
            <ReportContent type={type} data={data} loading={loading} dept={dept === '__all__' ? '' : dept} />
          )}
          {!loading && activeReport ? (
            <p className="text-xs text-stone-400">
              {activeReport.label} — {activeReport.desc}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}

// ---------- per-report renderers ----------

function ReportContent({ type, data, loading, dept }: { type: ReportId; data: Record<string, unknown> | null; loading: boolean; dept: string }) {
  switch (type) {
    case 'lead-conversion':
      return <LeadConversionSection data={data as LeadConversionResp | null} loading={loading} dept={dept} />
    case 'executive-performance':
      return <ExecPerformanceSection data={data as ExecPerformanceResp | null} loading={loading} dept={dept} />
    case 'revenue':
      return <RevenueSection data={data as RevenueResp | null} loading={loading} dept={dept} />
    case 'geo':
      return <GeoSection data={data as GeoResp | null} loading={loading} dept={dept} />
    case 'source-wise':
      return <SourceSection data={data as SourceResp | null} loading={loading} dept={dept} />
    case 'dispatch':
      return <DispatchSection data={data as DispatchResp | null} loading={loading} dept={dept} />
    case 'outstanding':
      return <OutstandingSection data={data as OutstandingResp | null} loading={loading} dept={dept} />
    case 'collection':
      return <CollectionSection data={data as CollectionResp | null} loading={loading} dept={dept} />
    case 'new-vs-repeat':
      return <NewVsRepeatSection data={data as NewVsRepeatResp | null} loading={loading} dept={dept} />
    case 'call-quality':
      return <CallQualitySection data={data as CallQualityResp | null} loading={loading} dept={dept} />
    case 'followup-compliance':
      return <FollowupComplianceSection data={data as FollowupResp | null} loading={loading} dept={dept} />
    case 'campaign-roi':
      return <CampaignRoiSection data={data as CampaignRoiResp | null} loading={loading} dept={dept} />
    case 'sticky-performance':
      return <StickySection data={data as StickyResp | null} loading={loading} dept={dept} />
  }
}

function LeadConversionSection({ data, loading, dept }: { data: LeadConversionResp | null; loading: boolean; dept: string }) {
  const s = data?.summary
  const funnel = data?.funnel ?? []
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Leads" value={(s?.total ?? 0).toLocaleString('en-IN')} sub={dept ? `${DEPT_LABELS[dept] ?? dept} scope` : 'All departments'} icon={<Filter className="h-5 w-5" aria-hidden />} />
        <KpiCard label="Converted" value={(s?.converted ?? 0).toLocaleString('en-IN')} tone="positive" icon={<IndianRupee className="h-5 w-5" aria-hidden />} />
        <KpiCard label="Lost" value={(s?.lost ?? 0).toLocaleString('en-IN')} tone="negative" />
        <KpiCard label="Conversion %" value={`${s?.conversionPct ?? 0}%`} progress={s?.conversionPct ?? 0} tone="positive" />
      </div>
      <SectionCard title="Pipeline Funnel" subtitle="Leads currently sitting at each pipeline stage">
        {funnel.length === 0 && !loading ? (
          <EmptyRows label="No funnel data for this range" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e5e4" />
              <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
              <YAxis type="category" dataKey="stage" width={140} tick={AXIS_TICK} />
              <Tooltip />
              <Bar dataKey="count" name="Leads" fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]} barSize={18} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </SectionCard>
    </>
  )
}

function ExecPerformanceSection({ data, loading, dept }: { data: ExecPerformanceResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ userId: string; name: string; team: string; leadsAssigned: number; calls: number; connected: number; followupsDone: number; conversions: number; salesAmount: number; target: number; achievementPct: number }>[]>(
    () => [
      {
        key: 'name',
        header: 'Executive',
        render: (r) => (
          <div className="flex items-center gap-2">
            <UserAvatar name={r.name} className="h-7 w-7 text-[10px]" />
            <span className="text-sm font-medium text-stone-900">{r.name}</span>
          </div>
        ),
      },
      { key: 'team', header: 'Team', render: (r) => <span className="text-sm text-stone-600">{r.team || '—'}</span> },
      { key: 'leadsAssigned', header: 'Leads', className: 'text-center', render: (r) => r.leadsAssigned },
      { key: 'calls', header: 'Calls', className: 'text-center', render: (r) => r.calls },
      { key: 'connected', header: 'Connected', className: 'text-center', render: (r) => r.connected },
      { key: 'followupsDone', header: 'Follow-ups', className: 'text-center', render: (r) => r.followupsDone },
      { key: 'conversions', header: 'Conversions', className: 'text-center', render: (r) => r.conversions },
      { key: 'salesAmount', header: 'Sales', render: (r) => <span className="font-medium text-stone-800">{formatINR(r.salesAmount)}</span> },
      { key: 'target', header: 'Target', render: (r) => formatINR(r.target) },
      { key: 'achievementPct', header: 'Achievement', render: (r) => <MiniBar pct={r.achievementPct} /> },
    ],
    []
  )
  return (
    <SectionCard title="Executive Performance" subtitle={`Per-executive scorecard${dept ? ` — ${DEPT_LABELS[dept] ?? dept}` : ''}`}>
      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No executives in scope" maxH="max-h-[560px]" />
    </SectionCard>
  )
}

function RevenueSection({ data, loading, dept }: { data: RevenueResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ month: string; orders: number; revenue: number }>[]>(
    () => [
      { key: 'month', header: 'Month', render: (r) => <span className="font-medium text-stone-800">{monthLabel(r.month)}</span> },
      { key: 'orders', header: 'Orders', className: 'text-center', render: (r) => r.orders },
      { key: 'revenue', header: 'Revenue', render: (r) => <span className="font-medium text-stone-800">{formatINR(r.revenue)}</span> },
    ],
    []
  )
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Revenue" value={formatINR(data?.totalRevenue ?? 0)} sub={`${rows.length} month(s)`} tone="positive" icon={<IndianRupee className="h-5 w-5" aria-hidden />} />
      </div>
      <SectionCard title="Revenue by Month" subtitle="Payments received + orders created, grouped by month">
        {rows.length === 0 && !loading ? (
          <EmptyRows label="No revenue in this range" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={rows} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                <XAxis dataKey="month" tick={AXIS_TICK} tickFormatter={(m) => monthLabel(String(m))} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => formatINR(Number(v), true)} width={64} />
                <Tooltip formatter={(value) => formatINR(Number(value))} labelFormatter={(m) => monthLabel(String(m))} />
                <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4">
              <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No rows" />
            </div>
          </>
        )}
      </SectionCard>
    </>
  )
}

function GeoSection({ data, loading, dept }: { data: GeoResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const top10 = rows.slice(0, 10)
  const columns = useMemo<Column<{ name: string; leads: number; converted: number; lost: number; pending: number; revenue: number; conversionPct: number }>[]>(
    () => [
      { key: 'name', header: 'Location', render: (r) => <span className="font-medium text-stone-900">{r.name}</span> },
      { key: 'leads', header: 'Leads', className: 'text-center', render: (r) => r.leads },
      { key: 'converted', header: 'Converted', className: 'text-center', render: (r) => <span className="text-emerald-700">{r.converted}</span> },
      { key: 'lost', header: 'Lost', className: 'text-center', render: (r) => <span className="text-rose-600">{r.lost}</span> },
      { key: 'pending', header: 'Pending', className: 'text-center', render: (r) => r.pending },
      { key: 'revenue', header: 'Revenue', render: (r) => formatINR(r.revenue) },
      { key: 'conversionPct', header: 'Conversion', render: (r) => <MiniBar pct={r.conversionPct} /> },
    ],
    []
  )
  return (
    <>
      <SectionCard title="Geo Performance" subtitle={dept === 'ONLINE' ? 'State-wise (Online)' : dept === 'EXPORT' ? 'Country-wise (Export)' : 'State & country-wise — filter by department for exact split'}>
        <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No geo data" maxH="max-h-[420px]" />
      </SectionCard>
      {top10.length ? (
        <SectionCard title="Top 10 Locations by Leads">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={top10} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e5e4" />
              <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} tick={AXIS_TICK} />
              <Tooltip />
              <Bar dataKey="leads" name="Leads" fill={CHART_COLORS[1]} radius={[0, 6, 6, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      ) : null}
    </>
  )
}

function SourceSection({ data, loading, dept }: { data: SourceResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ name: string; leads: number; converted: number; conversionPct: number; revenue: number }>[]>(
    () => [
      { key: 'name', header: 'Source', render: (r) => <span className="font-medium text-stone-900">{r.name}</span> },
      { key: 'leads', header: 'Leads', className: 'text-center', render: (r) => r.leads },
      { key: 'converted', header: 'Converted', className: 'text-center', render: (r) => <span className="text-emerald-700">{r.converted}</span> },
      { key: 'conversionPct', header: 'Conversion', render: (r) => <MiniBar pct={r.conversionPct} /> },
      { key: 'revenue', header: 'Revenue', render: (r) => formatINR(r.revenue) },
    ],
    []
  )
  return (
    <>
      <SectionCard title="Source-wise Performance" subtitle="Which lead sources bring volume and revenue">
        <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No source data" maxH="max-h-[420px]" />
      </SectionCard>
      {rows.length ? (
        <SectionCard title="Leads by Source">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rows.slice(0, 10)} margin={{ left: 8, right: 16, top: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
              <XAxis dataKey="name" tick={AXIS_TICK} interval={0} angle={-24} textAnchor="end" height={56} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} width={40} />
              <Tooltip />
              <Bar dataKey="leads" name="Leads" fill={CHART_COLORS[2]} radius={[6, 6, 0, 0]} />
              <Bar dataKey="converted" name="Converted" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      ) : null}
    </>
  )
}

function DispatchSection({ data, loading, dept }: { data: DispatchResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const aging = data?.aging ?? []
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((r, i) => (
          <div key={r.stage} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-stone-500">{SHIPMENT_STAGE_LABELS[r.stage] ?? r.stage}</p>
            <p className="mt-1 text-xl font-bold text-stone-900 md:text-2xl">{r.count}</p>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-stone-100" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, (r.count / Math.max(1, Math.max(...rows.map((x) => x.count)))) * 100))}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
            </div>
          </div>
        ))}
      </div>
      <SectionCard title="Dispatch Aging" subtitle="Open shipments (not yet delivered) by days since creation">
        {aging.length === 0 && !loading ? (
          <EmptyRows label="No shipment data" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={aging} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
              <XAxis dataKey="bucket" tick={AXIS_TICK} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} width={40} />
              <Tooltip />
              <Bar dataKey="count" name="Shipments" radius={[6, 6, 0, 0]}>
                {aging.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="mt-2 text-xs text-stone-400">{dept ? `${DEPT_LABELS[dept] ?? dept} scope` : 'All departments'}</p>
      </SectionCard>
    </>
  )
}

function OutstandingSection({ data, loading, dept }: { data: OutstandingResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ invoiceNo: string; orderNo: string; leadCode: string; customer: string; amount: number; paidAmount: number; dueDate: string | null; daysOverdue: number; status: string }>[]>(
    () => [
      { key: 'invoiceNo', header: 'Invoice', render: (r) => <span className="font-mono text-xs font-medium text-stone-800">{r.invoiceNo}</span> },
      { key: 'orderNo', header: 'Order', render: (r) => <span className="font-mono text-xs text-stone-600">{r.orderNo}</span> },
      { key: 'customer', header: 'Customer', render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-900">{r.customer}</p>
          <p className="text-xs text-stone-400">{r.leadCode}</p>
        </div>
      ) },
      { key: 'amount', header: 'Invoice Amt', render: (r) => formatINR(r.amount) },
      { key: 'paidAmount', header: 'Paid', render: (r) => <span className="text-emerald-700">{formatINR(r.paidAmount)}</span> },
      { key: 'balance', header: 'Balance', render: (r) => <span className="font-semibold text-stone-900">{formatINR(r.amount - r.paidAmount)}</span> },
      { key: 'dueDate', header: 'Due Date', render: (r) => <span className="whitespace-nowrap text-sm text-stone-600">{formatDate(r.dueDate)}</span> },
      { key: 'daysOverdue', header: 'Overdue', className: 'text-center', render: (r) => (
        <span className={cn('text-sm font-medium', r.daysOverdue > 0 ? 'text-rose-600' : 'text-stone-400')}>
          {r.daysOverdue > 0 ? `${r.daysOverdue}d` : '—'}
        </span>
      ) },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} variant="payment" /> },
    ],
    []
  )
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Outstanding" value={formatINR(data?.totals?.outstanding ?? 0)} sub={`${rows.length} unpaid invoice(s)`} icon={<Wallet className="h-5 w-5" aria-hidden />} />
        <KpiCard label="Overdue Amount" value={formatINR(data?.totals?.overdue ?? 0)} tone="negative" sub="Past due date" />
      </div>
      <SectionCard title="Outstanding Invoices" subtitle={dept ? `${DEPT_LABELS[dept] ?? dept} — sorted by most overdue` : 'All departments — sorted by most overdue'}>
        <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No outstanding invoices — sab clear hai 🎉" maxH="max-h-[520px]" />
      </SectionCard>
    </>
  )
}

function CollectionSection({ data, loading, dept }: { data: CollectionResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ month: string; amount: number; count: number }>[]>(
    () => [
      { key: 'month', header: 'Month', render: (r) => <span className="font-medium text-stone-800">{monthLabel(r.month)}</span> },
      { key: 'count', header: 'Payments', className: 'text-center', render: (r) => r.count },
      { key: 'amount', header: 'Collected', render: (r) => <span className="font-medium text-stone-800">{formatINR(r.amount)}</span> },
    ],
    []
  )
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Collected" value={formatINR(data?.total ?? 0)} sub={`${rows.length} month(s)`} tone="positive" icon={<Banknote className="h-5 w-5" aria-hidden />} />
      </div>
      <SectionCard title="Monthly Collections" subtitle={dept ? `${DEPT_LABELS[dept] ?? dept} — payments received per month` : 'Payments received per month'}>
        {rows.length === 0 && !loading ? (
          <EmptyRows label="No collections in this range" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={rows} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
                <XAxis dataKey="month" tick={AXIS_TICK} tickFormatter={(m) => monthLabel(String(m))} />
                <YAxis tick={AXIS_TICK} tickFormatter={(v) => formatINR(Number(v), true)} width={64} />
                <Tooltip formatter={(value) => formatINR(Number(value))} labelFormatter={(m) => monthLabel(String(m))} />
                <Bar dataKey="amount" name="Collected" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4">
              <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No rows" />
            </div>
          </>
        )}
      </SectionCard>
    </>
  )
}

function NewVsRepeatSection({ data, loading, dept }: { data: NewVsRepeatResp | null; loading: boolean; dept: string }) {
  const d = data
  const pieData = [
    { name: 'New Customers', value: d?.newRevenue ?? 0 },
    { name: 'Repeat Customers', value: d?.repeatRevenue ?? 0 },
  ]
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">New Customers</p>
          <p className="mt-1 text-2xl font-bold text-stone-900">{(d?.newCount ?? 0).toLocaleString('en-IN')} <span className="text-sm font-normal text-stone-400">orders</span></p>
          <p className="mt-1 text-lg font-semibold text-emerald-700">{formatINR(d?.newRevenue ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Repeat Customers</p>
          <p className="mt-1 text-2xl font-bold text-stone-900">{(d?.repeatCount ?? 0).toLocaleString('en-IN')} <span className="text-sm font-normal text-stone-400">orders</span></p>
          <p className="mt-1 text-lg font-semibold text-amber-700">{formatINR(d?.repeatRevenue ?? 0)}</p>
        </div>
      </div>
      <SectionCard title="Revenue Split — New vs Repeat" subtitle={dept ? `${DEPT_LABELS[dept] ?? dept} — order value by customer type` : 'Order value by customer type'}>
        {loading ? (
          <div className="h-72 animate-pulse rounded-lg bg-stone-100" />
        ) : (d?.newCount ?? 0) + (d?.repeatCount ?? 0) === 0 ? (
          <EmptyRows label="No orders in this range" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2} strokeWidth={1}>
                <Cell fill={CHART_COLORS[0]} />
                <Cell fill={CHART_COLORS[1]} />
              </Pie>
              <Tooltip formatter={(value) => formatINR(Number(value))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </SectionCard>
    </>
  )
}

function CallQualitySection({ data, loading, dept }: { data: CallQualityResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ name: string; callsMade: number; connected: number; notConnected: number; missed: number; avgTalkTimeSec: number; conversionRatio: number }>[]>(
    () => [
      { key: 'name', header: 'Executive', render: (r) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={r.name} className="h-7 w-7 text-[10px]" />
          <span className="text-sm font-medium text-stone-900">{r.name}</span>
        </div>
      ) },
      { key: 'callsMade', header: 'Calls Made', className: 'text-center', render: (r) => r.callsMade },
      { key: 'connected', header: 'Connected', className: 'text-center', render: (r) => <span className="text-emerald-700">{r.connected}</span> },
      { key: 'notConnected', header: 'Not Connected', className: 'text-center', render: (r) => r.notConnected },
      { key: 'missed', header: 'Missed', className: 'text-center', render: (r) => <span className="text-rose-600">{r.missed}</span> },
      { key: 'avgTalkTimeSec', header: 'Avg Talk Time', render: (r) => <span className="whitespace-nowrap text-sm text-stone-700">{formatDuration(r.avgTalkTimeSec)}</span> },
      { key: 'conversionRatio', header: 'Conversion', render: (r) => <MiniBar pct={r.conversionRatio} /> },
    ],
    []
  )
  return (
    <SectionCard title="Call Quality" subtitle={dept ? `${DEPT_LABELS[dept] ?? dept} — connect rates & talk time per executive` : 'Connect rates & talk time per executive'}>
      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No call data" maxH="max-h-[520px]" />
    </SectionCard>
  )
}

function FollowupComplianceSection({ data, loading, dept }: { data: FollowupResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ name: string; pending: number; overdue: number; completed: number; compliancePct: number }>[]>(
    () => [
      { key: 'name', header: 'Executive', render: (r) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={r.name} className="h-7 w-7 text-[10px]" />
          <span className="text-sm font-medium text-stone-900">{r.name}</span>
        </div>
      ) },
      { key: 'pending', header: 'Pending', className: 'text-center', render: (r) => <span className="text-amber-700">{r.pending}</span> },
      { key: 'overdue', header: 'Overdue', className: 'text-center', render: (r) => <span className={cn('font-medium', r.overdue > 0 ? 'text-rose-600' : 'text-stone-400')}>{r.overdue}</span> },
      { key: 'completed', header: 'Completed', className: 'text-center', render: (r) => <span className="text-emerald-700">{r.completed}</span> },
      { key: 'compliancePct', header: 'Compliance', render: (r) => <MiniBar pct={r.compliancePct} /> },
    ],
    []
  )
  return (
    <SectionCard title="Follow-up Compliance" subtitle={dept ? `${DEPT_LABELS[dept] ?? dept} — completed vs pending follow-ups` : 'Completed vs pending follow-ups'}>
      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No follow-up data" maxH="max-h-[520px]" />
    </SectionCard>
  )
}

function CampaignRoiSection({ data, loading, dept }: { data: CampaignRoiResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ id: string; name: string; type: string; leads: number; messages: number; conversions: number; revenue: number; budget: number | null; roiPct: number }>[]>(
    () => [
      { key: 'name', header: 'Campaign', render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-900">{r.name}</p>
          <p className="text-xs text-stone-400">{r.type}</p>
        </div>
      ) },
      { key: 'leads', header: 'Leads', className: 'text-center', render: (r) => r.leads },
      { key: 'messages', header: 'Messages', className: 'text-center', render: (r) => r.messages },
      { key: 'conversions', header: 'Conversions', className: 'text-center', render: (r) => r.conversions },
      { key: 'revenue', header: 'Revenue', render: (r) => formatINR(r.revenue) },
      { key: 'budget', header: 'Budget', render: (r) => (r.budget ? formatINR(r.budget) : '—') },
      { key: 'roiPct', header: 'ROI', render: (r) => (
        <span className={cn('text-sm font-semibold', r.roiPct > 0 ? 'text-emerald-700' : r.roiPct < 0 ? 'text-rose-600' : 'text-stone-500')}>
          {r.budget ? `${r.roiPct}%` : '—'}
        </span>
      ) },
    ],
    []
  )
  return (
    <SectionCard title="Campaign ROI" subtitle={dept ? `${DEPT_LABELS[dept] ?? dept} — revenue generated vs campaign budget` : 'Revenue generated vs campaign budget'}>
      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No campaigns in this scope" maxH="max-h-[520px]" />
    </SectionCard>
  )
}

function StickySection({ data, loading, dept }: { data: StickyResp | null; loading: boolean; dept: string }) {
  const rows = data?.rows ?? []
  const columns = useMemo<Column<{ name: string; stickyLeads: number; convertedFromSticky: number; salesFromSticky: number }>[]>(
    () => [
      { key: 'name', header: 'Executive', render: (r) => (
        <div className="flex items-center gap-2">
          <UserAvatar name={r.name} className="h-7 w-7 text-[10px]" />
          <span className="text-sm font-medium text-stone-900">{r.name}</span>
        </div>
      ) },
      { key: 'stickyLeads', header: 'Sticky Leads', className: 'text-center', render: (r) => r.stickyLeads },
      { key: 'convertedFromSticky', header: 'Converted', className: 'text-center', render: (r) => <span className="text-emerald-700">{r.convertedFromSticky}</span> },
      { key: 'salesFromSticky', header: 'Sticky Sales', render: (r) => <span className="font-medium text-stone-800">{formatINR(r.salesFromSticky)}</span> },
    ],
    []
  )
  return (
    <SectionCard title="Sticky Performance" subtitle={dept ? `${DEPT_LABELS[dept] ?? dept} — results from sticky-owned leads` : 'Results from sticky-owned leads (first-contact ownership)'}>
      <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No sticky data" maxH="max-h-[520px]" />
    </SectionCard>
  )
}

// ---------- CSV ----------

function buildCsvRows(type: ReportId, data: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!data) return []
  switch (type) {
    case 'lead-conversion':
      return (data as LeadConversionResp).funnel.map((f) => ({ Stage: f.stage, Leads: f.count }))
    case 'executive-performance':
      return (data as ExecPerformanceResp).rows.map((r) => ({
        Name: r.name, Team: r.team, 'Leads Assigned': r.leadsAssigned, Calls: r.calls, Connected: r.connected,
        'Follow-ups Done': r.followupsDone, Conversions: r.conversions, 'Sales (INR)': r.salesAmount, 'Target (INR)': r.target, 'Achievement %': r.achievementPct,
      }))
    case 'revenue':
      return (data as RevenueResp).rows.map((r) => ({ Month: monthLabel(r.month), Orders: r.orders, 'Revenue (INR)': r.revenue }))
    case 'geo':
      return (data as GeoResp).rows.map((r) => ({
        Location: r.name, Leads: r.leads, Converted: r.converted, Lost: r.lost, Pending: r.pending, 'Revenue (INR)': r.revenue, 'Conversion %': r.conversionPct,
      }))
    case 'source-wise':
      return (data as SourceResp).rows.map((r) => ({
        Source: r.name, Leads: r.leads, Converted: r.converted, 'Conversion %': r.conversionPct, 'Revenue (INR)': r.revenue,
      }))
    case 'dispatch': {
      const d = data as DispatchResp
      return [
        ...d.rows.map((r) => ({ Dataset: 'Stage', Name: SHIPMENT_STAGE_LABELS[r.stage] ?? r.stage, Count: r.count })),
        ...d.aging.map((r) => ({ Dataset: 'Aging', Name: r.bucket, Count: r.count })),
      ]
    }
    case 'outstanding':
      return (data as OutstandingResp).rows.map((r) => ({
        Invoice: r.invoiceNo, Order: r.orderNo, 'Lead Code': r.leadCode, Customer: r.customer, 'Invoice Amount (INR)': r.amount,
        'Paid (INR)': r.paidAmount, 'Balance (INR)': r.amount - r.paidAmount, 'Due Date': formatDate(r.dueDate), 'Days Overdue': r.daysOverdue, Status: r.status,
      }))
    case 'collection':
      return (data as CollectionResp).rows.map((r) => ({ Month: monthLabel(r.month), Payments: r.count, 'Collected (INR)': r.amount }))
    case 'new-vs-repeat': {
      const d = data as NewVsRepeatResp
      return [{ 'New Orders': d.newCount, 'New Revenue (INR)': d.newRevenue, 'Repeat Orders': d.repeatCount, 'Repeat Revenue (INR)': d.repeatRevenue }]
    }
    case 'call-quality':
      return (data as CallQualityResp).rows.map((r) => ({
        Name: r.name, 'Calls Made': r.callsMade, Connected: r.connected, 'Not Connected': r.notConnected, Missed: r.missed,
        'Avg Talk Time (sec)': r.avgTalkTimeSec, 'Conversion %': r.conversionRatio,
      }))
    case 'followup-compliance':
      return (data as FollowupResp).rows.map((r) => ({ Name: r.name, Pending: r.pending, Overdue: r.overdue, Completed: r.completed, 'Compliance %': r.compliancePct }))
    case 'campaign-roi':
      return (data as CampaignRoiResp).rows.map((r) => ({
        Campaign: r.name, Type: r.type, Leads: r.leads, Messages: r.messages, Conversions: r.conversions,
        'Revenue (INR)': r.revenue, 'Budget (INR)': r.budget ?? 0, 'ROI %': r.roiPct,
      }))
    case 'sticky-performance':
      return (data as StickyResp).rows.map((r) => ({ Name: r.name, 'Sticky Leads': r.stickyLeads, 'Converted From Sticky': r.convertedFromSticky, 'Sales From Sticky (INR)': r.salesFromSticky }))
  }
}
