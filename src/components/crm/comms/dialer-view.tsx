'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  ExternalLink,
  Loader2,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  Pin,
  RefreshCw,
  Timer,
} from 'lucide-react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { formatDateTime, formatDuration, formatINR, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PAYMENT_MODES, PAYMENT_MODE_LABELS } from '@/lib/constants'
import { dispositionExtra, useAppStore } from '@/store/app-store'
import { PageHeader } from '@/components/crm/shared/page-header'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { EmptyState } from '@/components/crm/shared/empty-state'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { useMasters } from '@/components/crm/shared/use-masters'

// ---------- types ----------

type LeadRow = {
  id: string
  leadCode: string
  department: string
  customerName: string
  companyName: string | null
  mobile: string
  stage: { id: string; label: string; extra: string | null } | null
  disposition: { id: string; label: string; extra: string | null } | null
  subDisposition: { id: string; label: string } | null
  priority: string | null
  estimatedValue: number | null
  nextFollowUpAt: string | null
  isSticky: boolean
  status: string
}

type LeadsResponse = {
  leads: LeadRow[]
  total: number
  page: number
  pageSize: number
}

type CallItem = {
  id: string
  lead: { id: string; leadCode: string; customerName: string; mobile: string; department: string } | null
  user: { id: string; name: string } | null
  direction: string
  status: string
  durationSec: number
  notes: string | null
  channel: string
  isVideo: boolean
  createdAt: string
}

type CallsResponse = {
  calls: CallItem[]
  total: number
  summary: {
    total: number
    incoming: number
    outgoing: number
    missed: number
    connected: number
    notConnected: number
    avgTalkTimeSec: number
  }
}

type DetailLead = {
  id: string
  leadCode: string
  department: string
  customerName: string
  companyName: string | null
  mobile: string
  whatsapp: string | null
  productInterest: string | null
  requirementNotes: string | null
  notes: string | null
  stage: { id: string; label: string; extra: string | null } | null
  disposition: { id: string; label: string; extra: string | null } | null
  subDisposition: { id: string; label: string } | null
  priority: string | null
  estimatedValue: number | null
  nextFollowUpAt: string | null
  lastContactAt: string | null
  isSticky: boolean
  status: string
}

type LeadBundle = {
  lead: DetailLead
  followups: Array<{ id: string; dueAt: string; status: string; note: string | null }>
  callLogs: CallItem[]
}

type PickerLead = { id: string; leadCode: string; customerName: string; mobile: string; department: string }

type QueueTab = 'overdue' | 'today' | 'mine'

const TABS: { id: QueueTab; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'mine', label: 'All Mine' },
]

// ---------- lead picker (searchable, debounced) ----------

function LeadPicker({ value, onSelect }: { value: PickerLead | null; onSelect: (l: PickerLead | null) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PickerLead[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (value) return
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      api<{ leads: PickerLead[] }>(`/api/leads${qs({ q: q || undefined, pageSize: 10 })}`)
        .then((res) => {
          if (!cancelled) setResults(res.leads ?? [])
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, value])

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-800">
            {value.customerName} <span className="font-mono text-xs text-stone-500">{value.leadCode}</span>
          </p>
          <p className="text-xs text-stone-500">
            {value.mobile} · {value.department}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>
          Change
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Input placeholder="Search lead by name / mobile / code..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-44 overflow-y-auto rounded-lg border border-stone-200">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-stone-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Searching...
          </div>
        ) : results.length === 0 ? (
          <p className="px-3 py-3 text-xs text-stone-500">No leads found</p>
        ) : (
          results.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelect(l)}
              className="flex w-full items-center justify-between gap-2 border-b border-stone-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-emerald-50"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium text-stone-800">{l.customerName}</span>{' '}
                <span className="font-mono text-xs text-stone-400">{l.leadCode}</span>
              </span>
              <span className="shrink-0 text-xs text-stone-500">{l.mobile}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ---------- component ----------

export default function DialerView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()

  const [summary, setSummary] = useState<CallsResponse['summary'] | null>(null)
  const [kpisLoading, setKpisLoading] = useState(true)

  const [tab, setTab] = useState<QueueTab>('overdue')
  const [queue, setQueue] = useState<LeadRow[]>([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [selected, setSelected] = useState<LeadRow | null>(null)
  const [bundle, setBundle] = useState<LeadBundle | null>(null)
  const [leadCalls, setLeadCalls] = useState<CallItem[]>([])
  const [panelLoading, setPanelLoading] = useState(false)

  // call modal
  const [callOpen, setCallOpen] = useState(false)
  const [phase, setPhase] = useState<'calling' | 'disposition'>('calling')
  const [seconds, setSeconds] = useState(0)
  const [endingCall, setEndingCall] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // disposition form
  const [dispId, setDispId] = useState('')
  const [subId, setSubId] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [estValue, setEstValue] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMode, setPayMode] = useState('UPI')
  const [dispNote, setDispNote] = useState('')
  const [savingDisp, setSavingDisp] = useState(false)

  // not-connected quick action
  const [notConnPending, setNotConnPending] = useState(false)

  // incoming call dialog
  const [incomingOpen, setIncomingOpen] = useState(false)
  const [incomingLead, setIncomingLead] = useState<PickerLead | null>(null)
  const [incomingStatus, setIncomingStatus] = useState('CONNECTED')
  const [incomingMins, setIncomingMins] = useState('2')
  const [incomingNotes, setIncomingNotes] = useState('')
  const [incomingPending, setIncomingPending] = useState(false)

  // today calls dialog
  const [callsOpen, setCallsOpen] = useState(false)
  const [callsStatus, setCallsStatus] = useState('')
  const [callsList, setCallsList] = useState<CallItem[]>([])
  const [callsLoading, setCallsLoading] = useState(false)

  const todayRange = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    return { from: start.toISOString(), to: end.toISOString() }
  }, [])

  // ---------- loaders ----------

  const loadKpis = useCallback(async () => {
    try {
      const res = await api<CallsResponse>(
        `/api/calls${qs({ from: todayRange.from, to: todayRange.to, page: 1, pageSize: 1 })}`
      )
      setSummary(res.summary)
    } catch (e) {
      toast({ title: 'Failed to load call stats', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setKpisLoading(false)
    }
  }, [todayRange, toast])

  const loadQueue = useCallback(async () => {
    setQueueLoading(true)
    try {
      const params =
        tab === 'overdue'
          ? { followup: 'overdue', sort: 'nextFollowUpAt', dir: 'asc' }
          : tab === 'today'
            ? { followup: 'today', sort: 'nextFollowUpAt', dir: 'asc' }
            : { assignedToId: user?.id, status: 'ACTIVE' }
      const res = await api<LeadsResponse>(`/api/leads${qs({ ...params, pageSize: 50 })}`)
      setQueue(res.leads ?? [])
    } catch (e) {
      toast({ title: 'Failed to load calling queue', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setQueueLoading(false)
    }
  }, [tab, user?.id, toast])

  useEffect(() => {
    loadKpis()
  }, [loadKpis, reloadKey])

  useEffect(() => {
    loadQueue()
  }, [loadQueue, reloadKey])

  const refreshAll = useCallback(() => setReloadKey((k) => k + 1), [])

  const openLeadPanel = useCallback(
    async (lead: LeadRow) => {
      setSelected(lead)
      setBundle(null)
      setLeadCalls([])
      setPanelLoading(true)
      const [callsRes, detailRes] = await Promise.allSettled([
        api<CallsResponse>(`/api/calls${qs({ leadId: lead.id, pageSize: 5 })}`),
        api<LeadBundle>(`/api/leads/detail${qs({ id: lead.id })}`),
      ])
      if (callsRes.status === 'fulfilled') setLeadCalls(callsRes.value.calls ?? [])
      if (detailRes.status === 'fulfilled') setBundle(detailRes.value)
      else
        toast({
          title: 'Failed to load lead history',
          description: detailRes.status === 'rejected' ? (detailRes.reason as Error).message : undefined,
          variant: 'destructive',
        })
      setPanelLoading(false)
    },
    [toast]
  )

  // ---------- call timer ----------

  useEffect(() => {
    if (!callOpen || phase !== 'calling') return
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [callOpen, phase])

  const panelLead = bundle?.lead ?? null
  const panelDept = panelLead?.department ?? selected?.department ?? user?.department ?? ''
  const dispositionOptions = useMemo(() => masters.items('disposition', panelDept || undefined), [masters, panelDept])
  const subOptions = useMemo(
    () => (dispId ? masters.subItems(dispId, panelDept || undefined) : []),
    [masters, dispId, panelDept]
  )
  const dispExtra = useMemo(() => dispositionExtra(masters.byId(dispId)?.extra), [masters, dispId])

  const resetDispForm = useCallback(() => {
    setDispId('')
    setSubId('')
    setCallbackAt('')
    setFollowUpAt('')
    setEstValue('')
    setPayAmount('')
    setPayMode('UPI')
    setDispNote('')
  }, [])

  const startCall = () => {
    setPhase('calling')
    setSeconds(0)
    resetDispForm()
    setCallOpen(true)
  }

  const endCall = async () => {
    if (!selected) return
    setEndingCall(true)
    try {
      await api('/api/calls', {
        method: 'POST',
        body: {
          leadId: selected.id,
          direction: 'OUTGOING',
          status: 'CONNECTED',
          durationSec: seconds,
        },
      })
      setPhase('disposition')
      refreshAll()
    } catch (e) {
      toast({ title: 'Failed to log call', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setEndingCall(false)
    }
  }

  const submitDisposition = async () => {
    if (!selected) return
    if (!dispId) {
      toast({ title: 'Select a disposition first', variant: 'destructive' })
      return
    }
    if (dispExtra.showCallback && !callbackAt) {
      toast({ title: 'Next Callback Date & Time is required', variant: 'destructive' })
      return
    }
    if (dispExtra.showFollowUp && !followUpAt) {
      toast({ title: 'Follow-up Date & Time is required', variant: 'destructive' })
      return
    }
    setSavingDisp(true)
    try {
      await api('/api/leads', {
        method: 'PATCH',
        body: {
          id: selected.id,
          dispositionUpdate: {
            dispositionId: dispId,
            subDispositionId: subId || undefined,
            callbackAt: dispExtra.showCallback ? callbackAt : undefined,
            followUpAt: dispExtra.showFollowUp ? followUpAt : undefined,
            estimatedValue: dispExtra.showEstimated && estValue ? Number(estValue) : undefined,
            paymentAmount: dispExtra.showPayment && payAmount ? Number(payAmount) : undefined,
            mode: dispExtra.showPayment ? payMode : undefined,
            note: dispNote || undefined,
          },
        },
      })
      toast({ title: 'Call saved', description: 'Call log + disposition updated' })
      setCallOpen(false)
      refreshAll()
      void openLeadPanel(selected)
    } catch (e) {
      toast({ title: 'Disposition failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingDisp(false)
    }
  }

  const quickNotConnected = async () => {
    if (!selected || notConnPending) return
    setNotConnPending(true)
    try {
      await api('/api/calls', {
        method: 'POST',
        body: { leadId: selected.id, direction: 'OUTGOING', status: 'NOT_CONNECTED', durationSec: 0 },
      })
      const nc = masters
        .items('disposition', selected.department)
        .find((d) => d.label.toLowerCase().includes('not connected'))
      if (nc) {
        await api('/api/leads', {
          method: 'PATCH',
          body: { id: selected.id, dispositionUpdate: { dispositionId: nc.id } },
        })
      }
      toast({ title: 'Not Connected call logged', description: `${selected.customerName} marked as not connected` })
      refreshAll()
      void openLeadPanel(selected)
    } catch (e) {
      toast({ title: 'Failed to log call', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setNotConnPending(false)
    }
  }

  const submitIncoming = async () => {
    if (!incomingLead) {
      toast({ title: 'Pick a lead for the incoming call', variant: 'destructive' })
      return
    }
    setIncomingPending(true)
    try {
      await api('/api/calls', {
        method: 'POST',
        body: {
          leadId: incomingLead.id,
          direction: 'INCOMING',
          status: incomingStatus,
          durationSec: incomingStatus === 'MISSED' ? 0 : Math.max(0, Number(incomingMins) || 0) * 60,
          notes: incomingNotes || undefined,
        },
      })
      toast({ title: 'Incoming call logged', description: `${incomingLead.customerName} — ${incomingStatus}` })
      setIncomingOpen(false)
      setIncomingLead(null)
      setIncomingNotes('')
      setIncomingMins('2')
      setIncomingStatus('CONNECTED')
      refreshAll()
    } catch (e) {
      toast({ title: 'Failed to log incoming call', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setIncomingPending(false)
    }
  }

  // ---------- today calls dialog ----------

  const loadCallsDialog = useCallback(async () => {
    if (!callsOpen) return
    setCallsLoading(true)
    try {
      const res = await api<CallsResponse>(
        `/api/calls${qs({
          from: todayRange.from,
          to: todayRange.to,
          status: callsStatus && callsStatus !== 'all' ? callsStatus : undefined,
          page: 1,
          pageSize: 50,
        })}`
      )
      setCallsList(res.calls ?? [])
    } catch (e) {
      toast({ title: 'Failed to load calls', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCallsLoading(false)
    }
  }, [callsOpen, callsStatus, todayRange, toast])

  useEffect(() => {
    loadCallsDialog()
  }, [loadCallsDialog])

  const callColumns: Column<CallItem>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'Time',
        render: (c) => <span className="whitespace-nowrap text-xs">{formatDateTime(c.createdAt)}</span>,
      },
      {
        key: 'lead',
        header: 'Lead',
        render: (c) =>
          c.lead ? (
            <div>
              <p className="font-medium text-stone-800">{c.lead.customerName}</p>
              <p className="text-xs text-stone-500">
                {c.lead.mobile} · {c.lead.department}
              </p>
            </div>
          ) : (
            <span className="text-stone-400">—</span>
          ),
      },
      { key: 'direction', header: 'Direction', render: (c) => <StatusBadge status={c.direction} variant="direction" /> },
      { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} variant="call" /> },
      { key: 'durationSec', header: 'Duration', render: (c) => <span>{formatDuration(c.durationSec)}</span> },
      { key: 'user', header: 'Agent', render: (c) => <span>{c.user?.name ?? '—'}</span> },
      {
        key: 'notes',
        header: 'Notes',
        render: (c) => <span className="line-clamp-2 max-w-[220px] text-xs text-stone-500">{c.notes ?? '—'}</span>,
      },
    ],
    []
  )

  // ---------- derived ----------

  const dailyTarget = user?.dailyCallTarget ?? null
  const callsProgress =
    dailyTarget && summary ? Math.min(100, Math.round((summary.total / dailyTarget) * 100)) : undefined

  const isOverdue = (d: string | null) => Boolean(d && new Date(d).getTime() < Date.now())

  // ---------- render ----------

  return (
    <div>
      <PageHeader title="Telecalling Dialer" subtitle="Work your calling queue — review old data before every call and log dispositions instantly">
        <Button variant="outline" onClick={refreshAll} aria-label="Refresh dialer">
          <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
        </Button>
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setIncomingOpen(true)}>
          <PhoneIncoming className="mr-1.5 h-4 w-4" /> Log Incoming Call
        </Button>
      </PageHeader>

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Calls Today"
          value={kpisLoading ? <Skeleton className="h-7 w-16" /> : (summary?.total ?? 0)}
          sub={dailyTarget ? `Daily target: ${dailyTarget} calls` : 'All calls logged today'}
          icon={<Phone className="h-4 w-4" />}
          progress={callsProgress}
          onClick={() => {
            setCallsStatus('')
            setCallsOpen(true)
          }}
        />
        <KpiCard
          label="Connected Today"
          value={kpisLoading ? <Skeleton className="h-7 w-16" /> : (summary?.connected ?? 0)}
          sub={`${summary?.outgoing ?? 0} outgoing · ${summary?.incoming ?? 0} incoming`}
          icon={<PhoneCall className="h-4 w-4" />}
          tone="positive"
          onClick={() => {
            setCallsStatus('CONNECTED')
            setCallsOpen(true)
          }}
        />
        <KpiCard
          label="Missed Today"
          value={kpisLoading ? <Skeleton className="h-7 w-16" /> : (summary?.missed ?? 0)}
          sub={`${summary?.notConnected ?? 0} not connected`}
          icon={<PhoneMissed className="h-4 w-4" />}
          tone="negative"
          onClick={() => {
            setCallsStatus('MISSED')
            setCallsOpen(true)
          }}
        />
        <KpiCard
          label="Avg Talk Time"
          value={kpisLoading ? <Skeleton className="h-7 w-16" /> : formatDuration(summary?.avgTalkTimeSec ?? 0)}
          sub="Across all calls today"
          icon={<Timer className="h-4 w-4" />}
          onClick={() => {
            setCallsStatus('')
            setCallsOpen(true)
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
        {/* Calling queue */}
        <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-stone-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-stone-800">Calling Queue</h2>
              <p className="text-xs text-stone-500">{queue.length} lead(s) in this bucket — tap a lead to open the call panel</p>
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as QueueTab)}>
              <TabsList>
                {TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="text-xs">
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="max-h-[560px] space-y-2 overflow-y-auto p-3">
            {queueLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
            ) : queue.length === 0 ? (
              <EmptyState
                icon={PhoneCall}
                title="Queue is clear"
                subtitle={
                  tab === 'overdue'
                    ? 'No overdue follow-ups. Great job!'
                    : tab === 'today'
                      ? 'No follow-ups due today. Switch to All Mine to keep dialing.'
                      : 'No active leads assigned to you yet.'
                }
              />
            ) : (
              queue.map((lead) => (
                <div
                  key={lead.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void openLeadPanel(lead)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') void openLeadPanel(lead)
                  }}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3 text-left transition-colors hover:bg-emerald-50/50',
                    selected?.id === lead.id ? 'border-emerald-400 bg-emerald-50/60' : 'border-stone-200 bg-white'
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-stone-800">{lead.customerName}</span>
                    {lead.companyName ? <span className="text-xs text-stone-500">· {lead.companyName}</span> : null}
                    {lead.isSticky ? <Pin className="h-3 w-3 text-amber-500" aria-label="Sticky lead" /> : null}
                    <StatusBadge status={lead.department} variant="dept" className="ml-auto" />
                    {lead.stage ? (
                      <Badge variant="outline" className="border-stone-200 font-medium text-stone-700">
                        {lead.stage.label}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">
                    <span className="font-mono text-stone-600">{lead.mobile}</span>
                    {lead.disposition ? <span>Disp: {lead.disposition.label}</span> : null}
                    {lead.nextFollowUpAt ? (
                      <span className={cn(isOverdue(lead.nextFollowUpAt) ? 'font-medium text-rose-600' : 'text-stone-500')}>
                        Follow-up: {formatDateTime(lead.nextFollowUpAt)}
                      </span>
                    ) : null}
                    {lead.estimatedValue ? (
                      <span className="font-medium text-emerald-700">Est: {formatINR(lead.estimatedValue, true)}</span>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Call panel — old data before calling */}
        <section
          className={cn(
            'rounded-xl border border-stone-200 bg-white shadow-sm lg:order-last',
            selected && 'order-first'
          )}
        >
          {!selected ? (
            <div className="p-4">
              <EmptyState
                icon={Phone}
                title="Select a lead from the queue"
                subtitle="The panel shows previous call logs, notes, disposition and requirement details BEFORE you dial — so you never call blind."
              />
            </div>
          ) : panelLoading || !panelLead ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="flex max-h-[640px] flex-col overflow-y-auto">
              <div className="border-b border-stone-100 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <UserAvatar name={panelLead.customerName} className="h-10 w-10 text-sm" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-base font-semibold text-stone-900">
                      {panelLead.customerName}
                      {panelLead.isSticky ? <Pin className="h-3.5 w-3.5 text-amber-500" aria-label="Sticky lead" /> : null}
                    </p>
                    <p className="font-mono text-xs text-stone-500">{panelLead.mobile}</p>
                  </div>
                  <StatusBadge status={panelLead.department} variant="dept" className="ml-auto" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <p className="text-stone-400">Lead</p>
                    <p className="font-mono font-medium text-stone-700">{panelLead.leadCode}</p>
                  </div>
                  <div>
                    <p className="text-stone-400">Stage</p>
                    <p className="font-medium text-stone-700">{panelLead.stage?.label ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-stone-400">Disposition</p>
                    <p className="font-medium text-stone-700">
                      {panelLead.disposition?.label ?? '—'}
                      {panelLead.subDisposition ? ` / ${panelLead.subDisposition.label}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-400">Estimated Value</p>
                    <p className="font-medium text-emerald-700">
                      {panelLead.estimatedValue ? formatINR(panelLead.estimatedValue) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-400">Next Follow-up</p>
                    <p className={cn('font-medium', isOverdue(panelLead.nextFollowUpAt) ? 'text-rose-600' : 'text-stone-700')}>
                      {panelLead.nextFollowUpAt ? formatDateTime(panelLead.nextFollowUpAt) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-stone-400">Last Contact</p>
                    <p className="font-medium text-stone-700">{timeAgo(panelLead.lastContactAt)}</p>
                  </div>
                </div>
                {panelLead.requirementNotes || panelLead.notes ? (
                  <div className="mt-3 rounded-lg bg-stone-50 p-2.5 text-xs text-stone-600">
                    <p className="mb-0.5 font-semibold text-stone-500">Requirements / Notes</p>
                    <p className="whitespace-pre-wrap">{panelLead.requirementNotes ?? panelLead.notes}</p>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    className="min-h-11 flex-1 bg-emerald-600 hover:bg-emerald-700"
                    onClick={startCall}
                  >
                    <Phone className="mr-1.5 h-4 w-4" /> Start Call
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={notConnPending}
                    onClick={() => void quickNotConnected()}
                  >
                    {notConnPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PhoneOff className="mr-1.5 h-4 w-4" />}
                    Not Connected
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => setView('lead-detail', { leadId: panelLead.id })}
                    aria-label="Open full lead details"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* last 5 call logs */}
              <div className="border-b border-stone-100 p-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <Phone className="h-3.5 w-3.5" /> Last {leadCalls.length} call{leadCalls.length === 1 ? '' : 's'}
                </h3>
                {leadCalls.length === 0 ? (
                  <p className="text-xs text-stone-400">No previous calls — this will be a fresh conversation.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {leadCalls.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 rounded-lg bg-stone-50 px-2.5 py-1.5 text-xs">
                        <StatusBadge status={c.direction} variant="direction" />
                        <StatusBadge status={c.status} variant="call" />
                        <span className="text-stone-600">{formatDuration(c.durationSec)}</span>
                        <span className="ml-auto shrink-0 text-stone-400">{formatDateTime(c.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* recent follow-ups */}
              <div className="p-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <CalendarClock className="h-3.5 w-3.5" /> Recent follow-ups
                </h3>
                {(bundle?.followups ?? []).length === 0 ? (
                  <p className="text-xs text-stone-400">No follow-ups recorded yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {(bundle?.followups ?? []).slice(0, 5).map((f) => (
                      <li key={f.id} className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={f.status} variant="followup" />
                          <span className="text-stone-600">{formatDateTime(f.dueAt)}</span>
                        </div>
                        {f.note ? <p className="mt-0.5 line-clamp-2 text-stone-500">{f.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Click-to-call modal */}
      <Dialog open={callOpen} onOpenChange={(o) => !o && setCallOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          {phase === 'calling' ? (
            <div className="flex flex-col items-center py-4 text-center">
              <div className="relative">
                <div className="absolute inset-0 animate-ping rounded-full bg-emerald-200" aria-hidden />
                <UserAvatar name={selected?.customerName} className="relative h-20 w-20 text-xl" />
              </div>
              <p className="mt-4 text-lg font-semibold text-stone-900">{selected?.customerName ?? 'Calling...'}</p>
              <p className="font-mono text-sm text-stone-500">{selected?.mobile}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-600">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden /> Calling...
              </p>
              <p className="mt-4 font-mono text-4xl font-bold tabular-nums text-stone-800" aria-live="polite">
                {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
              </p>
              <p className="mt-1 text-xs text-stone-400">Simulated call — duration is recorded in the CRM on end</p>
              <Button
                variant="destructive"
                size="lg"
                className="mt-5 min-h-11 w-full sm:w-auto"
                disabled={endingCall}
                onClick={() => void endCall()}
              >
                {endingCall ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PhoneOff className="mr-1.5 h-4 w-4" />}
                End Call &amp; Log
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Post-Call Disposition</DialogTitle>
                <DialogDescription>
                  {selected?.customerName} — call duration {formatDuration(seconds)}. Save the outcome to update the lead.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-1">
                <div className="space-y-1.5">
                  <Label>Disposition *</Label>
                  <Select value={dispId} onValueChange={setDispId} disabled={savingDisp}>
                    <SelectTrigger aria-label="Disposition">
                      <SelectValue placeholder="Select disposition" />
                    </SelectTrigger>
                    <SelectContent>
                      {dispositionOptions.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {dispId && subOptions.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label>Sub-disposition</Label>
                    <Select value={subId} onValueChange={setSubId} disabled={savingDisp}>
                      <SelectTrigger aria-label="Sub-disposition">
                        <SelectValue placeholder="Optional" />
                      </SelectTrigger>
                      <SelectContent>
                        {subOptions.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {dispExtra.showCallback ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="dialer-callback">Next Callback Date &amp; Time *</Label>
                    <Input
                      id="dialer-callback"
                      type="datetime-local"
                      value={callbackAt}
                      onChange={(e) => setCallbackAt(e.target.value)}
                    />
                  </div>
                ) : null}
                {dispExtra.showFollowUp ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="dialer-followup">Follow-up Date &amp; Time *</Label>
                    <Input
                      id="dialer-followup"
                      type="datetime-local"
                      value={followUpAt}
                      onChange={(e) => setFollowUpAt(e.target.value)}
                    />
                  </div>
                ) : null}
                {dispExtra.showEstimated ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="dialer-est">Estimated Order Value (₹)</Label>
                    <Input
                      id="dialer-est"
                      type="number"
                      min={0}
                      value={estValue}
                      onChange={(e) => setEstValue(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                ) : null}
                {dispExtra.showPayment ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="dialer-pay">Payment Amount (₹)</Label>
                      <Input
                        id="dialer-pay"
                        type="number"
                        min={0}
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Payment Mode</Label>
                      <Select value={payMode} onValueChange={setPayMode} disabled={savingDisp}>
                        <SelectTrigger aria-label="Payment mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {PAYMENT_MODE_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="dialer-note">Call Summary / Note</Label>
                  <Textarea
                    id="dialer-note"
                    rows={2}
                    value={dispNote}
                    onChange={(e) => setDispNote(e.target.value)}
                    placeholder="What did the customer say?"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCallOpen(false)} disabled={savingDisp}>
                  Later
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={savingDisp || !dispId}
                  onClick={() => void submitDisposition()}
                >
                  {savingDisp ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Save Disposition
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Log incoming call */}
      <Dialog open={incomingOpen} onOpenChange={setIncomingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log Incoming Call</DialogTitle>
            <DialogDescription>Record a customer who called you. Pick the lead, status and duration.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label>Lead *</Label>
              <LeadPicker value={incomingLead} onSelect={setIncomingLead} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={incomingStatus} onValueChange={setIncomingStatus} disabled={incomingPending}>
                  <SelectTrigger aria-label="Call status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONNECTED">Connected</SelectItem>
                    <SelectItem value="MISSED">Missed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="incoming-mins">Duration (minutes)</Label>
                <Input
                  id="incoming-mins"
                  type="number"
                  min={0}
                  value={incomingStatus === 'MISSED' ? '0' : incomingMins}
                  onChange={(e) => setIncomingMins(e.target.value)}
                  disabled={incomingPending || incomingStatus === 'MISSED'}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="incoming-notes">Notes</Label>
              <Textarea
                id="incoming-notes"
                rows={2}
                value={incomingNotes}
                onChange={(e) => setIncomingNotes(e.target.value)}
                placeholder="Why did they call?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncomingOpen(false)} disabled={incomingPending}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={incomingPending || !incomingLead}
              onClick={() => void submitIncoming()}
            >
              {incomingPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Log Call
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Today calls dialog */}
      <Dialog open={callsOpen} onOpenChange={setCallsOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Calls Today{callsStatus ? ` — ${callsStatus.replaceAll('_', ' ')}` : ''}</DialogTitle>
            <DialogDescription>All calls logged by you / your team today.</DialogDescription>
          </DialogHeader>
          <Select
            value={callsStatus}
            onValueChange={setCallsStatus}
            disabled={callsLoading}
          >
            <SelectTrigger className="w-44" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="CONNECTED">Connected</SelectItem>
              <SelectItem value="MISSED">Missed</SelectItem>
              <SelectItem value="NOT_CONNECTED">Not Connected</SelectItem>
            </SelectContent>
          </Select>
          <div className="max-h-[50vh] overflow-y-auto">
            <DataTable
              columns={callColumns}
              rows={callsList}
              loading={callsLoading}
              emptyMessage="No calls logged today yet"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
