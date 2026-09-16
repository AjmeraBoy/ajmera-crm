'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CalendarClock,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  Download,
  History,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { formatDateTime, toInputDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DEPARTMENTS, DEPT_LABELS } from '@/lib/constants'
import { PageHeader } from '@/components/crm/shared/page-header'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { useAppStore } from '@/store/app-store'

// ---------- types ----------

type FollowupRow = {
  id: string
  lead: {
    id: string
    leadCode: string
    customerName: string
    mobile: string
    department: string
    stage: { id: string; label: string } | null
  }
  dueAt: string
  status: string
  note: string | null
  outcome: string | null
  assignedTo: { id: string; name: string } | null
  completedAt: string | null
}

type FollowupsResponse = { followups: FollowupRow[]; total: number; page: number; pageSize: number }

type DueTab = 'today' | 'overdue' | 'upcoming' | 'completed' | 'all'

type LeadOption = { id: string; leadCode: string; customerName: string; mobile: string; department: string }

type StaffUser = { id: string; name: string; role: string; department: string | null; isActive: boolean }
type TeamRow = { id: string; name: string; department: string }

const MANAGEMENT_ROLES = ['TEAM_LEADER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']
const PAGE_SIZE = 20

// ---------- lead picker (searchable) ----------

function LeadPicker({
  value,
  onChange,
  dept,
}: {
  value: LeadOption | null
  onChange: (l: LeadOption | null) => void
  dept: string
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<LeadOption[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (value) return
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([])
        return
      }
      setSearching(true)
      try {
        const res = await api<{ leads: LeadOption[] }>(`/api/leads${qs({ q: q.trim(), dept: dept || undefined, pageSize: 8 })}`)
        setResults(res.leads ?? [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [q, value, dept])

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-800">
            {value.customerName} <span className="font-mono text-xs text-stone-500">{value.leadCode}</span>
          </p>
          <p className="text-xs text-stone-500">{value.mobile}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(null)} aria-label="Clear selected lead">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    )
  }

  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lead by name / mobile / code…" aria-label="Search lead" />
      <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-stone-200 bg-white">
        {searching ? (
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-stone-500">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Searching…
          </p>
        ) : results.length === 0 ? (
          <p className="px-3 py-2 text-xs text-stone-400">{q.trim().length < 2 ? 'Type at least 2 characters to search' : 'No leads found'}</p>
        ) : (
          results.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onChange(l)}
              className="flex w-full items-center justify-between gap-2 border-b border-stone-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-emerald-50"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium text-stone-800">{l.customerName}</span>{' '}
                <span className="font-mono text-xs text-stone-500">{l.leadCode}</span>
              </span>
              <span className="whitespace-nowrap text-xs text-stone-500">{l.mobile}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ---------- component ----------

export default function FollowupsView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()

  const isAdminLevel = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
  const isManagement = MANAGEMENT_ROLES.includes(user?.role ?? '')

  const [tab, setTab] = useState<DueTab>('today')
  const [dept, setDept] = useState(user?.department ?? '')
  const [teamId, setTeamId] = useState('')
  const [assignedToId, setAssignedToId] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<FollowupsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [counts, setCounts] = useState({ today: 0, overdue: 0, upcoming: 0, completed: 0 })
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [staff, setStaff] = useState<StaffUser[]>([])

  const [completingId, setCompletingId] = useState<string | null>(null)
  const [rescheduleTarget, setRescheduleTarget] = useState<FollowupRow | null>(null)
  const [rescheduleTo, setRescheduleTo] = useState('')
  const [rescheduling, setRescheduling] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [newLead, setNewLead] = useState<LeadOption | null>(null)
  const [newDueAt, setNewDueAt] = useState('')
  const [newNote, setNewNote] = useState('')
  const [creating, setCreating] = useState(false)

  const filterParams = useCallback(
    () => ({ dept: dept || undefined, teamId: teamId || undefined, assignedToId: assignedToId || undefined }),
    [dept, teamId, assignedToId]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<FollowupsResponse>(`/api/followups${qs({ due: tab, page, pageSize: PAGE_SIZE, ...filterParams() })}`)
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load follow-ups', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [tab, page, filterParams, toast])

  const loadCounts = useCallback(async () => {
    const dues: Array<Exclude<DueTab, 'all'>> = ['today', 'overdue', 'upcoming', 'completed']
    try {
      const results = await Promise.all(
        dues.map((d) => api<{ total: number }>(`/api/followups${qs({ due: d, pageSize: 1, ...filterParams() })}`))
      )
      setCounts({ today: results[0].total, overdue: results[1].total, upcoming: results[2].total, completed: results[3].total })
    } catch {
      setCounts({ today: 0, overdue: 0, upcoming: 0, completed: 0 })
    }
  }, [filterParams])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  useEffect(() => {
    loadCounts()
  }, [loadCounts, reloadKey])

  // teams + staff for filters
  useEffect(() => {
    if (!isManagement) return
    api<{ teams: TeamRow[] }>(`/api/teams${qs({ dept: dept || undefined })}`)
      .then((res) => setTeams(res.teams ?? []))
      .catch(() => setTeams([]))
  }, [dept, isManagement])

  useEffect(() => {
    if (!isManagement) return
    api<{ users: StaffUser[] }>(`/api/users${qs({ dept: dept || undefined, active: 1 })}`)
      .then((res) => setStaff(res.users ?? []))
      .catch(() => setStaff([]))
  }, [dept, isManagement])

  const setTabAndReset = (t: DueTab) => {
    setTab(t)
    setPage(1)
  }

  const completeFollowup = async (f: FollowupRow) => {
    setCompletingId(f.id)
    try {
      await api('/api/followups', { method: 'PATCH', body: { id: f.id, status: 'COMPLETED' } })
      toast({ title: 'Follow-up completed', description: `${f.lead.leadCode} — ${f.lead.customerName}` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Could not complete follow-up', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCompletingId(null)
    }
  }

  const openReschedule = (f: FollowupRow) => {
    setRescheduleTarget(f)
    setRescheduleTo(toInputDateTime(f.dueAt))
  }

  const submitReschedule = async () => {
    if (!rescheduleTarget || !rescheduleTo) {
      toast({ title: 'Pick a new date & time', variant: 'destructive' })
      return
    }
    setRescheduling(true)
    try {
      await api('/api/followups', {
        method: 'PATCH',
        body: { id: rescheduleTarget.id, status: 'RESCHEDULED', rescheduleTo: new Date(rescheduleTo).toISOString() },
      })
      toast({ title: 'Follow-up rescheduled', description: `New slot: ${formatDateTime(rescheduleTo)}` })
      setRescheduleTarget(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Reschedule failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setRescheduling(false)
    }
  }

  const openCreate = () => {
    setNewLead(null)
    setNewDueAt(toInputDateTime(new Date(Date.now() + 60 * 60 * 1000)))
    setNewNote('')
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    if (!newLead) {
      toast({ title: 'Select a lead', description: 'Search and pick the lead for this follow-up', variant: 'destructive' })
      return
    }
    if (!newDueAt) {
      toast({ title: 'Due date & time is required', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      await api('/api/followups', {
        method: 'POST',
        body: { leadId: newLead.id, dueAt: new Date(newDueAt).toISOString(), note: newNote || undefined },
      })
      toast({ title: 'Follow-up created', description: `${newLead.leadCode} — ${formatDateTime(newDueAt)}` })
      setCreateOpen(false)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Could not create follow-up', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const exportCsv = () => {
    const rows = (data?.followups ?? []).map((f) => ({
      leadCode: f.lead.leadCode,
      customerName: f.lead.customerName,
      mobile: f.lead.mobile,
      department: f.lead.department,
      stage: f.lead.stage?.label ?? '',
      dueAt: formatDateTime(f.dueAt),
      status: f.status,
      outcome: f.outcome ?? '',
      note: f.note ?? '',
      assignedTo: f.assignedTo?.name ?? '',
      completedAt: f.completedAt ? formatDateTime(f.completedAt) : '',
    }))
    downloadCSV(`followups-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast({ title: 'Export ready', description: `${rows.length} follow-up(s) exported to CSV` })
  }

  const isOverdue = (f: FollowupRow) => f.status === 'PENDING' && new Date(f.dueAt).getTime() < Date.now()

  const columns: Column<FollowupRow>[] = [
    {
      key: 'lead',
      header: 'Lead',
      render: (f) => (
        <div className="min-w-[150px]">
          <p className="font-medium text-stone-800">{f.lead.customerName}</p>
          <p className="font-mono text-xs text-stone-500">{f.lead.leadCode}</p>
        </div>
      ),
    },
    { key: 'mobile', header: 'Mobile', render: (f) => <span className="whitespace-nowrap">{f.lead.mobile}</span> },
    {
      key: 'department',
      header: 'Dept',
      render: (f) => <StatusBadge status={f.lead.department} variant="dept" />,
    },
    {
      key: 'dueAt',
      header: 'Due',
      render: (f) => (
        <span className={cn('whitespace-nowrap text-xs', isOverdue(f) && 'font-semibold text-rose-600')}>
          {formatDateTime(f.dueAt)}
          {isOverdue(f) ? <span className="ml-1">(overdue)</span> : null}
        </span>
      ),
    },
    {
      key: 'note',
      header: 'Note',
      className: 'max-w-[220px]',
      render: (f) => (
        <p className="truncate text-xs text-stone-600" title={f.note ?? undefined}>
          {f.note || <span className="text-stone-400">—</span>}
        </p>
      ),
    },
    {
      key: 'assignedTo',
      header: 'Assigned To',
      render: (f) => f.assignedTo?.name ?? <span className="text-stone-400">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (f) => <StatusBadge status={f.status} variant="followup" />,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-36',
      render: (f) =>
        f.status === 'PENDING' ? (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              disabled={completingId === f.id}
              onClick={() => completeFollowup(f)}
              aria-label={`Complete follow-up for ${f.lead.customerName}`}
            >
              {completingId === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
              Done
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => openReschedule(f)} aria-label={`Reschedule follow-up for ${f.lead.customerName}`}>
              Reschedule
            </Button>
          </div>
        ) : null,
    },
  ]

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fromIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(total, page * PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Follow-ups" subtitle="Today's calls, overdue reminders and upcoming commitments">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh follow-ups">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} aria-label="Export follow-ups as CSV">
          <Download className="h-4 w-4" aria-hidden />
          <span className="ml-1">Export CSV</span>
        </Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="ml-1">New Follow-up</span>
        </Button>
      </PageHeader>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Today" value={counts.today} icon={<CalendarClock className="h-5 w-5" aria-hidden />} onClick={() => setTabAndReset('today')} />
        <KpiCard label="Overdue" value={counts.overdue} tone="negative" icon={<CalendarX className="h-5 w-5" aria-hidden />} onClick={() => setTabAndReset('overdue')} />
        <KpiCard label="Upcoming" value={counts.upcoming} icon={<CalendarPlus className="h-5 w-5" aria-hidden />} onClick={() => setTabAndReset('upcoming')} />
        <KpiCard label="Completed" value={counts.completed} tone="positive" icon={<CheckCircle2 className="h-5 w-5" aria-hidden />} onClick={() => setTabAndReset('completed')} />
      </div>

      <FilterBar>
        <Tabs value={tab} onValueChange={(v) => setTabAndReset(v as DueTab)}>
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="all">
              <History className="mr-1 h-3.5 w-3.5" aria-hidden /> All
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {isAdminLevel ? (
          <Select value={dept || 'ALL'} onValueChange={(v) => { setDept(v === 'ALL' ? '' : v); setPage(1); setTeamId(''); setAssignedToId('') }}>
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
        {isManagement ? (
          <>
            <Select value={teamId || 'ANY'} onValueChange={(v) => { setTeamId(v === 'ANY' ? '' : v); setPage(1); setAssignedToId('') }}>
              <SelectTrigger className="w-40" aria-label="Team filter">
                <SelectValue placeholder="All Teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">All Teams</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assignedToId || 'ANY'} onValueChange={(v) => { setAssignedToId(v === 'ANY' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-44" aria-label="Assignee filter">
                <SelectValue placeholder="All Assignees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ANY">All Assignees</SelectItem>
                {staff.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={data?.followups ?? []}
        loading={loading}
        emptyMessage={tab === 'today' ? 'No follow-ups due today — shabaash, all clear!' : 'No follow-ups found'}
        onRowClick={(f) => setView('lead-detail', { leadId: f.lead.id })}
      />

      {/* pagination */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
        <span>
          {total === 0 ? '0 records' : `Showing ${fromIdx}–${toIdx} of ${total}`}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      {/* reschedule dialog */}
      <Dialog open={!!rescheduleTarget} onOpenChange={(open) => !open && setRescheduleTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule Follow-up</DialogTitle>
            <DialogDescription>
              {rescheduleTarget ? `${rescheduleTarget.lead.leadCode} — ${rescheduleTarget.lead.customerName}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reschedule-to">New date & time</Label>
              <Input id="reschedule-to" type="datetime-local" value={rescheduleTo} onChange={(e) => setRescheduleTo(e.target.value)} />
            </div>
            {rescheduleTarget?.note ? (
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">Note: {rescheduleTarget.note}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleTarget(null)} disabled={rescheduling}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitReschedule} disabled={rescheduling || !rescheduleTo}>
              {rescheduling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* new follow-up dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Follow-up</DialogTitle>
            <DialogDescription>Schedule a reminder against a lead. It also updates the lead&apos;s next follow-up.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Lead</Label>
              <LeadPicker value={newLead} onChange={setNewLead} dept={dept || user?.department || ''} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-due-at">Due date & time</Label>
              <Input id="new-due-at" type="datetime-local" value={newDueAt} onChange={(e) => setNewDueAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-note">Note</Label>
              <Textarea id="new-note" value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="What to discuss on this call?" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitCreate} disabled={creating || !newLead || !newDueAt}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Create Follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
