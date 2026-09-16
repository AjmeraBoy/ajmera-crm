'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Download,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Pin,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserCog,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { formatDateTime, formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  DEPARTMENTS,
  DEPT_LABELS,
  LEAD_STATUSES,
  PRIORITIES,
} from '@/lib/constants'
import { PageHeader } from '@/components/crm/shared/page-header'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { masterExtra, useMasters } from '@/components/crm/shared/use-masters'
import { useAppStore } from '@/store/app-store'
import LeadFormDialog, { SearchableSelect, type MasterOption } from '@/components/crm/leads/lead-form-dialog'

// ---------- types ----------

type LeadRow = {
  id: string
  leadCode: string
  department: string
  customerName: string
  companyName: string | null
  mobile: string
  whatsapp: string | null
  email: string | null
  city: string | null
  productInterest: string | null
  requirementNotes: string | null
  monthlyVolume: number | null
  budget: number | null
  notes: string | null
  visitDate: string | null
  visitTime: string | null
  businessTypeId: string | null
  stateId: string | null
  countryId: string | null
  sourceId: string | null
  stageId: string | null
  state: { id: string; label: string } | null
  country: { id: string; label: string } | null
  source: { id: string; label: string } | null
  stage: { id: string; label: string; extra: string | null } | null
  disposition: { id: string; label: string } | null
  subDisposition: { id: string; label: string } | null
  priority: string | null
  estimatedValue: number | null
  nextFollowUpAt: string | null
  lastContactAt: string | null
  isSticky: boolean
  status: string
  createdAt: string
  assignedTo: { id: string; name: string } | null
}

type LeadsResponse = {
  leads: LeadRow[]
  total: number
  page: number
  pageSize: number
  summary: { total: number; active: number; converted: number; lost: number; sticky: number }
}

type ExportRow = {
  leadCode: string
  customerName: string
  companyName: string | null
  mobile: string
  whatsapp: string | null
  city: string | null
  state: string | null
  country: string | null
  source: string | null
  stage: string | null
  disposition: string | null
  subDisposition: string | null
  priority: string | null
  estimatedValue: number | null
  assignedTo: string | null
  status: string
  nextFollowUpAt: string | null
  createdAt: string
}

type ExecUser = { id: string; name: string; role: string; department: string | null; isActive: boolean }

type Filters = {
  q: string
  dept: string
  stageId: string
  dispositionId: string
  sourceId: string
  priority: string
  status: string
  sticky: boolean
  assignedToId: string
  from: string
  to: string
  followup: '' | 'today' | 'overdue' | 'upcoming'
}

const MANAGEMENT_ROLES = ['TEAM_LEADER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']
const PAGE_SIZE = 20

function defaultFilters(dept: string): Filters {
  return {
    q: '', dept, stageId: '', dispositionId: '', sourceId: '', priority: '', status: '',
    sticky: false, assignedToId: '', from: '', to: '', followup: '',
  }
}

// ---------- component ----------

export default function LeadsView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()

  const isManagement = MANAGEMENT_ROLES.includes(user?.role ?? '')
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const canPickDept = !user?.department

  const [filters, setFilters] = useState<Filters>(() => defaultFilters(user?.department ?? ''))
  const [qInput, setQInput] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<LeadsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [execs, setExecs] = useState<ExecUser[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [formOpen, setFormOpen] = useState(false)
  const [editLead, setEditLead] = useState<LeadRow | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignIds, setAssignIds] = useState<string[]>([])
  const [assignTarget, setAssignTarget] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteLead, setDeleteLead] = useState<LeadRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput }))
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [qInput])

  const buildParams = useCallback(
    (forExport = false) => ({
      q: filters.q || undefined,
      dept: filters.dept || undefined,
      stageId: filters.stageId || undefined,
      dispositionId: filters.dispositionId || undefined,
      sourceId: filters.sourceId || undefined,
      priority: filters.priority || undefined,
      status: filters.status || undefined,
      sticky: filters.sticky ? 1 : undefined,
      assignedToId: filters.assignedToId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      followup: filters.followup || undefined,
      ...(forExport ? {} : { page, pageSize: PAGE_SIZE }),
    }),
    [filters, page]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<LeadsResponse>(`/api/leads${qs(buildParams())}`)
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load leads', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [buildParams, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // executives for "Assigned to" filter + assignment dialogs
  useEffect(() => {
    const dept = user?.department ?? filters.dept
    api<{ users: ExecUser[] }>(`/api/users${qs({ role: 'EXECUTIVE', active: 1, dept: dept || undefined })}`)
      .then((res) => setExecs(res.users ?? []))
      .catch(() => setExecs([]))
  }, [user?.department, filters.dept])

  const execOptions = useMemo<MasterOption[]>(() => execs.map((u) => ({ id: u.id, label: u.name })), [execs])

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
    setSelected(new Set())
  }

  const resetFilters = () => {
    setFilters(defaultFilters(user?.department ?? ''))
    setQInput('')
    setPage(1)
    setSelected(new Set())
  }

  // ---------- summary chips ----------
  const summary = data?.summary
  const chips: { key: string; label: string; count: number; active: boolean; onClick: () => void }[] = [
    {
      key: 'all', label: 'Total', count: summary?.total ?? 0,
      active: !filters.status && !filters.sticky,
      onClick: () => {
        setFilters((f) => ({ ...f, status: '', sticky: false }))
        setPage(1)
        setSelected(new Set())
      },
    },
    {
      key: 'active', label: 'Active', count: summary?.active ?? 0,
      active: filters.status === 'ACTIVE' && !filters.sticky,
      onClick: () => setFilter('status', 'ACTIVE'),
    },
    {
      key: 'converted', label: 'Converted', count: summary?.converted ?? 0,
      active: filters.status === 'CONVERTED',
      onClick: () => setFilter('status', 'CONVERTED'),
    },
    {
      key: 'lost', label: 'Lost', count: summary?.lost ?? 0,
      active: filters.status === 'LOST',
      onClick: () => setFilter('status', 'LOST'),
    },
    {
      key: 'sticky', label: 'Sticky', count: summary?.sticky ?? 0,
      active: filters.sticky,
      onClick: () => {
        setFilters((f) => ({ ...f, sticky: !f.sticky, status: '' }))
        setPage(1)
      },
    },
  ]

  // ---------- actions ----------
  const openLead = (lead: LeadRow) => setView('lead-detail', { leadId: lead.id })

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await api<{ rows: ExportRow[] }>(`/api/leads/export${qs(buildParams(true))}`)
      const rows = (res.rows ?? []).map((r) => ({
        ...r,
        estimatedValue: r.estimatedValue ?? 0,
        nextFollowUpAt: r.nextFollowUpAt ? formatDateTime(r.nextFollowUpAt) : '',
        createdAt: r.createdAt ? formatDateTime(r.createdAt) : '',
      }))
      downloadCSV(`leads-${new Date().toISOString().slice(0, 10)}.csv`, rows)
      toast({ title: 'Export ready', description: `${rows.length} leads exported to CSV` })
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  const submitAssign = async (ids: string[]) => {
    if (ids.length === 0) return
    if (!assignTarget) {
      toast({ title: 'Select an executive', variant: 'destructive' })
      return
    }
    setAssigning(true)
    try {
      const res = await api<{ updated: number }>('/api/leads/assign', {
        method: 'POST',
        body: { leadIds: ids, assignedToId: assignTarget },
      })
      toast({ title: 'Leads reassigned', description: `${res.updated} lead(s) assigned successfully` })
      setAssignOpen(false)
      setAssignTarget('')
      setSelected(new Set())
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Reassign failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setAssigning(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteLead) return
    setDeleting(true)
    try {
      await api(`/api/leads${qs({ id: deleteLead.id })}`, { method: 'DELETE' })
      toast({ title: 'Lead deleted', description: `${deleteLead.leadCode} removed` })
      setDeleteLead(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  // ---------- bulk selection ----------
  const rowIds = (data?.leads ?? []).map((l) => l.id)
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id))
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rowIds))
  }
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---------- table columns ----------
  const stageOptions = useMemo<MasterOption[]>(
    () => masters.items('pipeline_stage', filters.dept || user?.department || undefined).map((m) => ({ id: m.id, label: m.label })),
    [masters, filters.dept, user?.department]
  )
  const dispositionOptions = useMemo<MasterOption[]>(
    () => masters.items('disposition', filters.dept || user?.department || undefined).map((m) => ({ id: m.id, label: m.label })),
    [masters, filters.dept, user?.department]
  )
  const sourceOptions = useMemo<MasterOption[]>(
    () => masters.items('lead_source', filters.dept || user?.department || undefined).map((m) => ({ id: m.id, label: m.label })),
    [masters, filters.dept, user?.department]
  )

  const isOverdue = (d: string | null) => Boolean(d && new Date(d).getTime() < Date.now())

  const columns: Column<LeadRow>[] = useMemo(() => {
    const cols: Column<LeadRow>[] = []
    if (isManagement) {
      cols.push({
        key: 'sel',
        header: '',
        className: 'w-10',
        render: (row) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selected.has(row.id)}
              onCheckedChange={() => toggleOne(row.id)}
              aria-label={`Select lead ${row.leadCode}`}
            />
          </div>
        ),
      })
    }
    cols.push(
      {
        key: 'leadCode',
        header: 'Lead ID',
        render: (row) => (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold text-stone-800">{row.leadCode}</span>
            {row.isSticky ? <Pin className="h-3 w-3 text-amber-500" aria-label="Sticky lead" /> : null}
            <StatusBadge status={row.department} variant="dept" className="ml-1 hidden md:inline-flex" />
          </div>
        ),
      },
      {
        key: 'customerName',
        header: 'Customer',
        render: (row) => (
          <div className="min-w-[140px]">
            <p className="font-medium text-stone-800">{row.customerName}</p>
            {row.companyName ? <p className="text-xs text-stone-500">{row.companyName}</p> : null}
            {row.city ? <p className="text-xs text-stone-400">{row.city}{row.state ? `, ${row.state.label}` : row.country ? `, ${row.country.label}` : ''}</p> : null}
          </div>
        ),
      },
      {
        key: 'mobile',
        header: 'Contact',
        render: (row) => (
          <div className="min-w-[120px]">
            <p className="text-sm">{row.mobile}</p>
            {row.whatsapp && row.whatsapp !== row.mobile ? <p className="text-xs text-stone-500">WA: {row.whatsapp}</p> : null}
            {row.email ? <p className="truncate text-xs text-stone-400">{row.email}</p> : null}
          </div>
        ),
      },
      {
        key: 'stage',
        header: 'Stage',
        render: (row) => {
          const color = String(masterExtra(row.stage?.extra).color ?? '')
          return row.stage ? (
            <Badge variant="outline" className="gap-1.5 whitespace-nowrap border-stone-200 font-medium text-stone-700">
              <span className="h-2 w-2 rounded-full" style={color ? { backgroundColor: color } : { backgroundColor: '#a8a29e' }} aria-hidden />
              {row.stage.label}
            </Badge>
          ) : (
            <span className="text-stone-400">—</span>
          )
        },
      },
      {
        key: 'disposition',
        header: 'Disposition',
        render: (row) => (
          <div className="min-w-[110px]">
            <p className="whitespace-nowrap">{row.disposition?.label ?? <span className="text-stone-400">—</span>}</p>
            {row.subDisposition ? <p className="text-xs text-stone-400">{row.subDisposition.label}</p> : null}
          </div>
        ),
      },
      {
        key: 'priority',
        header: 'Priority',
        render: (row) => <StatusBadge status={row.priority} variant="priority" />,
      },
      {
        key: 'estimatedValue',
        header: 'Value',
        className: 'text-right',
        render: (row) => (
          <span className="font-medium text-emerald-700">{row.estimatedValue ? formatINR(row.estimatedValue) : '—'}</span>
        ),
      },
      {
        key: 'owner',
        header: 'Owner',
        render: (row) =>
          row.assignedTo ? (
            <div className="flex items-center gap-2">
              <UserAvatar name={row.assignedTo.name} className="h-6 w-6" />
              <span className="whitespace-nowrap text-xs">{row.assignedTo.name}</span>
            </div>
          ) : (
            <span className="text-stone-400">Unassigned</span>
          ),
      },
      {
        key: 'nextFollowUpAt',
        header: 'Next Follow-up',
        render: (row) =>
          row.nextFollowUpAt ? (
            <span className={cn('whitespace-nowrap text-xs', isOverdue(row.nextFollowUpAt) && 'font-semibold text-rose-600')}>
              {formatDateTime(row.nextFollowUpAt)}
            </span>
          ) : (
            <span className="text-stone-400">—</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.status} variant="leadStatus" />,
      },
      {
        key: 'actions',
        header: '',
        className: 'w-12',
        render: (row) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${row.leadCode}`}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openLead(row)}>Open 360° view</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView('dialer', { leadId: row.id })}>
                  <Phone className="mr-2 h-4 w-4" aria-hidden /> Call
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView('whatsapp', { leadId: row.id })}>
                  <MessageCircle className="mr-2 h-4 w-4" aria-hidden /> WhatsApp
                </DropdownMenuItem>
                {isManagement ? (
                  <DropdownMenuItem
                    onClick={() => {
                      setAssignIds([row.id])
                      setAssignTarget(row.assignedTo?.id ?? '')
                      setAssignOpen(true)
                    }}
                  >
                    <UserCog className="mr-2 h-4 w-4" aria-hidden /> Assign / Reassign
                  </DropdownMenuItem>
                ) : null}
                {isAdmin ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={() => setDeleteLead(row)}>
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Delete
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }
    )
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManagement, isAdmin, selected, masters, filters.dept, user?.department])

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fromIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(total, page * PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Leads" subtitle="Track, qualify and convert every enquiry">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh leads">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting} aria-label="Export leads as CSV">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          <span className="ml-1">Export CSV</span>
        </Button>
        {isManagement ? (
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} aria-label="Import leads">
            <Upload className="h-4 w-4" aria-hidden />
            <span className="ml-1">Import Leads</span>
          </Button>
        ) : null}
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setEditLead(null); setFormOpen(true) }}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="ml-1">New Lead</span>
        </Button>
      </PageHeader>

      {/* summary chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.onClick}
            aria-pressed={c.active}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              c.active
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-300 hover:text-emerald-700'
            )}
          >
            {c.label} <span className={cn('font-bold', c.active ? 'text-emerald-100' : 'text-stone-900')}>{c.count}</span>
          </button>
        ))}
      </div>

      <FilterBar>
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search name, mobile, company, code…"
          className="h-9 w-full sm:w-56"
          aria-label="Search leads"
        />
        {canPickDept ? (
          <Select value={filters.dept} onValueChange={(v) => setFilter('dept', v)}>
            <SelectTrigger className="h-9 w-[140px]" aria-label="Department filter"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={filters.stageId} onValueChange={(v) => setFilter('stageId', v)}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Stage filter"><SelectValue placeholder="Stage: All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Stage: All</SelectItem>
            {stageOptions.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.dispositionId} onValueChange={(v) => setFilter('dispositionId', v)}>
          <SelectTrigger className="h-9 w-[160px]" aria-label="Disposition filter"><SelectValue placeholder="Disposition: All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Disposition: All</SelectItem>
            {dispositionOptions.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.sourceId} onValueChange={(v) => setFilter('sourceId', v)}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Source filter"><SelectValue placeholder="Source: All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Source: All</SelectItem>
            {sourceOptions.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.priority} onValueChange={(v) => setFilter('priority', v)}>
          <SelectTrigger className="h-9 w-[130px]" aria-label="Priority filter"><SelectValue placeholder="Priority: All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Priority: All</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilter('status', v)}>
          <SelectTrigger className="h-9 w-[130px]" aria-label="Status filter"><SelectValue placeholder="Status: All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: All</SelectItem>
            {LEAD_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isManagement ? (
          <Select value={filters.assignedToId} onValueChange={(v) => setFilter('assignedToId', v)}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Assigned to filter"><SelectValue placeholder="Owner: All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Owner: All</SelectItem>
              {execOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex items-center gap-2">
          <Input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className="h-9 w-[140px]" aria-label="Created from date" />
          <span className="text-xs text-stone-400">to</span>
          <Input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className="h-9 w-[140px]" aria-label="Created to date" />
        </div>
        <label className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm">
          <Switch checked={filters.sticky} onCheckedChange={(v) => setFilter('sticky', v)} aria-label="Only sticky leads" />
          <span className="flex items-center gap-1 text-stone-600">
            <Pin className="h-3.5 w-3.5 text-amber-500" aria-hidden /> Sticky only
          </span>
        </label>
        <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset all filters">
          <X className="h-4 w-4" aria-hidden /> Reset
        </Button>
      </FilterBar>

      {/* follow-up quick filter chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-400">Follow-ups:</span>
        {([
          { key: '', label: 'All' },
          { key: 'today', label: 'Today' },
          { key: 'overdue', label: 'Overdue' },
          { key: 'upcoming', label: 'Upcoming' },
        ] as const).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter('followup', f.key as Filters['followup'])}
            aria-pressed={filters.followup === f.key}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              filters.followup === f.key
                ? 'border-stone-800 bg-stone-800 text-white'
                : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={data?.leads ?? []}
        loading={loading}
        onRowClick={openLead}
        emptyMessage="No leads match the current filters"
      />

      {/* pagination */}
      <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p className="text-xs text-stone-500">
          Showing {fromIdx}–{toIdx} of {total} leads
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            Previous
          </Button>
          <span className="text-xs text-stone-600">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            Next
          </Button>
        </div>
      </div>

      {/* floating bulk assign bar */}
      {isManagement && selected.size > 0 ? (
        <div className="fixed bottom-6 left-1/2 z-50 w-[92%] max-w-xl -translate-x-1/2 rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-stone-700">{selected.size} selected</span>
            <Select value={assignTarget} onValueChange={setAssignTarget}>
              <SelectTrigger className="h-9 min-w-[160px] flex-1" aria-label="Assign selected leads to executive">
                <SelectValue placeholder="Assign to…" />
              </SelectTrigger>
              <SelectContent>
                {execOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={assigning || !assignTarget}
              onClick={() => submitAssign([...selected])}
            >
              {assigning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Apply
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} aria-label="Clear selection">
              <X className="h-4 w-4" aria-hidden /> Clear
            </Button>
          </div>
        </div>
      ) : null}

      {/* new / edit lead dialog */}
      <LeadFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        lead={editLead ? {
          id: editLead.id,
          leadCode: editLead.leadCode,
          department: editLead.department,
          customerName: editLead.customerName,
          companyName: editLead.companyName,
          mobile: editLead.mobile,
          whatsapp: editLead.whatsapp,
          email: editLead.email,
          city: editLead.city,
          stateId: editLead.stateId ?? editLead.state?.id ?? null,
          countryId: editLead.countryId ?? editLead.country?.id ?? null,
          businessTypeId: editLead.businessTypeId,
          productInterest: editLead.productInterest,
          requirementNotes: editLead.requirementNotes,
          monthlyVolume: editLead.monthlyVolume,
          budget: editLead.budget,
          sourceId: editLead.sourceId ?? editLead.source?.id ?? null,
          visitDate: editLead.visitDate,
          visitTime: editLead.visitTime,
          priority: editLead.priority,
          notes: editLead.notes,
          stageId: editLead.stageId ?? editLead.stage?.id ?? null,
        } : null}
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      {/* delete confirmation */}
      <AlertDialog open={Boolean(deleteLead)} onOpenChange={(o) => { if (!o) setDeleteLead(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete lead {deleteLead?.leadCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleteLead?.customerName} and all linked activity, follow-ups, calls and orders. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {deleting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* single reassign dialog (management) */}
      <Dialog open={assignOpen} onOpenChange={(o) => { if (!assigning) setAssignOpen(o) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign / Reassign Lead</DialogTitle>
            <DialogDescription>
              {assignIds.length} lead(s) will be assigned to the selected executive. Sticky ownership moves with the lead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Executive</Label>
            <Select value={assignTarget} onValueChange={setAssignTarget} disabled={assigning}>
              <SelectTrigger aria-label="Select executive"><SelectValue placeholder="Select executive" /></SelectTrigger>
              <SelectContent>
                {execOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={assigning} onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={assigning || !assignTarget} onClick={() => submitAssign(assignIds)}>
              {assigning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultDept={user?.department ?? filters.dept ?? 'ONLINE'}
        onDone={() => setReloadKey((k) => k + 1)}
      />
    </div>
  )
}

// ---------- import dialog ----------

const HEADER_ALIASES: Record<string, string> = {
  customername: 'customerName', name: 'customerName', customer: 'customerName',
  mobile: 'mobile', phone: 'mobile', number: 'mobile',
  whatsapp: 'whatsapp', email: 'email', city: 'city',
  company: 'companyName', companyname: 'companyName',
  productinterest: 'productInterest', product: 'productInterest',
  notes: 'notes', note: 'notes', budget: 'budget', monthlyvolume: 'monthlyVolume',
}

function parseImportCsv(text: string): { rows: Record<string, string>[]; error: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return { rows: [], error: 'Paste at least one data row' }
  let headers: string[] | null = null
  const first = lines[0].toLowerCase().replace(/[\s_]/g, '')
  if (first.includes('customer') || first.includes('mobile') || first.includes('name')) {
    headers = lines[0].split(',').map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s_]/g, '')] ?? '')
    lines.shift()
  }
  const positional = ['customerName', 'mobile', 'email', 'city', 'productInterest', 'notes']
  const rows = lines.map((line) => {
    const cols = line.split(',').map((c) => c.trim())
    const row: Record<string, string> = {}
    if (headers) {
      headers.forEach((h, i) => {
        if (h && cols[i] !== undefined && cols[i] !== '') row[h] = cols[i]
      })
    } else {
      positional.forEach((h, i) => {
        if (cols[i] !== undefined && cols[i] !== '') row[h] = cols[i]
      })
    }
    return row
  })
  return { rows, error: null }
}

function ImportDialog({ open, onOpenChange, defaultDept, onDone }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDept: string
  onDone: () => void
}) {
  const { toast } = useToast()
  const [dept, setDept] = useState(defaultDept || 'ONLINE')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: { mobile?: string; reason: string }[] } | null>(null)

  useEffect(() => {
    if (open) {
      setResult(null)
      setDept(defaultDept || 'ONLINE')
    }
  }, [open, defaultDept])

  const parsed = text.trim() ? parseImportCsv(text) : { rows: [], error: null }

  const submit = async () => {
    if (parsed.error) {
      toast({ title: 'Cannot import', description: parsed.error, variant: 'destructive' })
      return
    }
    if (parsed.rows.length === 0) {
      toast({ title: 'Cannot import', description: 'No valid rows found', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      const res = await api<{ created: number; skipped: { mobile?: string; reason: string }[] }>('/api/leads/bulk', {
        method: 'POST',
        body: { department: dept, rows: parsed.rows },
      })
      setResult(res)
      toast({ title: 'Import finished', description: `${res.created} created, ${res.skipped.length} skipped` })
      onDone()
    } catch (e) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Leads</DialogTitle>
          <DialogDescription>
            Paste CSV rows. First line may be a header (customerName, mobile, email, city, productInterest, notes). Duplicate mobiles are skipped automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Department *</Label>
            <Select value={dept} onValueChange={setDept} disabled={submitting}>
              <SelectTrigger aria-label="Import department"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-csv">CSV data</Label>
            <Textarea
              id="import-csv"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={submitting}
              className="font-mono text-xs"
              placeholder={'customerName,mobile,city,productInterest\nRamesh Kumar,9876543210,Surat,Bridal lehenga\nPriya Exports,9876500001,Mumbai,Kurti set'}
            />
            {text.trim() ? (
              <p className={cn('text-xs', parsed.error ? 'text-rose-600' : 'text-emerald-700')}>
                {parsed.error ?? `${parsed.rows.length} row(s) parsed and ready to import`}
              </p>
            ) : null}
          </div>
          {result ? (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
              <p className="font-medium text-emerald-700">{result.created} lead(s) created</p>
              {result.skipped.length ? (
                <div className="mt-2 max-h-32 overflow-y-auto">
                  <p className="text-xs font-medium text-stone-500">Skipped:</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                    {result.skipped.map((s, i) => (
                      <li key={i}>{s.mobile || '—'} — {s.reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>Close</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={submitting || !text.trim()} onClick={submit}>
            {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Import {parsed.rows.length ? `${parsed.rows.length} rows` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
