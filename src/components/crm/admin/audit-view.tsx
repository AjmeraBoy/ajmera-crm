'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, ScrollText, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/constants'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { PageHeader } from '@/components/crm/shared/page-header'

// ---------- types ----------

type AuditLogRow = {
  id: string
  createdAt: string
  userName: string | null
  user: { id: string; name: string; role: string } | null
  action: string
  entity: string | null
  entityId: string | null
  details: string | null
  ip: string | null
}

type AuditResponse = { logs: AuditLogRow[]; total: number; page: number; limit: number }

const PAGE_SIZE = 50

function actionClass(action: string): string {
  if (action.includes('CREATE')) return 'bg-emerald-100 text-emerald-700'
  if (action.includes('UPDATE') || action.includes('PATCH') || action.includes('UPSERT')) return 'bg-amber-100 text-amber-700'
  if (action.includes('DELETE')) return 'bg-rose-100 text-rose-700'
  if (action.includes('LOGIN') || action.includes('LOGOUT')) return 'bg-sky-100 text-sky-700'
  return 'bg-stone-100 text-stone-600'
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

// ---------- main view ----------

export default function AuditView() {
  const { toast } = useToast()

  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [qInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<AuditResponse>(`/api/audit${qs({ q: q || undefined, page, limit: PAGE_SIZE })}`)
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load audit logs', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [q, page, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const logs = data?.logs ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const exportCsv = () => {
    if (!logs.length) {
      toast({ title: 'Nothing to export', description: 'No audit events on this page.' })
      return
    }
    const rows = logs.map((l) => ({
      Time: formatDateTime(l.createdAt),
      User: l.user?.name ?? l.userName ?? '—',
      Role: l.user?.role ?? '',
      Action: l.action,
      Entity: l.entity ?? '',
      EntityId: l.entityId ?? '',
      Details: l.details ?? '',
      IP: l.ip ?? '',
    }))
    downloadCSV(`audit-logs-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast({ title: 'Export ready', description: `${rows.length} audit events exported.` })
  }

  const columns = useMemo<Column<AuditLogRow>[]>(
    () => [
      {
        key: 'createdAt',
        header: 'Time',
        render: (l) => <span className="whitespace-nowrap text-xs text-stone-500">{formatDateTime(l.createdAt)}</span>,
      },
      {
        key: 'user',
        header: 'User',
        render: (l) => {
          const name = l.user?.name ?? l.userName
          if (!name) return <span className="text-stone-400">System</span>
          return (
            <div className="flex items-center gap-2">
              <UserAvatar name={name} className="h-7 w-7 text-[10px]" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-800">{name}</p>
                {l.user?.role ? <p className="text-[11px] text-stone-400">{ROLE_LABELS[l.user.role] ?? l.user.role}</p> : null}
              </div>
            </div>
          )
        },
      },
      {
        key: 'action',
        header: 'Action',
        render: (l) => (
          <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', actionClass(l.action))}>
            {l.action}
          </span>
        ),
      },
      {
        key: 'entity',
        header: 'Entity',
        render: (l) => <span className="text-sm text-stone-600">{l.entity || '—'}</span>,
      },
      {
        key: 'entityId',
        header: 'Entity ID',
        render: (l) =>
          l.entityId ? (
            <code className="block max-w-[130px] truncate rounded bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] text-stone-500" title={l.entityId}>
              {truncate(l.entityId, 18)}
            </code>
          ) : (
            <span className="text-stone-400">—</span>
          ),
      },
      {
        key: 'details',
        header: 'Details',
        render: (l) =>
          l.details ? (
            <span className="block max-w-[260px] truncate text-xs text-stone-500" title={l.details}>
              {truncate(l.details, 70)}
            </span>
          ) : (
            <span className="text-stone-400">—</span>
          ),
      },
      {
        key: 'ip',
        header: 'IP',
        render: (l) => <span className="font-mono text-xs text-stone-500">{l.ip || '—'}</span>,
      },
    ],
    []
  )

  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Every important action across the CRM — who did what, when and from where">
        <Button variant="outline" size="sm" className="h-9" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </Button>
        <Button
          size="sm"
          className="h-9 bg-amber-500 text-white hover:bg-amber-600"
          onClick={exportCsv}
        >
          <Download className="mr-1 h-4 w-4" aria-hidden /> Export CSV
        </Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Events"
          value={total.toLocaleString('en-IN')}
          sub="Matching the current search"
          icon={<ScrollText className="h-5 w-5" aria-hidden />}
        />
      </div>

      <FilterBar>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search action, entity, user, details…"
            className="h-9 w-full min-w-[220px] bg-white pl-8 sm:w-72"
            aria-label="Search audit logs"
          />
        </div>
        <span className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-500">
          {PAGE_SIZE} events per page
        </span>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={logs}
        loading={loading}
        emptyMessage="No audit events found for this search"
        maxH="max-h-[620px]"
      />

      <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p className="text-xs text-stone-500">
          Showing {logs.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{(page - 1) * PAGE_SIZE + logs.length} of {total.toLocaleString('en-IN')} events
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
    </div>
  )
}
