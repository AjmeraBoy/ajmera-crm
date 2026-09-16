'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, IndianRupee, Loader2, Megaphone, Plus, Radio, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CAMPAIGN_CHANNELS, CAMPAIGN_TYPES, DEPARTMENTS, LEAD_STATUSES } from '@/lib/constants'
import { useAppStore } from '@/store/app-store'
import { PageHeader } from '@/components/crm/shared/page-header'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { useMasters } from '@/components/crm/shared/use-masters'

// ---------- types ----------

type MasterOption = { id: string; label: string }

type Campaign = {
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
}

type RoiRow = { id: string; conversions: number; revenue: number; roiPct: number }

const MANAGEMENT_ROLES = ['TEAM_LEADER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']
const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED']

/** Toggle-chip multi select used for audience filters */
function ChipMulti({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: MasterOption[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-stone-200 bg-stone-50 p-2">
        {options.length === 0 ? (
          <span className="text-xs text-stone-400">No options</span>
        ) : (
          options.map((o) => {
            const active = value.includes(o.id)
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(active ? value.filter((v) => v !== o.id) : [...value, o.id])}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-300 hover:text-emerald-700'
                )}
              >
                {o.label}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ---------- component ----------

export default function BroadcastView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()

  const isManagement = MANAGEMENT_ROLES.includes(user?.role ?? '')
  const canPickDept = !user?.department

  // ---------- send broadcast form ----------
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'template' | 'custom'>('template')
  const [templateId, setTemplateId] = useState('')
  const [body, setBody] = useState('')
  const [dept, setDept] = useState(user?.department ?? '')
  const [status, setStatus] = useState('ACTIVE')
  const [stageIds, setStageIds] = useState<string[]>([])
  const [countryIds, setCountryIds] = useState<string[]>([])
  const [stateIds, setStateIds] = useState<string[]>([])
  const [dispositionIds, setDispositionIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  const [templates, setTemplates] = useState<Array<{ id: string; name: string; body: string }>>([])

  // ---------- campaigns ----------
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [roi, setRoi] = useState<RoiRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null)

  // create campaign dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [cName, setCName] = useState('')
  const [cType, setCType] = useState('OUTGOING')
  const [cChannel, setCChannel] = useState('WHATSAPP')
  const [cDept, setCDept] = useState(user?.department ?? 'ONLINE')
  const [cBudget, setCBudget] = useState('')
  const [cStart, setCStart] = useState('')
  const [cEnd, setCEnd] = useState('')
  const [cDesc, setCDesc] = useState('')
  const [creating, setCreating] = useState(false)

  // ---------- derived master options ----------

  const stageOptions = useMemo(() => {
    const seen = new Set<string>()
    return masters
      .items('pipeline_stage', dept || undefined)
      .sort((a, b) => a.order - b.order)
      .filter((m) => {
        const k = m.label.trim().toLowerCase()
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .map((m) => ({ id: m.id, label: m.label }))
  }, [masters, dept])
  const dispositionOptions = useMemo(
    () => masters.items('disposition', dept || undefined).map((m) => ({ id: m.id, label: m.label })),
    [masters, dept]
  )
  const countryOptions = useMemo(() => masters.items('country').map((m) => ({ id: m.id, label: m.label })), [masters])
  const stateOptions = useMemo(() => masters.items('state').map((m) => ({ id: m.id, label: m.label })), [masters])

  // ---------- loaders ----------

  useEffect(() => {
    api<{ templates: Array<{ id: string; name: string; body: string }> }>(`/api/whatsapp/templates${qs({ dept: dept || undefined })}`)
      .then((res) => setTemplates(res.templates ?? []))
      .catch(() => setTemplates([]))
  }, [dept])

  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    try {
      const [campRes, roiRes] = await Promise.all([
        api<{ campaigns: Campaign[] }>(`/api/campaigns${qs({ dept: dept || undefined })}`),
        api<{ rows: RoiRow[] }>(`/api/reports${qs({ type: 'campaign-roi', dept: dept || undefined })}`),
      ])
      setCampaigns(campRes.campaigns ?? [])
      setRoi(roiRes.rows ?? [])
    } catch (e) {
      toast({ title: 'Failed to load campaigns', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [dept, toast])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns, reloadKey])

  const roiById = useMemo(() => new Map(roi.map((r) => [r.id, r])), [roi])

  const totals = useMemo(() => {
    const active = campaigns.filter((c) => c.status === 'ACTIVE').length
    const leadsTouched = campaigns.reduce((s, c) => s + (c.leadsCount ?? 0), 0)
    const revenue = campaigns.reduce((s, c) => s + (roiById.get(c.id)?.revenue ?? 0), 0)
    return { total: campaigns.length, active, leadsTouched, revenue }
  }, [campaigns, roiById])

  const filteredCampaigns = useMemo(
    () => (statusFilter && statusFilter !== 'all' ? campaigns.filter((c) => c.status === statusFilter) : campaigns),
    [campaigns, statusFilter]
  )

  // ---------- actions ----------

  const sendBroadcast = async () => {
    if (!dept) {
      toast({ title: 'Select a department for the broadcast', variant: 'destructive' })
      return
    }
    if (mode === 'template' && !templateId) {
      toast({ title: 'Pick a template or switch to custom message', variant: 'destructive' })
      return
    }
    if (mode === 'custom' && !body.trim()) {
      toast({ title: 'Write a message for the broadcast', variant: 'destructive' })
      return
    }
    setSending(true)
    try {
      const res = await api<{ sent: number; campaignId?: string }>('/api/whatsapp/broadcast', {
        method: 'POST',
        body: {
          name: name.trim() || undefined,
          ...(mode === 'template' ? { templateId } : { body: body.trim() }),
          dept,
          filters: {
            stageIds: stageIds.length ? stageIds : undefined,
            countryIds: countryIds.length ? countryIds : undefined,
            stateIds: stateIds.length ? stateIds : undefined,
            dispositionIds: dispositionIds.length ? dispositionIds : undefined,
            status,
          },
        },
      })
      toast({
        title: 'Broadcast sent',
        description: `${res.sent} WhatsApp message(s) delivered to matching leads${res.campaignId ? ' — campaign created' : ''}`,
      })
      setName('')
      setBody('')
      setTemplateId('')
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Broadcast failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  const updateStatus = useCallback(
    async (c: Campaign, next: string) => {
      if (next === c.status) return
      setStatusUpdating(c.id)
      try {
        await api('/api/campaigns', { method: 'PATCH', body: { id: c.id, status: next } })
        toast({ title: 'Campaign updated', description: `${c.name} → ${next}` })
        setReloadKey((k) => k + 1)
      } catch (e) {
        toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
      } finally {
        setStatusUpdating(null)
      }
    },
    [toast]
  )

  const createCampaign = async () => {
    if (!cName.trim()) {
      toast({ title: 'Campaign name is required', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      await api('/api/campaigns', {
        method: 'POST',
        body: {
          name: cName.trim(),
          type: cType,
          channel: cChannel,
          department: cDept || undefined,
          budget: cBudget ? Number(cBudget) : undefined,
          startDate: cStart || undefined,
          endDate: cEnd || undefined,
          description: cDesc.trim() || undefined,
        },
      })
      toast({ title: 'Campaign created', description: cName.trim() })
      setCreateOpen(false)
      setCName('')
      setCBudget('')
      setCStart('')
      setCEnd('')
      setCDesc('')
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Create failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  // ---------- table ----------

  const columns: Column<Campaign>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Campaign',
        render: (c) => (
          <div className="min-w-[160px]">
            <p className="font-medium text-stone-800">{c.name}</p>
            {c.description ? <p className="max-w-[220px] truncate text-xs text-stone-500">{c.description}</p> : null}
            {c.createdBy ? <p className="text-xs text-stone-400">by {c.createdBy.name}</p> : null}
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (c) => <Badge variant="outline" className="border-stone-200 text-stone-600">{c.type}</Badge>,
      },
      { key: 'channel', header: 'Channel', render: (c) => <span className="text-xs">{c.channel}</span> },
      {
        key: 'department',
        header: 'Dept',
        render: (c) => (c.department ? <StatusBadge status={c.department} variant="dept" /> : <span className="text-stone-400">—</span>),
      },
      { key: 'leadsCount', header: 'Leads', className: 'text-right', render: (c) => <span className="tabular-nums">{c.leadsCount}</span> },
      { key: 'messagesCount', header: 'Msgs', className: 'text-right', render: (c) => <span className="tabular-nums">{c.messagesCount}</span> },
      {
        key: 'conversions',
        header: 'Conv.',
        className: 'text-right',
        render: (c) => <span className="tabular-nums">{roiById.get(c.id)?.conversions ?? 0}</span>,
      },
      {
        key: 'revenue',
        header: 'Revenue',
        className: 'text-right',
        render: (c) => <span className="font-medium tabular-nums text-emerald-700">{formatINR(roiById.get(c.id)?.revenue ?? 0, true)}</span>,
      },
      { key: 'budget', header: 'Budget', className: 'text-right', render: (c) => <span className="tabular-nums">{formatINR(c.budget, true)}</span> },
      {
        key: 'roiPct',
        header: 'ROI',
        className: 'text-right',
        render: (c) => {
          const pct = roiById.get(c.id)?.roiPct ?? 0
          return <span className={cn('font-semibold tabular-nums', pct > 0 ? 'text-emerald-700' : 'text-stone-500')}>{pct}%</span>
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (c) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Select value={c.status} onValueChange={(v) => void updateStatus(c, v)} disabled={statusUpdating === c.id}>
              <SelectTrigger className="h-8 w-[120px] text-xs" aria-label={`Status of ${c.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ),
      },
    ],
    [roiById, statusUpdating, updateStatus]
  )

  // ---------- render ----------

  return (
    <div>
      <PageHeader
        title="Broadcast &amp; Campaigns"
        subtitle="Send targeted WhatsApp broadcasts to filtered audiences and track campaign ROI"
      >
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New Campaign
        </Button>
      </PageHeader>

      {isManagement ? (
        <section className="mb-6 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <Megaphone className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-stone-800">Send Broadcast</h2>
              <p className="text-xs text-stone-500">WhatsApp message to every lead matching the audience filters (max 500)</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="bc-name">Campaign Name (optional — creates a linked campaign)</Label>
                <Input id="bc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Navratri Catalogue Blast" />
              </div>
              <div className="space-y-1.5">
                <Label>Message Source</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === 'template' ? 'default' : 'outline'}
                    className={mode === 'template' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                    onClick={() => setMode('template')}
                  >
                    Template
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={mode === 'custom' ? 'default' : 'outline'}
                    className={mode === 'custom' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                    onClick={() => setMode('custom')}
                  >
                    Custom Message
                  </Button>
                </div>
              </div>
              {mode === 'template' ? (
                <div className="space-y-1.5">
                  <Label>WhatsApp Template *</Label>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger aria-label="Template">
                      <SelectValue placeholder="Select a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-stone-500">No templates for this department</div>
                      ) : (
                        templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {templateId ? (
                    <p className="rounded-lg bg-stone-50 p-2 text-xs text-stone-500">
                      {templates.find((t) => t.id === templateId)?.body}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="bc-body">Custom Message *</Label>
                  <Textarea
                    id="bc-body"
                    rows={4}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Hi {name}, our new festive catalogue is out! Reply to get the full price list."
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Department *</Label>
                  {canPickDept ? (
                    <Select value={dept} onValueChange={setDept}>
                      <SelectTrigger aria-label="Department">
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEPARTMENTS.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={dept} disabled aria-label="Fixed department" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Lead Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger aria-label="Lead status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <ChipMulti label="Pipeline Stage (optional)" options={stageOptions} value={stageIds} onChange={setStageIds} />
              <ChipMulti label="Disposition (optional)" options={dispositionOptions} value={dispositionIds} onChange={setDispositionIds} />
              {dept === 'EXPORT' ? (
                <ChipMulti label="Country (Export audiences)" options={countryOptions} value={countryIds} onChange={setCountryIds} />
              ) : null}
              {dept === 'ONLINE' ? (
                <ChipMulti label="State (Online audiences)" options={stateOptions} value={stateIds} onChange={setStateIds} />
              ) : null}
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={sending}
                onClick={() => void sendBroadcast()}
              >
                {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Megaphone className="mr-1.5 h-4 w-4" />}
                {sending ? 'Sending broadcast...' : 'Send Broadcast'}
              </Button>
              <p className="text-center text-xs text-stone-400">
                Audience = {dept || '—'} leads with status {status}, filtered by the selected chips above.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* Campaign KPIs */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Campaigns"
          value={loading ? <Skeleton className="h-7 w-16" /> : totals.total}
          sub="All campaigns in scope"
          icon={<BarChart3 className="h-4 w-4" />}
          onClick={() => setStatusFilter('')}
        />
        <KpiCard
          label="Active"
          value={loading ? <Skeleton className="h-7 w-16" /> : totals.active}
          sub="Currently running"
          icon={<Radio className="h-4 w-4" />}
          tone="positive"
          onClick={() => setStatusFilter('ACTIVE')}
        />
        <KpiCard
          label="Leads Touched"
          value={loading ? <Skeleton className="h-7 w-16" /> : totals.leadsTouched}
          sub="Leads linked to campaigns"
          icon={<Users className="h-4 w-4" />}
          onClick={() => setView('reports', { type: 'campaign-roi' })}
        />
        <KpiCard
          label="Revenue Attributed"
          value={loading ? <Skeleton className="h-7 w-16" /> : formatINR(totals.revenue, true)}
          sub="Payments on campaign leads"
          icon={<IndianRupee className="h-4 w-4" />}
          tone="positive"
          onClick={() => setView('reports', { type: 'campaign-roi' })}
        />
      </div>

      {/* Campaigns table */}
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-6">
        <FilterBar>
          <h2 className="mr-auto text-sm font-semibold text-stone-800">Campaigns</h2>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {CAMPAIGN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterBar>
        <DataTable
          columns={columns}
          rows={filteredCampaigns}
          loading={loading}
          emptyMessage="No campaigns yet — create one or send your first broadcast"
        />
      </section>

      {/* Create campaign dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
            <DialogDescription>Plan an incoming / outgoing / broadcast campaign and track its ROI.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Campaign Name *</Label>
              <Input id="c-name" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="e.g. Diwali Re-marketing" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={cType} onValueChange={setCType}>
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
                <Select value={cChannel} onValueChange={setCChannel}>
                  <SelectTrigger aria-label="Channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Department</Label>
                {canPickDept ? (
                  <Select value={cDept} onValueChange={setCDept}>
                    <SelectTrigger aria-label="Department">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={user?.department ?? ''} disabled aria-label="Fixed department" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-budget">Budget (₹)</Label>
                <Input id="c-budget" type="number" min={0} value={cBudget} onChange={(e) => setCBudget(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-start">Start Date</Label>
                <Input id="c-start" type="date" value={cStart} onChange={(e) => setCStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-end">End Date</Label>
                <Input id="c-end" type="date" value={cEnd} onChange={(e) => setCEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-desc">Description</Label>
              <Textarea id="c-desc" rows={2} value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="Goal / notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={creating} onClick={() => void createCampaign()}>
              {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
