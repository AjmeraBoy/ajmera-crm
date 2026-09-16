'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Download, Loader2, Megaphone, Plus, RefreshCw, Target, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { formatDate, formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CAMPAIGN_CHANNELS, CAMPAIGN_TYPES, DEPARTMENTS, DEPT_LABELS } from '@/lib/constants'
import { PageHeader } from '@/components/crm/shared/page-header'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { useAppStore } from '@/store/app-store'

// ---------- types ----------

type CampaignRow = {
  id: string
  name: string
  type: string
  channel: string
  department: string | null
  description: string | null
  startDate: string | null
  endDate: string | null
  budget: number
  status: string
  createdAt: string
  createdBy: { id: string; name: string } | null
  leadsCount: number
  messagesCount: number
  conversions?: number | null
  revenue?: number | null
}

type CampaignsResponse = { campaigns: CampaignRow[] }

const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED']
const MANAGEMENT_ROLES = ['TEAM_LEADER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']

function roiPct(c: CampaignRow): string {
  const budget = c.budget ?? 0
  if (budget <= 0) return '—'
  return `${Math.round(((c.revenue ?? 0) / budget) * 100)}%`
}

// ---------- component ----------

export default function CampaignsView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()

  const isAdminLevel = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
  const canManage = MANAGEMENT_ROLES.includes(user?.role ?? '')

  const [status, setStatus] = useState('')
  const [dept, setDept] = useState(user?.department ?? '')
  const [data, setData] = useState<CampaignsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)

  // create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('OUTGOING')
  const [newChannel, setNewChannel] = useState('WHATSAPP')
  const [newDept, setNewDept] = useState(user?.department ?? '')
  const [newBudget, setNewBudget] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  // results dialog
  const [resultsTarget, setResultsTarget] = useState<CampaignRow | null>(null)
  const [rConversions, setRConversions] = useState('')
  const [rRevenue, setRRevenue] = useState('')
  const [savingResults, setSavingResults] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<CampaignsResponse>(`/api/campaigns${qs({ dept: dept || undefined, status: status || undefined })}`)
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load campaigns', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [dept, status, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const campaigns = useMemo(() => data?.campaigns ?? [], [data])
  const kpis = useMemo(() => {
    const active = campaigns.filter((c) => c.status === 'ACTIVE').length
    const leadsTouched = campaigns.reduce((sum, c) => sum + (c.leadsCount ?? 0), 0)
    const revenue = campaigns.reduce((sum, c) => sum + (c.revenue ?? 0), 0)
    return { total: campaigns.length, active, leadsTouched, revenue }
  }, [campaigns])

  const changeStatus = async (c: CampaignRow, next: string) => {
    if (!next || next === c.status) return
    setStatusUpdatingId(c.id)
    try {
      const res = await api<{ campaign: CampaignRow }>('/api/campaigns', { method: 'PATCH', body: { id: c.id, status: next } })
      setData((d) =>
        d ? { ...d, campaigns: d.campaigns.map((row) => (row.id === c.id ? { ...row, status: res.campaign.status } : row)) } : d
      )
      toast({ title: 'Campaign status updated', description: `${c.name} → ${next}` })
    } catch (e) {
      toast({ title: 'Could not update status', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setStatusUpdatingId(null)
    }
  }

  const openCreate = () => {
    setNewName('')
    setNewType('OUTGOING')
    setNewChannel('WHATSAPP')
    setNewDept(user?.department ?? '')
    setNewBudget('')
    setNewStart('')
    setNewEnd('')
    setNewDescription('')
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    if (!newName.trim()) {
      toast({ title: 'Campaign name is required', variant: 'destructive' })
      return
    }
    if (isAdminLevel && !newDept) {
      toast({ title: 'Select a department', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      await api('/api/campaigns', {
        method: 'POST',
        body: {
          name: newName.trim(),
          type: newType,
          channel: newChannel,
          department: newDept || undefined,
          budget: newBudget ? Number(newBudget) : undefined,
          startDate: newStart || undefined,
          endDate: newEnd || undefined,
          description: newDescription.trim() || undefined,
        },
      })
      toast({ title: 'Campaign created', description: `${newName.trim()} is live in the campaign list` })
      setCreateOpen(false)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Could not create campaign', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const openResults = (c: CampaignRow) => {
    setResultsTarget(c)
    setRConversions(c.conversions != null ? String(c.conversions) : '')
    setRRevenue(c.revenue != null ? String(c.revenue) : '')
  }

  const submitResults = async () => {
    if (!resultsTarget) return
    setSavingResults(true)
    try {
      await api('/api/campaigns', {
        method: 'PATCH',
        body: {
          id: resultsTarget.id,
          conversions: rConversions === '' ? undefined : Number(rConversions),
          revenue: rRevenue === '' ? undefined : Number(rRevenue),
        },
      })
      const conversions = rConversions === '' ? resultsTarget.conversions ?? null : Number(rConversions)
      const revenue = rRevenue === '' ? resultsTarget.revenue ?? null : Number(rRevenue)
      setData((d) =>
        d ? { ...d, campaigns: d.campaigns.map((row) => (row.id === resultsTarget.id ? { ...row, conversions, revenue } : row)) } : d
      )
      toast({ title: 'Results updated', description: `${resultsTarget.name} results saved` })
      setResultsTarget(null)
    } catch (e) {
      toast({ title: 'Could not update results', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingResults(false)
    }
  }

  const exportCsv = () => {
    const rows = campaigns.map((c) => ({
      name: c.name,
      type: c.type,
      channel: c.channel,
      department: c.department ?? '',
      budget: c.budget,
      revenue: c.revenue ?? 0,
      roiPct: roiPct(c),
      leadsCount: c.leadsCount,
      messagesCount: c.messagesCount,
      conversions: c.conversions ?? 0,
      status: c.status,
      startDate: c.startDate ? formatDate(c.startDate) : '',
      endDate: c.endDate ? formatDate(c.endDate) : '',
      createdBy: c.createdBy?.name ?? '',
    }))
    downloadCSV(`campaigns-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast({ title: 'Export ready', description: `${rows.length} campaign(s) exported to CSV` })
  }

  const columns: Column<CampaignRow>[] = [
    {
      key: 'name',
      header: 'Campaign',
      className: 'min-w-[180px] max-w-[240px]',
      render: (c) => (
        <div>
          <p className="truncate font-medium text-stone-800" title={c.name}>
            {c.name}
          </p>
          {c.description ? (
            <p className="truncate text-xs text-stone-500" title={c.description}>
              {c.description}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type / Channel',
      render: (c) => (
        <div className="whitespace-nowrap">
          <StatusBadge status={c.type} />
          <span className="ml-1.5 text-xs text-stone-500">{c.channel}</span>
        </div>
      ),
    },
    {
      key: 'department',
      header: 'Dept',
      render: (c) => (c.department ? <StatusBadge status={c.department} variant="dept" /> : <span className="text-stone-400">—</span>),
    },
    {
      key: 'budget',
      header: 'Budget',
      className: 'text-right',
      render: (c) => <span className="whitespace-nowrap font-medium">{c.budget ? formatINR(c.budget) : '—'}</span>,
    },
    {
      key: 'revenue',
      header: 'Revenue',
      className: 'text-right',
      render: (c) => (
        <span className="whitespace-nowrap font-medium text-emerald-700">{c.revenue ? formatINR(c.revenue) : '—'}</span>
      ),
    },
    {
      key: 'roi',
      header: 'ROI',
      className: 'text-right',
      render: (c) => (
        <span className={cn('whitespace-nowrap text-xs font-semibold', c.budget > 0 ? 'text-emerald-700' : 'text-stone-400')}>
          {roiPct(c)}
        </span>
      ),
    },
    {
      key: 'leadsCount',
      header: 'Leads',
      className: 'text-right',
      render: (c) => (
        <button
          type="button"
          className="text-xs font-semibold text-stone-700 hover:text-emerald-700 hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            setView('leads', { campaignId: c.id })
          }}
          aria-label={`View leads of ${c.name}`}
        >
          {c.leadsCount}
        </button>
      ),
    },
    { key: 'messagesCount', header: 'Msgs', className: 'text-right', render: (c) => <span className="text-xs">{c.messagesCount}</span> },
    {
      key: 'conversions',
      header: 'Conv.',
      className: 'text-right',
      render: (c) => <span className="text-xs font-semibold">{c.conversions ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) =>
        canManage ? (
          <Select value={c.status} onValueChange={(v) => changeStatus(c, v)} disabled={statusUpdatingId === c.id}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label={`Status of ${c.name}`}>
              {statusUpdatingId === c.id ? (
                <span className="flex items-center gap-1 text-stone-500">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…
                </span>
              ) : (
                <SelectValue />
              )}
            </SelectTrigger>
            <SelectContent>
              {CAMPAIGN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <StatusBadge status={c.status} />
        ),
    },
    {
      key: 'dates',
      header: 'Duration',
      render: (c) => (
        <span className="whitespace-nowrap text-xs text-stone-500">
          {c.startDate ? formatDate(c.startDate) : '—'} → {c.endDate ? formatDate(c.endDate) : '—'}
        </span>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Campaign Management" subtitle="Incoming / outgoing campaigns and WhatsApp broadcasts with ROI tracking">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh campaigns">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} aria-label="Export campaigns as CSV">
          <Download className="h-4 w-4" aria-hidden />
          <span className="ml-1">Export CSV</span>
        </Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="ml-1">New Campaign</span>
        </Button>
      </PageHeader>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Campaigns" value={kpis.total} icon={<Megaphone className="h-5 w-5" aria-hidden />} onClick={() => { setStatus(''); setReloadKey((k) => k + 1) }} />
        <KpiCard label="Active" value={kpis.active} tone="positive" icon={<Activity className="h-5 w-5" aria-hidden />} onClick={() => setStatus('ACTIVE')} />
        <KpiCard label="Leads Touched" value={kpis.leadsTouched} icon={<Target className="h-5 w-5" aria-hidden />} onClick={() => setView('leads', {})} />
        <KpiCard label="Revenue Attributed" value={formatINR(kpis.revenue, true)} icon={<Wallet className="h-5 w-5" aria-hidden />} onClick={() => setView('payments', {})} />
      </div>

      <FilterBar>
        <Select value={status || 'ALL'} onValueChange={(v) => setStatus(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="w-40" aria-label="Campaign status filter">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {CAMPAIGN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdminLevel ? (
          <Select value={dept || 'ALL'} onValueChange={(v) => setDept(v === 'ALL' ? '' : v)}>
            <SelectTrigger className="w-44" aria-label="Department filter">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Departments</SelectItem>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {DEPT_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={campaigns}
        loading={loading}
        emptyMessage="No campaigns yet — create your first campaign"
        onRowClick={(c) => (canManage ? openResults(c) : undefined)}
      />
      {canManage ? (
        <p className="mt-2 text-xs text-stone-400">Tip: click a row to update conversions &amp; revenue. Change status inline from the Status dropdown.</p>
      ) : null}

      {/* create campaign dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Campaign</DialogTitle>
            <DialogDescription>Track inbound enquiries, outbound calling drives or WhatsApp broadcasts here.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="camp-name">Name</Label>
              <Input id="camp-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Diwali Saree Blast — Oct" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger aria-label="Campaign type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Channel</Label>
                <Select value={newChannel} onValueChange={setNewChannel}>
                  <SelectTrigger aria-label="Campaign channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_CHANNELS.map((ch) => (
                      <SelectItem key={ch} value={ch}>
                        {ch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {isAdminLevel ? (
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={newDept || 'NONE'} onValueChange={(v) => setNewDept(v === 'NONE' ? '' : v)}>
                  <SelectTrigger aria-label="Campaign department">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No department (shared)</SelectItem>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {DEPT_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="camp-budget">Budget (₹)</Label>
                <Input id="camp-budget" type="number" min={0} value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="50000" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-start">Start date</Label>
                <Input id="camp-start" type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="camp-end">End date</Label>
                <Input id="camp-end" type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp-desc">Description</Label>
              <Textarea id="camp-desc" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={2} placeholder="Goal, audience, offer details…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* results dialog */}
      <Dialog open={!!resultsTarget} onOpenChange={(open) => !open && setResultsTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Campaign Results</DialogTitle>
            <DialogDescription>{resultsTarget?.name}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="r-conversions">Conversions</Label>
              <Input id="r-conversions" type="number" min={0} value={rConversions} onChange={(e) => setRConversions(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-revenue">Revenue (₹)</Label>
              <Input id="r-revenue" type="number" min={0} value={rRevenue} onChange={(e) => setRRevenue(e.target.value)} placeholder="0" />
            </div>
          </div>
          {resultsTarget ? (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
              Budget {formatINR(resultsTarget.budget)} · Leads {resultsTarget.leadsCount} · Messages {resultsTarget.messagesCount}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResultsTarget(null)} disabled={savingResults}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitResults} disabled={savingResults}>
              {savingResults ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save Results
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
