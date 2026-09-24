'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, IndianRupee, KanbanSquare, Loader2, Pin, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { formatDateTime, formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DEPARTMENTS, DEPT_LABELS, LEAD_STATUSES } from '@/lib/constants'
import { PageHeader } from '@/components/crm/shared/page-header'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { masterExtra, useMasters } from '@/components/crm/shared/use-masters'
import { useAppStore } from '@/store/app-store'
import type { MasterItemDTO } from '@/types/crm'

// ---------- types ----------

type LeadRow = {
  id: string
  leadCode: string
  department: string
  customerName: string
  companyName: string | null
  mobile: string
  priority: string | null
  estimatedValue: number | null
  nextFollowUpAt: string | null
  isSticky: boolean
  status: string
  stageId: string | null
  stage: { id: string; label: string; extra: string | null } | null
  assignedTo: { id: string; name: string } | null
}

type LeadsResponse = {
  leads: LeadRow[]
  total: number
  page: number
  pageSize: number
  summary: { total: number; active: number; converted: number; lost: number; sticky: number }
}

type KanbanColumn = {
  id: string
  label: string
  color: string
  leads: LeadRow[]
}

const PAGE_SIZE = 200

// ---------- component ----------

export default function PipelineView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()

  const isAdminLevel = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'

  const [dept, setDept] = useState(user?.department ?? '')
  const [status, setStatus] = useState('ACTIVE')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState<LeadsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [movingId, setMovingId] = useState<string | null>(null)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 400)
    return () => clearTimeout(t)
  }, [qInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<LeadsResponse>(
        `/api/leads${qs({ q: q || undefined, dept: dept || undefined, status: status || undefined, pageSize: PAGE_SIZE })}`
      )
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load pipeline', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [q, dept, status, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // stages ordered by `order` field
  const stages = useMemo<MasterItemDTO[]>(
    () => masters.items('pipeline_stage', dept || user?.department || undefined).sort((a, b) => a.order - b.order),
    [masters, dept, user?.department]
  )

  // Dedupe stages by label (ONLINE + EXPORT share the same stage labels)
  const uniqueStages = useMemo<MasterItemDTO[]>(() => {
    const seen = new Set<string>()
    return stages.filter((s) => {
      const key = s.label.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [stages])

  // Stage options for a specific lead = stages of that lead's department
  const stagesForLead = useCallback(
    (leadDept: string) => {
      const list = masters.items('pipeline_stage', leadDept).sort((a, b) => a.order - b.order)
      return list.length ? list : uniqueStages
    },
    [masters, uniqueStages]
  )

  // group leads into columns client-side (columns are unique stage LABELS)
  const columns = useMemo<KanbanColumn[]>(() => {
    const leads = data?.leads ?? []
    const cols: KanbanColumn[] = uniqueStages.map((s) => ({
      id: s.id,
      label: s.label,
      color: String(masterExtra(s.extra).color ?? ''),
      leads: [],
    }))
    const other: KanbanColumn = { id: '__other', label: 'Other / Unmapped', color: '', leads: [] }
    const byId = new Map(cols.map((c) => [c.id, c]))
    const byLabel = new Map(cols.map((c) => [c.label.trim().toLowerCase(), c]))
    for (const l of leads) {
      const col =
        (l.stageId ? byId.get(l.stageId) : undefined) ??
        byLabel.get((l.stage?.label ?? '').trim().toLowerCase())
      if (col) col.leads.push(l)
      else other.leads.push(l)
    }
    return other.leads.length ? [...cols, other] : cols
  }, [data, uniqueStages])

  const stageLabelOf = useCallback(
    (id: string) => masters.items('pipeline_stage').find((s) => s.id === id)?.label ?? 'stage',
    [masters]
  )

  const openLead = (lead: LeadRow) => setView('lead-detail', { leadId: lead.id })

  const moveLead = async (lead: LeadRow, stageId: string) => {
    if (!stageId || stageId === lead.stageId) return
    const prev = data
    setMovingId(lead.id)
    setData((d) =>
      d
        ? {
            ...d,
            leads: d.leads.map((l) =>
              l.id === lead.id
                ? { ...l, stageId, stage: { id: stageId, label: stageLabelOf(stageId), extra: l.stage?.extra ?? null } }
                : l
            ),
          }
        : d
    )
    try {
      await api('/api/leads', { method: 'PATCH', body: { id: lead.id, stageId } })
      toast({ title: 'Stage updated', description: `${lead.leadCode} moved to ${stageLabelOf(stageId)}` })
    } catch (e) {
      setData(prev)
      toast({ title: 'Could not move lead', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setMovingId(null)
    }
  }

  const isOverdue = (d: string | null) => Boolean(d && new Date(d).getTime() < Date.now())
  const total = data?.total ?? 0

  return (
    <div>
      <PageHeader title="Lead Pipeline" subtitle="Drag-free kanban — move leads across stages with the stage picker">
        <span className="hidden text-xs text-stone-500 md:inline">
          {loading ? 'Loading…' : `${total} lead${total === 1 ? '' : 's'} in view`}
        </span>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh pipeline">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
      </PageHeader>

      <FilterBar>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" aria-hidden />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search name, mobile, code…"
            className="w-56 pl-8"
            aria-label="Search leads"
          />
        </div>
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
        <Select value={status || 'ALL'} onValueChange={(v) => setStatus(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="w-36" aria-label="Status filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {/* kanban */}
      {loading && !data ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-[264px] shrink-0 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
              <Skeleton className="mb-3 h-5 w-28" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-28 w-full rounded-lg" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : columns.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50/60 px-6 py-12 text-center">
          <KanbanSquare className="mb-3 h-6 w-6 text-stone-400" aria-hidden />
          <p className="text-sm font-semibold text-stone-700">No pipeline stages configured</p>
          <p className="mt-1 max-w-sm text-xs text-stone-500">
            Ask your admin to add pipeline stages for this department in Master Data.
          </p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3" role="list" aria-label="Pipeline stages">
          {columns.map((col) => (
            <section
              key={col.id}
              role="listitem"
              aria-label={`${col.label}: ${col.leads.length} leads`}
              className="flex w-[264px] shrink-0 flex-col rounded-xl border border-stone-200 bg-stone-100/60 shadow-sm md:w-[276px]"
            >
              <header className="rounded-t-xl border-b border-stone-200 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-stone-800">{col.label}</h3>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-600">
                    {col.leads.length}
                  </span>
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full" aria-hidden>
                  <div
                    className="h-full rounded-full"
                    style={{ backgroundColor: col.color || '#a8a29e', width: '100%' }}
                  />
                </div>
              </header>
              <div className="max-h-[60vh] min-h-[100px] space-y-2 overflow-y-auto p-2">
                {col.leads.length === 0 ? (
                  <p className="py-6 text-center text-xs text-stone-400">No leads here</p>
                ) : (
                  col.leads.map((l) => {
                    const overdue = isOverdue(l.nextFollowUpAt)
                    return (
                      <div
                        key={l.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openLead(l)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openLead(l)
                          }
                        }}
                        aria-label={`Open lead ${l.customerName}`}
                        className="cursor-pointer rounded-lg border border-stone-200 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-emerald-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-stone-800">{l.customerName}</p>
                            {l.companyName ? (
                              <p className="truncate text-xs text-stone-500">{l.companyName}</p>
                            ) : null}
                          </div>
                          {l.isSticky ? (
                            <Pin className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Sticky lead" />
                          ) : null}
                        </div>

                        <p className="mt-1 truncate font-mono text-xs text-stone-500">
                          {l.leadCode} · {l.mobile}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={l.priority} variant="priority" />
                          <StatusBadge status={l.department} variant="dept" />
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          {l.assignedTo ? (
                            <span className="flex min-w-0 items-center gap-1.5">
                              <UserAvatar name={l.assignedTo.name} className="h-5 w-5" />
                              <span className="truncate text-xs text-stone-600">{l.assignedTo.name}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-stone-400">Unassigned</span>
                          )}
                          {l.estimatedValue ? (
                            <span className="flex items-center gap-0.5 whitespace-nowrap text-xs font-semibold text-emerald-700">
                              <IndianRupee className="h-3 w-3" aria-hidden />
                              {formatINR(l.estimatedValue, true)}
                            </span>
                          ) : null}
                        </div>

                        {l.nextFollowUpAt ? (
                          <p
                            className={cn(
                              'mt-2 flex items-center gap-1 text-xs',
                              overdue ? 'font-semibold text-amber-600' : 'text-stone-500'
                            )}
                          >
                            <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
                            {overdue ? 'Overdue: ' : 'Follow-up: '}
                            {formatDateTime(l.nextFollowUpAt)}
                          </p>
                        ) : null}

                        <div className="mt-2 border-t border-stone-100 pt-2" onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={l.stageId ?? ''}
                            onValueChange={(v) => moveLead(l, v)}
                            disabled={movingId === l.id}
                          >
                            <SelectTrigger
                              className="h-7 w-full text-xs"
                              aria-label={`Change stage for ${l.customerName}`}
                            >
                              {movingId === l.id ? (
                                <span className="flex items-center gap-1 text-stone-500">
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Moving…
                                </span>
                              ) : (
                                <SelectValue placeholder="Move to stage" />
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {stagesForLead(l.department).map((s) => (
                                <SelectItem key={s.id} value={s.id} className="text-xs">
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
