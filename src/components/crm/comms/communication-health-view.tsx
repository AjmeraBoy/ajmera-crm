'use client'

/**
 * Communication Health dashboard — live status of WhatsApp API, SIP trunk,
 * webhook receiver, database and the real-time relay, plus 24h traffic stats.
 * Auto-refreshes every 30s and re-fetches on 'health:update' socket events.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Database,
  Loader2,
  MessageSquareDot,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Webhook,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/client'
import { formatDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useCrmSocket, getCrmSocket } from '@/hooks/use-crm-socket'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'

type Health = {
  whatsapp: { status: string; businessNumber?: string | null; provider?: string | null; lastCheck?: string | null; lastCheckDetail?: string | null }
  sip: { status: string; provider?: string | null; server?: string | null; lastCheck?: string | null }
  webhook: { active: boolean; lastReceivedAt?: string | null; url?: string | null }
  database: { connected: boolean }
  socket: { ok: boolean; connections: number; uptimeSec: number }
  stats: {
    waMessagesToday: number
    callsToday: number
    missedCalls24h: number
    apiFailures24h: number
    webhookEvents24h: number
    webhookFailed: number
  }
}

type TestTarget = 'whatsapp' | 'sip' | 'webhook' | 'database'
type TestResult = { target: TestTarget; status: string; detail: string; at: string }

const MANAGEMENT_ROLES = ['TEAM_LEADER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']

const TEST_LABELS: Record<TestTarget, string> = {
  whatsapp: 'WhatsApp API',
  sip: 'SIP Trunk',
  webhook: 'Webhook',
  database: 'Database',
}

export default function CommunicationHealthView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const socketLive = useCrmSocket()

  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<TestTarget | null>(null)
  const [results, setResults] = useState<Record<string, TestResult>>({})

  const canTest = MANAGEMENT_ROLES.includes(user?.role ?? '')

  const load = useCallback(async () => {
    try {
      const res = await api<Health>('/api/comm/health')
      setHealth(res)
    } catch (e) {
      // Health endpoint may not be deployed yet (backend in progress) — surface quietly
      toast({ title: 'Health data unavailable', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  // auto-refresh every 30s
  useEffect(() => {
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  // live push, if the relay emits health:update
  useEffect(() => {
    const s = getCrmSocket()
    const onUpdate = () => void load()
    s.on('health:update', onUpdate)
    return () => {
      s.off('health:update', onUpdate)
    }
  }, [load])

  const runTest = async (target: TestTarget) => {
    setTesting(target)
    try {
      const res = await api<{ target: string; status: string; detail: string }>('/api/comm/health/test', {
        method: 'POST',
        body: { target, ...(target === 'webhook' ? { origin: window.location.origin } : {}) },
      })
      setResults((prev) => ({ ...prev, [target]: { ...res, target, at: new Date().toISOString() } as TestResult }))
      if (res.status === 'CONNECTED' || res.status === 'OK' || res.status === 'ACTIVE') {
        toast({ title: `${TEST_LABELS[target]}: OK`, description: res.detail })
      } else {
        toast({ title: `${TEST_LABELS[target]}: ${res.status.replaceAll('_', ' ')}`, description: res.detail, variant: 'destructive' })
      }
      void load()
    } catch (e) {
      toast({ title: `${TEST_LABELS[target]} test failed`, description: (e as Error).message, variant: 'destructive' })
    } finally {
      setTesting(null)
    }
  }

  const statusTone = (status?: string | null) =>
    status === 'CONNECTED' || status === 'ACTIVE' || status === 'OK'
      ? 'positive'
      : status === 'ERROR' || status === 'FAILED'
        ? 'negative'
        : 'warning'

  if (loading && !health) {
    return (
      <div>
        <PageHeader title="Communication Health" subtitle="Live status of the WhatsApp, calling and webhook pipelines" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`sk-h-${i}`} className="h-40 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const stats = health?.stats
  const cards: Array<{
    key: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    tone: 'positive' | 'warning' | 'negative'
    badge: string
    lines: Array<string | null | undefined>
    detail?: string | null
  }> = [
    {
      key: 'whatsapp',
      label: 'WhatsApp API',
      icon: MessageSquareDot,
      tone: statusTone(health?.whatsapp?.status) as 'positive' | 'warning' | 'negative',
      badge: health?.whatsapp?.status || 'UNKNOWN',
      lines: [health?.whatsapp?.businessNumber, health?.whatsapp?.provider],
      detail: health?.whatsapp?.lastCheckDetail,
    },
    {
      key: 'sip',
      label: 'SIP / Dialer',
      icon: PhoneCall,
      tone: statusTone(health?.sip?.status) as 'positive' | 'warning' | 'negative',
      badge: health?.sip?.status || 'UNKNOWN',
      lines: [health?.sip?.server, health?.sip?.provider],
    },
    {
      key: 'webhook',
      label: 'Webhook Receiver',
      icon: Webhook,
      tone: health?.webhook?.active ? 'positive' : 'warning',
      badge: health?.webhook?.active ? 'ACTIVE' : 'INACTIVE',
      lines: [health?.webhook?.url, health?.webhook?.lastReceivedAt ? `Last event ${timeAgo(health.webhook.lastReceivedAt)}` : 'No events received yet'],
    },
    {
      key: 'database',
      label: 'Database',
      icon: Database,
      tone: health?.database?.connected ? 'positive' : 'negative',
      badge: health?.database?.connected ? 'CONNECTED' : 'ERROR',
      lines: ['Prisma / SQLite'],
    },
    {
      key: 'socket',
      label: 'Real-time Service',
      icon: Activity,
      tone: health?.socket?.ok || socketLive ? 'positive' : 'warning',
      badge: health?.socket?.ok || socketLive ? 'CONNECTED' : 'NOT_CONNECTED',
      lines: [
        `${health?.socket?.connections ?? 0} live connection(s)`,
        health?.socket?.uptimeSec != null ? `Relay up ${Math.floor(health.socket.uptimeSec / 60)}m` : null,
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Communication Health"
        subtitle="Live status of WhatsApp API, SIP dialer, webhook, database and real-time relay — refreshes every 30s"
      >
        <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading} aria-label="Refresh health">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden /> Refresh
        </Button>
      </PageHeader>

      {/* status cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <div key={c.key} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600" aria-hidden>
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="text-sm font-semibold text-stone-900">{c.label}</h3>
                </div>
                <StatusBadge status={c.badge} variant="conn" />
              </div>
              <div className="mt-3 space-y-1">
                {c.lines.filter(Boolean).map((line, i) => (
                  <p key={i} className="truncate text-xs text-stone-500" title={line ?? undefined}>
                    {line}
                  </p>
                ))}
              </div>
              {results[c.key] ? (
                <p
                  className={cn(
                    'mt-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
                    ['CONNECTED', 'OK', 'ACTIVE'].includes(results[c.key].status)
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  )}
                >
                  {results[c.key].detail} <span className="opacity-60">({timeAgo(results[c.key].at)})</span>
                </p>
              ) : c.detail ? (
                <p className="mt-2 line-clamp-2 text-[11px] text-stone-400" title={c.detail}>{c.detail}</p>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* 24h stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="WA Messages Today" value={stats?.waMessagesToday ?? 0} icon={<MessageSquareDot className="h-4 w-4" />} />
        <KpiCard label="Calls Today" value={stats?.callsToday ?? 0} icon={<PhoneCall className="h-4 w-4" />} />
        <KpiCard
          label="Missed Calls (24h)"
          value={stats?.missedCalls24h ?? 0}
          tone={(stats?.missedCalls24h ?? 0) > 0 ? 'warning' : 'default'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <KpiCard
          label="API Failures (24h)"
          value={stats?.apiFailures24h ?? 0}
          tone={(stats?.apiFailures24h ?? 0) > 0 ? 'negative' : 'default'}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <KpiCard label="Webhook Events (24h)" value={stats?.webhookEvents24h ?? 0} icon={<Webhook className="h-4 w-4" />} />
        <KpiCard
          label="Unrecognized Webhooks"
          value={stats?.webhookFailed ?? 0}
          tone={(stats?.webhookFailed ?? 0) > 0 ? 'warning' : 'default'}
          icon={<Webhook className="h-4 w-4" />}
        />
      </div>

      {/* test buttons */}
      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">Run a check now</h3>
            <p className="text-xs text-stone-500">
              {canTest
                ? 'Pings each pipeline without sending customer messages (webhook test posts your current origin).'
                : 'Only management roles can trigger live checks.'}
            </p>
          </div>
          {canTest ? (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TEST_LABELS) as TestTarget[]).map((target) => (
                <Button
                  key={target}
                  size="sm"
                  variant="outline"
                  className="h-9"
                  disabled={testing !== null}
                  onClick={() => runTest(target)}
                  aria-label={`Test ${TEST_LABELS[target]}`}
                >
                  {testing === target ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
                  Test {TEST_LABELS[target]}
                </Button>
              ))}
            </div>
          ) : (
            <Badge variant="outline" className="border-stone-200 text-stone-500">Read-only</Badge>
          )}
        </div>
      </section>

      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="flex items-center gap-1.5 text-xs text-stone-400">
              <span
                className={cn('inline-block h-2 w-2 rounded-full', socketLive ? 'bg-emerald-500' : 'bg-stone-300')}
                aria-hidden
              />
              Real-time relay {socketLive ? 'connected' : 'connecting…'} — you are in room <code className="font-mono">call</code> + <code className="font-mono">whatsapp</code>
            </p>
          </TooltipTrigger>
          <TooltipContent>Socket.io relay on :3003 — incoming call popups, live chat and call state ride on this connection.</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
