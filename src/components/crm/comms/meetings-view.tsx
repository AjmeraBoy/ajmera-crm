'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Video,
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
import { formatDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DEPARTMENTS, MEETING_OUTCOMES } from '@/lib/constants'
import { useAppStore } from '@/store/app-store'
import { PageHeader } from '@/components/crm/shared/page-header'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { EmptyState } from '@/components/crm/shared/empty-state'

// ---------- types ----------

type PickerLead = { id: string; leadCode: string; customerName: string; mobile: string; department: string }

type MeetingRow = {
  id: string
  title: string
  scheduledAt: string
  link: string | null
  outcome: string | null
  notes: string | null
  followUpAction: string | null
  lead: { id: string; leadCode: string; customerName: string; department: string }
  executive: { id: string; name: string } | null
}

type MeetingTab = 'upcoming' | 'past' | 'all'

const OUTCOME_COLORS: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  NO_SHOW: 'bg-rose-100 text-rose-700 border-rose-200',
  RESCHEDULED: 'bg-amber-100 text-amber-700 border-amber-200',
  INTERESTED: 'bg-teal-100 text-teal-700 border-teal-200',
  NOT_INTERESTED: 'bg-stone-100 text-stone-600 border-stone-200',
}

function isToday(d: string): boolean {
  const t = new Date(d).getTime()
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return t >= start.getTime() && t <= end.getTime()
}

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

export default function MeetingsView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  const [dept, setDept] = useState(user?.department ?? '')
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [tab, setTab] = useState<MeetingTab>('upcoming')

  // schedule dialog
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [sLead, setSLead] = useState<PickerLead | null>(null)
  const [sTitle, setSTitle] = useState('')
  const [sWhen, setSWhen] = useState('')
  const [sLink, setSLink] = useState('')
  const [scheduling, setScheduling] = useState(false)

  // outcome dialog
  const [outcomeMeeting, setOutcomeMeeting] = useState<MeetingRow | null>(null)
  const [oOutcome, setOOutcome] = useState('')
  const [oNotes, setONotes] = useState('')
  const [oFollowUp, setOFollowUp] = useState('')
  const [savingOutcome, setSavingOutcome] = useState(false)

  // ---------- loaders ----------

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ meetings: MeetingRow[] }>(
        `/api/meetings${qs({ dept: dept && dept !== 'all' ? dept : undefined })}`
      )
      setMeetings(res.meetings ?? [])
    } catch (e) {
      toast({ title: 'Failed to load meetings', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [dept, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // ---------- derived lists ----------

  const { upcoming, past } = useMemo(() => {
    const now = Date.now()
    const up: MeetingRow[] = []
    const p: MeetingRow[] = []
    for (const m of meetings) {
      if (new Date(m.scheduledAt).getTime() >= now) up.push(m)
      else p.push(m)
    }
    up.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    p.sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    return { upcoming: up, past: p }
  }, [meetings])

  const kpis = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const scheduledToday = meetings.filter((m) => {
      const t = new Date(m.scheduledAt).getTime()
      return t >= start.getTime() && t <= end.getTime()
    }).length
    const completed = meetings.filter((m) => Boolean(m.outcome)).length
    return { scheduledToday, upcoming: upcoming.length, completed }
  }, [meetings, upcoming.length])

  const rows = tab === 'upcoming' ? upcoming : tab === 'past' ? past : meetings

  // ---------- actions ----------

  const scheduleMeeting = async () => {
    if (!sLead) {
      toast({ title: 'Pick a lead for the meeting', variant: 'destructive' })
      return
    }
    if (!sTitle.trim()) {
      toast({ title: 'Meeting title is required', variant: 'destructive' })
      return
    }
    if (!sWhen) {
      toast({ title: 'Pick a date & time', variant: 'destructive' })
      return
    }
    const scheduledAt = new Date(sWhen)
    if (isNaN(scheduledAt.getTime())) {
      toast({ title: 'Invalid date & time', variant: 'destructive' })
      return
    }
    setScheduling(true)
    try {
      await api('/api/meetings', {
        method: 'POST',
        body: {
          leadId: sLead.id,
          title: sTitle.trim(),
          scheduledAt: scheduledAt.toISOString(),
          link: sLink.trim() || undefined,
        },
      })
      toast({ title: 'Meeting scheduled', description: `${sTitle.trim()} with ${sLead.customerName}` })
      setScheduleOpen(false)
      setSLead(null)
      setSTitle('')
      setSWhen('')
      setSLink('')
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Schedule failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setScheduling(false)
    }
  }

  const openOutcome = useCallback((m: MeetingRow) => {
    setOutcomeMeeting(m)
    setOOutcome(m.outcome ?? '')
    setONotes(m.notes ?? '')
    setOFollowUp(m.followUpAction ?? '')
  }, [])

  const saveOutcome = async () => {
    if (!outcomeMeeting) return
    if (!oOutcome) {
      toast({ title: 'Select an outcome', variant: 'destructive' })
      return
    }
    setSavingOutcome(true)
    try {
      await api('/api/meetings', {
        method: 'PATCH',
        body: {
          id: outcomeMeeting.id,
          outcome: oOutcome,
          notes: oNotes.trim() || undefined,
          followUpAction: oFollowUp.trim() || undefined,
        },
      })
      toast({ title: 'Outcome recorded', description: `${outcomeMeeting.title} — ${oOutcome}` })
      setOutcomeMeeting(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Failed to record outcome', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingOutcome(false)
    }
  }

  // ---------- table ----------

  const columns: Column<MeetingRow>[] = useMemo(
    () => [
      {
        key: 'title',
        header: 'Meeting',
        render: (m) => (
          <div className="min-w-[160px]">
            <p className="font-medium text-stone-800">{m.title}</p>
            {m.notes ? <p className="max-w-[200px] truncate text-xs text-stone-500">{m.notes}</p> : null}
          </div>
        ),
      },
      {
        key: 'lead',
        header: 'Lead',
        render: (m) => (
          <div className="min-w-[140px]">
            <button
              type="button"
              className="font-medium text-emerald-700 hover:underline"
              onClick={(e) => {
                e.stopPropagation()
                setView('lead-detail', { leadId: m.lead.id })
              }}
            >
              {m.lead.customerName}
            </button>
            <p className="font-mono text-xs text-stone-500">{m.lead.leadCode}</p>
          </div>
        ),
      },
      {
        key: 'scheduledAt',
        header: 'When',
        render: (m) => (
          <div className="min-w-[150px]">
            <p className={cn('whitespace-nowrap text-sm', isToday(m.scheduledAt) && 'font-semibold text-emerald-700')}>
              {formatDateTime(m.scheduledAt)}
            </p>
            <p className="text-xs text-stone-400">{timeAgo(m.scheduledAt)}</p>
          </div>
        ),
      },
      {
        key: 'link',
        header: 'Join',
        render: (m) =>
          m.link ? (
            <a
              href={m.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
            >
              Google Meet <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : (
            <span className="text-stone-400">—</span>
          ),
      },
      { key: 'executive', header: 'Executive', render: (m) => <span className="whitespace-nowrap">{m.executive?.name ?? '—'}</span> },
      {
        key: 'outcome',
        header: 'Outcome',
        render: (m) =>
          m.outcome ? (
            <Badge variant="outline" className={cn('whitespace-nowrap font-medium', OUTCOME_COLORS[m.outcome] ?? '')}>
              {m.outcome.replaceAll('_', ' ')}
            </Badge>
          ) : (
            <span className="text-xs text-stone-400">Pending</span>
          ),
      },
      {
        key: 'followUpAction',
        header: 'Follow-up',
        render: (m) => <span className="max-w-[160px] truncate text-xs text-stone-600">{m.followUpAction ?? '—'}</span>,
      },
      {
        key: 'actions',
        header: '',
        className: 'w-10',
        render: (m) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              className="h-8 whitespace-nowrap px-2 text-xs"
              onClick={() => openOutcome(m)}
              aria-label={`Record outcome for ${m.title}`}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Outcome
            </Button>
          </div>
        ),
      },
    ],
    [openOutcome, setView]
  )

  // ---------- render ----------

  return (
    <div>
      <PageHeader
        title="Video Consultations"
        subtitle="Schedule Google Meet sessions with leads and record the outcome of every consultation"
      >
        <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh meetings">
          <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
        </Button>
        <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setScheduleOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Schedule Meeting
        </Button>
      </PageHeader>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Scheduled Today"
          value={loading ? <Skeleton className="h-7 w-16" /> : kpis.scheduledToday}
          sub="Meetings happening today"
          icon={<CalendarDays className="h-4 w-4" />}
          onClick={() => setTab('upcoming')}
        />
        <KpiCard
          label="Upcoming"
          value={loading ? <Skeleton className="h-7 w-16" /> : kpis.upcoming}
          sub="Scheduled from now on"
          icon={<CalendarClock className="h-4 w-4" />}
          tone="positive"
          onClick={() => setTab('upcoming')}
        />
        <KpiCard
          label="Completed"
          value={loading ? <Skeleton className="h-7 w-16" /> : kpis.completed}
          sub="Outcome recorded"
          icon={<CalendarCheck className="h-4 w-4" />}
          onClick={() => setTab('past')}
        />
      </div>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as MeetingTab)}>
            <TabsList>
              <TabsTrigger value="upcoming" className="text-xs">
                Upcoming
              </TabsTrigger>
              <TabsTrigger value="past" className="text-xs">
                Past
              </TabsTrigger>
              <TabsTrigger value="all" className="text-xs">
                All
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {isAdmin ? (
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="w-44" aria-label="Department filter">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {rows.length === 0 && !loading ? (
          <EmptyState
            icon={Video}
            title={tab === 'upcoming' ? 'No upcoming meetings' : tab === 'past' ? 'No past meetings' : 'No meetings yet'}
            subtitle="Schedule a video consultation with a lead to guide them through the catalogue and close faster."
            action={
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setScheduleOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Schedule Meeting
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            emptyMessage="No meetings in this view"
            onRowClick={(m) => setView('lead-detail', { leadId: m.lead.id })}
          />
        )}
      </section>

      {/* Schedule meeting dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Meeting</DialogTitle>
            <DialogDescription>
              A Google Meet link is generated automatically if you leave the link field empty.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label>Lead *</Label>
              <LeadPicker value={sLead} onSelect={setSLead} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-title">Title *</Label>
              <Input
                id="m-title"
                value={sTitle}
                onChange={(e) => setSTitle(e.target.value)}
                placeholder="e.g. Saree catalogue walkthrough"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-when">Date &amp; Time *</Label>
              <Input id="m-when" type="datetime-local" value={sWhen} onChange={(e) => setSWhen(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-link">Meeting Link (optional)</Label>
              <Input id="m-link" value={sLink} onChange={(e) => setSLink(e.target.value)} placeholder="https://meet.google.com/..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)} disabled={scheduling}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={scheduling} onClick={() => void scheduleMeeting()}>
              {scheduling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Video className="mr-1.5 h-4 w-4" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record outcome dialog */}
      <Dialog open={Boolean(outcomeMeeting)} onOpenChange={(o) => !o && setOutcomeMeeting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Meeting Outcome</DialogTitle>
            <DialogDescription>
              {outcomeMeeting ? `${outcomeMeeting.title} — ${outcomeMeeting.lead.customerName}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5">
              <Label>Outcome *</Label>
              <Select value={oOutcome} onValueChange={setOOutcome} disabled={savingOutcome}>
                <SelectTrigger aria-label="Outcome">
                  <SelectValue placeholder="Select outcome" />
                </SelectTrigger>
                <SelectContent>
                  {MEETING_OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o.replaceAll('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-notes">Notes</Label>
              <Textarea
                id="m-notes"
                rows={3}
                value={oNotes}
                onChange={(e) => setONotes(e.target.value)}
                placeholder="What was discussed? Products shown, objections, next steps..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-followup">Follow-up Action</Label>
              <Input
                id="m-followup"
                value={oFollowUp}
                onChange={(e) => setOFollowUp(e.target.value)}
                placeholder="e.g. Send quotation for 2 designs by tomorrow"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutcomeMeeting(null)} disabled={savingOutcome}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={savingOutcome || !oOutcome} onClick={() => void saveOutcome()}>
              {savingOutcome ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Save Outcome
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
