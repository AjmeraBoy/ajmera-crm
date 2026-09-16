'use client'

/**
 * Provider diagnostics: outbound API call logs, campaign send attempts and
 * inbound webhook events. Technical detail lives in tooltips / expandable
 * payload viewers — the main columns stay readable.
 */

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'

// ---------- types ----------

type ApiLogRow = {
  id: string
  provider: string
  endpoint: string
  method: string
  requestId: string | null
  responseCode: number | null
  durationMs: number | null
  success: boolean
  errorType: string | null
  errorMessage: string | null
  readableError: string | null
  leadId: string | null
  userId: string | null
  attempt: number
  createdAt: string
}

type CampaignLogRow = {
  id: string
  requestId: string
  campaignName: string
  destination: string
  templateName: string | null
  leadId: string | null
  userId: string | null
  success: boolean
  providerMessageId: string | null
  errorMessage: string | null
  createdAt: string
  lead?: { id: string; leadCode: string; customerName: string } | null
  user?: { id: string; name: string } | null
}

type WebhookEventRow = {
  id: string
  provider: string
  eventType: string
  processingStatus: string
  phoneNumber: string | null
  leadId: string | null
  payload: string
  error: string | null
  receivedAt: string
  processedAt: string | null
}

const PAGE_SIZE = 15

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <div className="flex items-center justify-between text-xs text-stone-500">
      <span>
        Page {page} of {pages} — {total} record(s)
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" className="h-8" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

function prettyPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export default function ApiLogsView() {
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()

  // --- API logs ---
  const [tab, setTab] = useState('api')
  const [provider, setProvider] = useState('__all__')
  const [success, setSuccess] = useState('__all__')
  const [logs, setLogs] = useState<ApiLogRow[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(1)
  const [logsLoading, setLogsLoading] = useState(true)

  // --- campaign logs ---
  const [campaigns, setCampaigns] = useState<CampaignLogRow[]>([])
  const [campaignsTotal, setCampaignsTotal] = useState(0)
  const [campaignsPage, setCampaignsPage] = useState(1)
  const [campaignsLoading, setCampaignsLoading] = useState(false)

  // --- webhook events ---
  const [whStatus, setWhStatus] = useState('__all__')
  const [events, setEvents] = useState<WebhookEventRow[]>([])
  const [eventsTotal, setEventsTotal] = useState(0)
  const [eventsPage, setEventsPage] = useState(1)
  const [eventsLoading, setEventsLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const loadApiLogs = useCallback(
    async (page = logsPage) => {
      setLogsLoading(true)
      try {
        const res = await api<{ logs: ApiLogRow[]; total: number }>(
          `/api/comm/api-logs${qs({
            provider: provider === '__all__' ? undefined : provider,
            success: success === '__all__' ? undefined : success === 'yes' ? '1' : '0',
            page,
            pageSize: PAGE_SIZE,
          })}`
        )
        setLogs(res.logs ?? [])
        setLogsTotal(res.total ?? 0)
      } catch (e) {
        toast({ title: 'Failed to load API logs', description: (e as Error).message, variant: 'destructive' })
      } finally {
        setLogsLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, success, toast]
  )

  const loadCampaignLogs = useCallback(
    async (page = campaignsPage) => {
      setCampaignsLoading(true)
      try {
        const res = await api<{ logs: CampaignLogRow[]; total: number }>(`/api/comm/campaign-logs${qs({ page, pageSize: PAGE_SIZE })}`)
        setCampaigns(res.logs ?? [])
        setCampaignsTotal(res.total ?? 0)
      } catch (e) {
        toast({ title: 'Failed to load campaign logs', description: (e as Error).message, variant: 'destructive' })
      } finally {
        setCampaignsLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast]
  )

  const loadEvents = useCallback(
    async (page = eventsPage) => {
      setEventsLoading(true)
      try {
        const res = await api<{ events: WebhookEventRow[]; total: number }>(
          `/api/comm/webhook-events${qs({ status: whStatus === '__all__' ? undefined : whStatus, page, pageSize: PAGE_SIZE })}`
        )
        setEvents(res.events ?? [])
        setEventsTotal(res.total ?? 0)
      } catch (e) {
        toast({ title: 'Failed to load webhook events', description: (e as Error).message, variant: 'destructive' })
      } finally {
        setEventsLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whStatus, toast]
  )

  useEffect(() => {
    loadApiLogs(1)
    setLogsPage(1)
  }, [loadApiLogs])

  useEffect(() => {
    if (tab === 'campaigns') {
      loadCampaignLogs(1)
      setCampaignsPage(1)
    }
    if (tab === 'webhooks') {
      loadEvents(1)
      setEventsPage(1)
    }
  }, [tab, loadCampaignLogs, loadEvents])

  const refreshCurrent = () => {
    if (tab === 'api') loadApiLogs(logsPage)
    if (tab === 'campaigns') loadCampaignLogs(campaignsPage)
    if (tab === 'webhooks') loadEvents(eventsPage)
  }

  const apiColumns: Column<ApiLogRow>[] = [
    { key: 'createdAt', header: 'Time', render: (r) => <span className="whitespace-nowrap text-xs text-stone-500">{formatDateTime(r.createdAt)}</span> },
    { key: 'provider', header: 'Provider', render: (r) => <Badge variant="outline" className="border-stone-200 text-[10px] text-stone-600">{r.provider}</Badge> },
    {
      key: 'endpoint',
      header: 'Request',
      render: (r) => (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block max-w-56 truncate font-mono text-xs text-stone-600">
                {r.method} {r.endpoint}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-md">
              <p className="font-mono text-xs">{r.method} {r.endpoint}</p>
              {r.requestId ? <p className="mt-1 font-mono text-[10px] opacity-70">requestId: {r.requestId}</p> : null}
              {r.errorMessage ? <p className="mt-1 text-[10px] opacity-80">detail: {r.errorMessage}</p> : null}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
    },
    { key: 'responseCode', header: 'Code', className: 'text-center', render: (r) => <span className={cn('text-xs font-semibold', r.success ? 'text-emerald-700' : 'text-rose-600')}>{r.responseCode ?? '—'}</span> },
    { key: 'durationMs', header: 'Took', className: 'text-center', render: (r) => <span className="text-xs text-stone-500">{r.durationMs != null ? `${r.durationMs}ms` : '—'}</span> },
    { key: 'attempt', header: 'Try', className: 'text-center', render: (r) => <span className="text-xs text-stone-500">#{r.attempt}</span> },
    {
      key: 'error',
      header: 'Error',
      render: (r) =>
        r.success ? (
          <span className="text-xs text-stone-400">—</span>
        ) : (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex max-w-56 items-center gap-1.5">
                  {r.errorType ? <StatusBadge status={r.errorType} variant="errType" /> : null}
                  <span className="truncate text-xs text-stone-600">{r.readableError ?? r.errorType ?? 'Failed'}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-md">
                <p className="text-xs font-medium">{r.readableError ?? 'Request failed'}</p>
                {r.errorMessage ? <p className="mt-1 break-words font-mono text-[10px] opacity-80">{r.errorMessage}</p> : null}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ),
    },
  ]

  const campaignColumns: Column<CampaignLogRow>[] = [
    { key: 'createdAt', header: 'Time', render: (r) => <span className="whitespace-nowrap text-xs text-stone-500">{formatDateTime(r.createdAt)}</span> },
    { key: 'campaignName', header: 'Campaign', render: (r) => <span className="text-sm font-medium text-stone-800">{r.campaignName}</span> },
    { key: 'destination', header: 'Destination', render: (r) => <span className="font-mono text-xs text-stone-600">{r.destination}</span> },
    { key: 'templateName', header: 'Template', render: (r) => <span className="text-xs text-stone-600">{r.templateName ?? '—'}</span> },
    { key: 'success', header: 'Result', render: (r) => (r.success ? <StatusBadge status="SENT" variant="conn" /> : <StatusBadge status="FAILED" variant="errType" />) },
    { key: 'providerMessageId', header: 'Provider Msg ID', render: (r) => <span className="block max-w-40 truncate font-mono text-[10px] text-stone-500" title={r.providerMessageId ?? ''}>{r.providerMessageId ?? '—'}</span> },
    { key: 'error', header: 'Error', render: (r) => <span className="block max-w-52 truncate text-xs text-rose-600" title={r.errorMessage ?? ''}>{r.errorMessage ?? '—'}</span> },
    {
      key: 'lead',
      header: 'Lead',
      render: (r) =>
        r.lead ? (
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline" onClick={() => setView('lead-detail', { leadId: r.lead!.id })}>
            {r.lead.leadCode} <ExternalLink className="h-3 w-3" aria-hidden />
          </button>
        ) : (
          <span className="text-xs text-stone-400">—</span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="API Logs"
        subtitle="Every outbound provider call, campaign send and inbound webhook — for debugging delivery issues"
      >
        <Button size="sm" variant="outline" className="h-9" onClick={refreshCurrent} aria-label="Refresh logs">
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </Button>
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-white">
          <TabsTrigger value="api">API Logs</TabsTrigger>
          <TabsTrigger value="campaigns">Campaign Logs</TabsTrigger>
          <TabsTrigger value="webhooks">Webhook Events</TabsTrigger>
        </TabsList>

        {/* ---------- API LOGS ---------- */}
        <TabsContent value="api" className="space-y-3">
          <FilterBar>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v)
              }}
            >
              <SelectTrigger className="h-9 w-full bg-white sm:w-48" aria-label="Filter by provider">
                <SelectValue placeholder="All providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All providers</SelectItem>
                <SelectItem value="WHATSAPP_ALENDEI">WhatsApp (Alendei)</SelectItem>
                <SelectItem value="SIP">SIP / Dialer</SelectItem>
                <SelectItem value="INTERNAL">Internal</SelectItem>
              </SelectContent>
            </Select>
            <Select value={success} onValueChange={setSuccess}>
              <SelectTrigger className="h-9 w-full bg-white sm:w-40" aria-label="Filter by result">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All results</SelectItem>
                <SelectItem value="yes">Successful only</SelectItem>
                <SelectItem value="no">Failed only</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>

          <DataTable columns={apiColumns} rows={logs} loading={logsLoading} emptyMessage="No API calls logged yet" maxH="max-h-[560px]" />
          <Pager page={logsPage} total={logsTotal} onPage={(p) => { setLogsPage(p); loadApiLogs(p) }} />
        </TabsContent>

        {/* ---------- CAMPAIGN LOGS ---------- */}
        <TabsContent value="campaigns" className="space-y-3">
          <DataTable columns={campaignColumns} rows={campaigns} loading={campaignsLoading} emptyMessage="No campaign sends logged yet" maxH="max-h-[560px]" />
          <Pager page={campaignsPage} total={campaignsTotal} onPage={(p) => { setCampaignsPage(p); loadCampaignLogs(p) }} />
        </TabsContent>

        {/* ---------- WEBHOOK EVENTS ---------- */}
        <TabsContent value="webhooks" className="space-y-3">
          <FilterBar>
            <Select value={whStatus} onValueChange={setWhStatus}>
              <SelectTrigger className="h-9 w-full bg-white sm:w-48" aria-label="Filter by processing status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="PROCESSED">Processed</SelectItem>
                <SelectItem value="DUPLICATE">Duplicate</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="UNRECOGNIZED">Unrecognized</SelectItem>
                <SelectItem value="RECEIVED">Received</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>

          <div className="w-full overflow-auto rounded-xl border border-stone-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <th className="w-8 px-3 py-2.5"></th>
                  <th className="px-3 py-2.5">Time</th>
                  <th className="px-3 py-2.5">Provider</th>
                  <th className="px-3 py-2.5">Event</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Phone</th>
                  <th className="px-3 py-2.5">Error</th>
                </tr>
              </thead>
              <tbody>
                {eventsLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="border-t border-stone-100">
                      <td colSpan={7} className="px-3 py-3">
                        <div className="h-4 w-full max-w-md animate-pulse rounded bg-stone-100" />
                      </td>
                    </tr>
                  ))
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-stone-500">No webhook events yet</td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <WebhookRow key={ev.id} ev={ev} expanded={expanded === ev.id} onToggle={() => setExpanded((x) => (x === ev.id ? null : ev.id))} />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pager page={eventsPage} total={eventsTotal} onPage={(p) => { setEventsPage(p); loadEvents(p) }} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function WebhookRow({ ev, expanded, onToggle }: { ev: WebhookEventRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-stone-100 transition-colors hover:bg-stone-50" onClick={onToggle}>
        <td className="px-3 py-2.5 text-stone-400" aria-hidden>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-stone-500">{formatDateTime(ev.receivedAt)}</td>
        <td className="px-3 py-2.5"><Badge variant="outline" className="border-stone-200 text-[10px] text-stone-600">{ev.provider}</Badge></td>
        <td className="px-3 py-2.5 text-xs font-medium text-stone-700">{ev.eventType}</td>
        <td className="px-3 py-2.5"><StatusBadge status={ev.processingStatus} variant="proc" /></td>
        <td className="px-3 py-2.5 font-mono text-xs text-stone-600">{ev.phoneNumber ?? '—'}</td>
        <td className="px-3 py-2.5"><span className="block max-w-52 truncate text-xs text-rose-600" title={ev.error ?? ''}>{ev.error ?? '—'}</span></td>
      </tr>
      {expanded ? (
        <tr className="border-t border-stone-100 bg-stone-50/70">
          <td colSpan={7} className="px-3 py-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Raw payload</p>
            <pre className="max-h-64 overflow-auto rounded-lg border border-stone-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-stone-700">
              {prettyPayload(ev.payload)}
            </pre>
            {ev.processedAt ? <p className="mt-1.5 text-[11px] text-stone-400">Processed {formatDateTime(ev.processedAt)}</p> : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}
