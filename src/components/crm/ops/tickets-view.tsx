'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Timer,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DEPARTMENTS, DEPT_LABELS, TICKET_STATUSES } from '@/lib/constants'
import { PageHeader } from '@/components/crm/shared/page-header'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { useMasters } from '@/components/crm/shared/use-masters'
import { useAppStore } from '@/store/app-store'

// ---------- types ----------

type TicketRow = {
  id: string
  ticketNo: string
  department: string
  type: string
  priority: string
  subject: string
  description: string | null
  status: string
  slaDueAt: string | null
  resolvedAt: string | null
  createdAt: string
  lead: { id: string; leadCode: string; customerName: string } | null
  assignedTo: { id: string; name: string } | null
}

type TicketsResponse = {
  tickets: TicketRow[]
  total: number
  summary: { open: number; inProgress: number; escalated: number; resolvedToday: number }
}

type CommentRow = {
  id: string
  body: string
  isInternal: boolean
  createdAt: string
  user: { id: string; name: string } | null
}

type StaffUser = { id: string; name: string; role: string; department: string | null; isActive: boolean }

type LeadOption = { id: string; leadCode: string; customerName: string; mobile: string; department: string }

const TICKET_PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']
const PAGE_SIZE = 20

// ---------- lead picker (searchable, optional) ----------

function OptionalLeadPicker({
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

  return (
    <div className="space-y-1.5">
      {value ? (
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
      ) : (
        <>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link a lead (optional) — search by name / mobile / code" aria-label="Search lead to link" />
          <div className="max-h-36 overflow-y-auto rounded-lg border border-stone-200 bg-white">
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
        </>
      )}
    </div>
  )
}

// ---------- component ----------

export default function TicketsView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()

  const isAdminLevel = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
  const isExecutive = user?.role === 'EXECUTIVE'
  const canAssign = !isExecutive

  const [status, setStatus] = useState('')
  const [dept, setDept] = useState(user?.department ?? '')
  const [assignedToId, setAssignedToId] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<TicketsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [staff, setStaff] = useState<StaffUser[]>([])

  // create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [newLead, setNewLead] = useState<LeadOption | null>(null)
  const [newType, setNewType] = useState('')
  const [newPriority, setNewPriority] = useState('MEDIUM')
  const [newSubject, setNewSubject] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  // detail dialog
  const [detail, setDetail] = useState<TicketRow | null>(null)
  const [editStatus, setEditStatus] = useState('')
  const [editPriority, setEditPriority] = useState('')
  const [editAssignee, setEditAssignee] = useState('')
  const [savingTicket, setSavingTicket] = useState(false)
  const [comments, setComments] = useState<CommentRow[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [commentInternal, setCommentInternal] = useState(false)
  const [postingComment, setPostingComment] = useState(false)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 400)
    return () => clearTimeout(t)
  }, [qInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<TicketsResponse>(
        `/api/tickets${qs({ status: status || undefined, dept: dept || undefined, q: q || undefined, assignedToId: assignedToId || undefined, page, pageSize: PAGE_SIZE })}`
      )
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load tickets', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [status, dept, q, assignedToId, page, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // support + management staff for assignee filter / editing
  useEffect(() => {
    api<{ users: StaffUser[] }>(`/api/users${qs({ dept: dept || undefined, active: 1 })}`)
      .then((res) => setStaff((res.users ?? []).filter((u) => ['SUPPORT', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(u.role))))
      .catch(() => setStaff([]))
  }, [dept])

  const openCreate = () => {
    setNewLead(null)
    setNewType('')
    setNewPriority('MEDIUM')
    setNewSubject('')
    setNewDescription('')
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    if (!newType) {
      toast({ title: 'Select a ticket type', variant: 'destructive' })
      return
    }
    if (!newSubject.trim()) {
      toast({ title: 'Subject is required', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await api<{ ticket: TicketRow }>('/api/tickets', {
        method: 'POST',
        body: {
          leadId: newLead?.id || undefined,
          type: newType,
          priority: newPriority,
          subject: newSubject.trim(),
          description: newDescription.trim() || undefined,
        },
      })
      toast({ title: `Ticket ${res.ticket.ticketNo} created`, description: `${newType} · ${newPriority} priority` })
      setCreateOpen(false)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Could not create ticket', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const openDetail = (t: TicketRow) => {
    setDetail(t)
    setEditStatus(t.status)
    setEditPriority(t.priority)
    setEditAssignee(t.assignedTo?.id ?? '')
    setComments([])
    setCommentBody('')
    setCommentInternal(false)
  }

  // load comments when detail opens
  useEffect(() => {
    if (!detail) return
    let cancelled = false
    setCommentsLoading(true)
    api<{ comments: CommentRow[] }>(`/api/tickets/comments${qs({ ticketId: detail.id })}`)
      .then((res) => {
        if (!cancelled) setComments(res.comments ?? [])
      })
      .catch((e) => {
        if (!cancelled) toast({ title: 'Failed to load comments', description: (e as Error).message, variant: 'destructive' })
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detail, toast])

  const ticketDirty =
    !!detail && (editStatus !== detail.status || editPriority !== detail.priority || editAssignee !== (detail.assignedTo?.id ?? ''))

  const saveTicketEdits = async () => {
    if (!detail || !ticketDirty) return
    setSavingTicket(true)
    try {
      const body: { id: string; status?: string; priority?: string; assignedToId?: string } = { id: detail.id }
      if (editStatus !== detail.status) body.status = editStatus
      if (editPriority !== detail.priority) body.priority = editPriority
      if (canAssign && editAssignee !== (detail.assignedTo?.id ?? '')) body.assignedToId = editAssignee || undefined
      const res = await api<{ ticket: TicketRow }>('/api/tickets', { method: 'PATCH', body })
      toast({ title: `Ticket ${detail.ticketNo} updated` })
      setDetail(res.ticket)
      setEditStatus(res.ticket.status)
      setEditPriority(res.ticket.priority)
      setEditAssignee(res.ticket.assignedTo?.id ?? '')
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingTicket(false)
    }
  }

  const submitComment = async () => {
    if (!detail || !commentBody.trim()) {
      toast({ title: 'Write a comment first', variant: 'destructive' })
      return
    }
    setPostingComment(true)
    try {
      const res = await api<{ comment: CommentRow }>('/api/tickets/comment', {
        method: 'POST',
        body: { ticketId: detail.id, body: commentBody.trim(), isInternal: commentInternal },
      })
      setComments((prev) => [...prev, res.comment])
      setCommentBody('')
      setCommentInternal(false)
      toast({ title: 'Comment added' })
    } catch (e) {
      toast({ title: 'Could not add comment', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setPostingComment(false)
    }
  }

  const exportCsv = () => {
    const rows = (data?.tickets ?? []).map((t) => ({
      ticketNo: t.ticketNo,
      subject: t.subject,
      type: masters.byId(t.type)?.label ?? t.type,
      priority: t.priority,
      status: t.status,
      department: t.department,
      lead: t.lead ? `${t.lead.leadCode} — ${t.lead.customerName}` : '',
      assignedTo: t.assignedTo?.name ?? '',
      slaDueAt: t.slaDueAt ? formatDateTime(t.slaDueAt) : '',
      createdAt: formatDateTime(t.createdAt),
    }))
    downloadCSV(`tickets-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast({ title: 'Export ready', description: `${rows.length} ticket(s) exported to CSV` })
  }

  const slaBreached = (t: TicketRow) =>
    Boolean(t.slaDueAt && new Date(t.slaDueAt).getTime() < Date.now() && !['RESOLVED', 'CLOSED'].includes(t.status))

  const typeLabel = (t: TicketRow) => masters.byId(t.type)?.label ?? t.type

  const columns: Column<TicketRow>[] = [
    {
      key: 'ticketNo',
      header: 'Ticket',
      render: (t) => <span className="whitespace-nowrap font-mono text-xs font-bold text-stone-800">{t.ticketNo}</span>,
    },
    {
      key: 'subject',
      header: 'Subject',
      className: 'min-w-[180px] max-w-[260px]',
      render: (t) => (
        <div>
          <p className="truncate font-medium text-stone-800" title={t.subject}>
            {t.subject}
          </p>
          <p className="truncate text-xs text-stone-500">{typeLabel(t)}</p>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (t) => (
        <StatusBadge
          status={t.priority}
          variant="priority"
          className={t.priority === 'URGENT' ? 'border-red-300 bg-red-200 text-red-800' : undefined}
        />
      ),
    },
    {
      key: 'lead',
      header: 'Lead',
      render: (t) => {
        const lead = t.lead
        return lead ? (
          <button
            type="button"
            className="text-left text-xs hover:text-emerald-700 hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              setView('lead-detail', { leadId: lead.id })
            }}
            aria-label={`Open lead ${lead.customerName}`}
          >
            <span className="font-medium text-stone-800">{lead.customerName}</span>
            <span className="block font-mono text-stone-500">{lead.leadCode}</span>
          </button>
        ) : (
          <span className="text-stone-400">—</span>
        )
      },
    },
    {
      key: 'assignedTo',
      header: 'Assignee',
      render: (t) => t.assignedTo?.name ?? <span className="text-stone-400">Unassigned</span>,
    },
    {
      key: 'slaDueAt',
      header: 'SLA Due',
      render: (t) =>
        t.slaDueAt ? (
          <div className="whitespace-nowrap">
            <span className={cn('text-xs', slaBreached(t) && 'font-semibold text-rose-600')}>{formatDateTime(t.slaDueAt)}</span>
            {slaBreached(t) ? (
              <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> SLA Breached
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-stone-400">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <StatusBadge status={t.status} variant="ticket" />,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (t) => <span className="whitespace-nowrap text-xs text-stone-500">{formatDateTime(t.createdAt)}</span>,
    },
  ]

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fromIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(total, page * PAGE_SIZE)
  const summary = data?.summary
  const typeOptions = masters.items('ticket_type', dept || newLead?.department || user?.department || undefined)

  return (
    <div>
      <PageHeader title="Support Tickets" subtitle="Customer issues, SLA tracking and resolution workflow">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh tickets">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} aria-label="Export tickets as CSV">
          <Download className="h-4 w-4" aria-hidden />
          <span className="ml-1">Export CSV</span>
        </Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="ml-1">New Ticket</span>
        </Button>
      </PageHeader>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open"
          value={summary?.open ?? 0}
          icon={<Inbox className="h-5 w-5" aria-hidden />}
          onClick={() => {
            setStatus('OPEN')
            setPage(1)
          }}
        />
        <KpiCard
          label="In Progress"
          value={summary?.inProgress ?? 0}
          tone="warning"
          icon={<Timer className="h-5 w-5" aria-hidden />}
          onClick={() => {
            setStatus('IN_PROGRESS')
            setPage(1)
          }}
        />
        <KpiCard
          label="Escalated"
          value={summary?.escalated ?? 0}
          tone="negative"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
          onClick={() => {
            setStatus('ESCALATED')
            setPage(1)
          }}
        />
        <KpiCard
          label="Resolved Today"
          value={summary?.resolvedToday ?? 0}
          tone="positive"
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
          onClick={() => {
            setStatus('RESOLVED')
            setPage(1)
          }}
        />
      </div>

      <FilterBar>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" aria-hidden />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search ticket no, subject, customer…"
            className="w-56 pl-8"
            aria-label="Search tickets"
          />
        </div>
        <Select value={status || 'ALL'} onValueChange={(v) => { setStatus(v === 'ALL' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-40" aria-label="Status filter">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {TICKET_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdminLevel ? (
          <Select value={dept || 'ALL'} onValueChange={(v) => { setDept(v === 'ALL' ? '' : v); setPage(1); setAssignedToId('') }}>
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
        {canAssign ? (
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
        ) : null}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={data?.tickets ?? []}
        loading={loading}
        emptyMessage="No tickets found — customers are happy!"
        onRowClick={openDetail}
      />

      {/* pagination */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
        <span>{total === 0 ? '0 records' : `Showing ${fromIdx}–${toIdx} of ${total}`}</span>
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

      {/* create ticket dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Support Ticket</DialogTitle>
            <DialogDescription>SLA is set automatically from priority (URGENT 8h · HIGH 24h · MEDIUM 48h · LOW 72h).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Linked lead (optional)</Label>
              <OptionalLeadPicker value={newLead} onChange={setNewLead} dept={dept || user?.department || ''} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger aria-label="Ticket type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((m) => (
                      <SelectItem key={m.id} value={m.label}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger aria-label="Ticket priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TICKET_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-subject">Subject</Label>
              <Input id="ticket-subject" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Short summary of the issue" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-description">Description</Label>
              <Textarea id="ticket-description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={3} placeholder="Details, order no, courier, what customer said…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitCreate} disabled={creating || !newType || !newSubject.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Create Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ticket detail dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base">{detail.ticketNo}</span>
                  <StatusBadge status={detail.status} variant="ticket" />
                  <StatusBadge
                    status={detail.priority}
                    variant="priority"
                    className={detail.priority === 'URGENT' ? 'border-red-300 bg-red-200 text-red-800' : undefined}
                  />
                  {slaBreached(detail) ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> SLA Breached
                    </span>
                  ) : null}
                </DialogTitle>
                <DialogDescription>{detail.subject}</DialogDescription>
              </DialogHeader>

              <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                {/* meta */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs md:grid-cols-3">
                  <div>
                    <p className="text-stone-400">Type</p>
                    <p className="font-medium text-stone-700">{typeLabel(detail)}</p>
                  </div>
                  <div>
                    <p className="text-stone-400">Department</p>
                    <StatusBadge status={detail.department} variant="dept" />
                  </div>
                  <div>
                    <p className="text-stone-400">Created</p>
                    <p className="font-medium text-stone-700">{formatDateTime(detail.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-stone-400">SLA Due</p>
                    <p className={cn('font-medium', slaBreached(detail) ? 'text-rose-600' : 'text-stone-700')}>
                      {formatDateTime(detail.slaDueAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-400">Resolved At</p>
                    <p className="font-medium text-stone-700">{detail.resolvedAt ? formatDateTime(detail.resolvedAt) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-stone-400">Lead</p>
                    {detail.lead ? (
                      <button
                        type="button"
                        className="font-medium text-emerald-700 hover:underline"
                        onClick={() => {
                          const leadId = detail.lead?.id
                          if (!leadId) return
                          setDetail(null)
                          setView('lead-detail', { leadId })
                        }}
                      >
                        {detail.lead.leadCode} — {detail.lead.customerName}
                      </button>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </div>
                </div>

                {detail.description ? (
                  <div className="rounded-xl border border-stone-200 bg-white p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Description</p>
                    <p className="whitespace-pre-wrap text-sm text-stone-700">{detail.description}</p>
                  </div>
                ) : null}

                {/* editing */}
                <div className="rounded-xl border border-stone-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Manage ticket</p>
                  <div className={cn('grid grid-cols-1 gap-3', canAssign ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Status</Label>
                      <Select value={editStatus} onValueChange={setEditStatus}>
                        <SelectTrigger className="h-9" aria-label="Ticket status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TICKET_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.replaceAll('_', ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Priority</Label>
                      <Select value={editPriority} onValueChange={setEditPriority}>
                        <SelectTrigger className="h-9" aria-label="Ticket priority">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TICKET_PRIORITIES.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {canAssign ? (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Assignee</Label>
                        <Select value={editAssignee || 'NONE'} onValueChange={(v) => setEditAssignee(v === 'NONE' ? '' : v)}>
                          <SelectTrigger className="h-9" aria-label="Ticket assignee">
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">Unassigned</SelectItem>
                            {staff.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={saveTicketEdits}
                      disabled={savingTicket || !ticketDirty}
                    >
                      {savingTicket ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      Save Changes
                    </Button>
                  </div>
                </div>

                {/* comments */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
                    Comments ({comments.length})
                  </p>
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-3">
                    {commentsLoading ? (
                      <p className="flex items-center gap-2 py-4 text-xs text-stone-500">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading comments…
                      </p>
                    ) : comments.filter((c) => !c.isInternal || !isExecutive).length === 0 ? (
                      <p className="py-4 text-center text-xs text-stone-400">No comments yet</p>
                    ) : (
                      comments
                        .filter((c) => !c.isInternal || !isExecutive)
                        .map((c) => (
                          <div key={c.id} className={cn('rounded-lg border p-2.5', c.isInternal ? 'border-amber-200 bg-amber-50' : 'border-stone-200 bg-stone-50')}>
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-stone-700">{c.user?.name ?? 'System'}</span>
                              {c.isInternal ? (
                                <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                                  Internal
                                </span>
                              ) : null}
                              <span className="text-[10px] text-stone-400">{formatDateTime(c.createdAt)}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-stone-700">{c.body}</p>
                          </div>
                        ))
                    )}
                  </div>
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      rows={2}
                      placeholder="Add an update for the team / customer…"
                      aria-label="New comment"
                    />
                    <div className="flex items-center justify-between">
                      {!isExecutive ? (
                        <label className="flex items-center gap-2 text-xs text-stone-600">
                          <Switch checked={commentInternal} onCheckedChange={setCommentInternal} aria-label="Internal comment" />
                          Internal note (hidden from executives)
                        </label>
                      ) : (
                        <span />
                      )}
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={submitComment}
                        disabled={postingComment || !commentBody.trim()}
                      >
                        {postingComment ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                        Add Comment
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
