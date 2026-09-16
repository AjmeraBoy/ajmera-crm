'use client'

/**
 * Settings → Communication → SIP / Dialer.
 * Secret handling mirrors WhatsAppSettingsView: the password field stays empty,
 * the placeholder shows the server-masked value; typing replaces, empty = unchanged.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, PhoneCall, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/client'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'

type StatusInfo = { status: string; lastCheck?: string | null; detail?: string | null }

type SipSettings = {
  whatsapp: Record<string, unknown>
  sip: {
    provider: string
    server: string
    username: string
    passwordMasked: string | null
    passwordSource: string | null
    hasPassword: boolean
    port: string | number
    transport: string
    outboundProxy: string
    callerId: string
    extension: string
    clickToCallUrl: string
    callActionUrl: string
  }
  waStatus: StatusInfo
  sipStatus: StatusInfo
}

export default function SipSettingsView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const canEdit = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role ?? '')

  const [data, setData] = useState<SipSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const [draft, setDraft] = useState({
    provider: '',
    server: '',
    username: '',
    port: '',
    transport: 'UDP',
    outboundProxy: '',
    callerId: '+91 261 354 7700',
    extension: '',
    clickToCallUrl: '',
    callActionUrl: '',
  })
  const [password, setPassword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<SipSettings>('/api/comm/settings')
      setData(res)
      const sip = res.sip ?? ({} as SipSettings['sip'])
      setDraft({
        provider: sip.provider ?? 'Alendei SIP',
        server: sip.server ?? '',
        username: sip.username ?? '',
        port: sip.port != null ? String(sip.port) : '',
        transport: sip.transport ?? 'UDP',
        outboundProxy: sip.outboundProxy ?? '',
        callerId: sip.callerId ?? '+91 261 354 7700',
        extension: sip.extension ?? '',
        clickToCallUrl: sip.clickToCallUrl ?? '',
        callActionUrl: sip.callActionUrl ?? '',
      })
    } catch (e) {
      toast({ title: 'Failed to load SIP settings', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const sip: Record<string, unknown> = {
        ...(draft.provider !== (data?.sip.provider ?? 'Alendei SIP') ? { provider: draft.provider } : {}),
        ...(draft.server !== (data?.sip.server ?? '') ? { server: draft.server } : {}),
        ...(draft.username !== (data?.sip.username ?? '') ? { username: draft.username } : {}),
        ...(password ? { password } : {}),
        ...(draft.port !== (data?.sip.port != null ? String(data.sip.port) : '') ? { port: Number(draft.port) || undefined } : {}),
        ...(draft.transport !== (data?.sip.transport ?? 'UDP') ? { transport: draft.transport } : {}),
        ...(draft.outboundProxy !== (data?.sip.outboundProxy ?? '') ? { outboundProxy: draft.outboundProxy } : {}),
        ...(draft.callerId !== (data?.sip.callerId ?? '') ? { callerId: draft.callerId } : {}),
        ...(draft.extension !== (data?.sip.extension ?? '') ? { extension: draft.extension } : {}),
        ...(draft.clickToCallUrl !== (data?.sip.clickToCallUrl ?? '') ? { clickToCallUrl: draft.clickToCallUrl } : {}),
        ...(draft.callActionUrl !== (data?.sip.callActionUrl ?? '') ? { callActionUrl: draft.callActionUrl } : {}),
      }
      await api('/api/comm/settings', { method: 'PUT', body: { sip } })
      setPassword('')
      toast({ title: 'SIP settings saved', description: 'Dialer credentials stored encrypted server-side.' })
      await load()
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const res = await api<{ target: string; status: string; detail: string }>('/api/comm/settings/test', {
        method: 'POST',
        body: { target: 'sip' },
      })
      if (res.status === 'CONNECTED') toast({ title: 'SIP registered', description: res.detail })
      else toast({ title: `SIP: ${res.status.replaceAll('_', ' ')}`, description: res.detail, variant: 'destructive' })
      await load()
    } catch (e) {
      toast({ title: 'SIP test failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setTesting(false)
    }
  }

  const set = (key: keyof typeof draft, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Communication — SIP / Dialer" subtitle="Click-to-call and call control configuration" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  const maskedPlaceholder = data?.sip?.passwordMasked
    ? `${data.sip.passwordMasked}${data.sip.passwordSource ? ` (from ${data.sip.passwordSource})` : ''}`
    : 'Not configured yet'

  return (
    <div className="space-y-4">
      <PageHeader
        title="Communication — SIP / Dialer"
        subtitle="Click-to-call dials through this trunk; call state streams back to agents in real time"
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-stone-400">SIP</span>
                <StatusBadge status={data?.sipStatus?.status || 'UNKNOWN'} variant="conn" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-64">
              <p className="font-medium">{data?.sipStatus?.detail || 'No health check has run yet'}</p>
              {data?.sipStatus?.lastCheck ? <p className="mt-1 text-xs opacity-70">Checked {formatDateTime(data.sipStatus.lastCheck)}</p> : null}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading} aria-label="Refresh status">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden /> Refresh Status
        </Button>
      </PageHeader>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600" aria-hidden>
            <PhoneCall className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-stone-900">SIP Trunk</h3>
            <p className="text-xs text-stone-500">Server registration and click-to-call API endpoints</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="sip-provider" className="text-xs font-medium text-stone-600">Provider</Label>
            <Input id="sip-provider" value={draft.provider} onChange={(e) => set('provider', e.target.value)} disabled={!canEdit || saving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sip-server" className="text-xs font-medium text-stone-600">SIP Server / Domain</Label>
            <Input id="sip-server" value={draft.server} onChange={(e) => set('server', e.target.value)} disabled={!canEdit || saving} placeholder="sip.provider.com" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sip-username" className="text-xs font-medium text-stone-600">Username</Label>
            <Input id="sip-username" value={draft.username} onChange={(e) => set('username', e.target.value)} disabled={!canEdit || saving} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sip-password" className="text-xs font-medium text-stone-600">Password</Label>
            <Input
              id="sip-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!canEdit || saving}
              autoComplete="new-password"
              placeholder={maskedPlaceholder}
            />
            <p className="text-[11px] text-stone-400">
              Stored encrypted server-side. Env var SIP_PASSWORD overrides this.{data?.sip?.hasPassword ? ' Leave empty to keep the current password.' : ''}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sip-port" className="text-xs font-medium text-stone-600">Port</Label>
            <Input id="sip-port" type="number" min={1} max={65535} value={draft.port} onChange={(e) => set('port', e.target.value)} disabled={!canEdit || saving} placeholder="5060" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-stone-600">Transport</Label>
            <div className="flex gap-1.5" role="radiogroup" aria-label="SIP transport">
              {['UDP', 'TCP', 'TLS'].map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={draft.transport === t}
                  disabled={!canEdit || saving}
                  onClick={() => set('transport', t)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                    draft.transport === t
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-400'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sip-proxy" className="text-xs font-medium text-stone-600">Outbound Proxy</Label>
            <Input id="sip-proxy" value={draft.outboundProxy} onChange={(e) => set('outboundProxy', e.target.value)} disabled={!canEdit || saving} placeholder="optional — sip:proxy:port" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sip-callerid" className="text-xs font-medium text-stone-600">Caller ID</Label>
            <Input id="sip-callerid" value={draft.callerId} onChange={(e) => set('callerId', e.target.value)} disabled={!canEdit || saving} placeholder="+91 261 354 7700" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sip-extension" className="text-xs font-medium text-stone-600">Default Extension</Label>
            <Input id="sip-extension" value={draft.extension} onChange={(e) => set('extension', e.target.value)} disabled={!canEdit || saving} placeholder="e.g. 1001" />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="sip-ctc" className="text-xs font-medium text-stone-600">Click-to-Call API URL</Label>
            <Input id="sip-ctc" value={draft.clickToCallUrl} onChange={(e) => set('clickToCallUrl', e.target.value)} disabled={!canEdit || saving} className="font-mono text-xs" placeholder="https://…/click_to_call?agent={agent}&customer={customer}&caller_id={caller_id}&server={server}" />
            <p className="text-[11px] text-stone-400">Template with {'{agent} {customer} {caller_id} {server}'} placeholders — filled per call.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="sip-action" className="text-xs font-medium text-stone-600">Call Action API URL</Label>
            <Input id="sip-action" value={draft.callActionUrl} onChange={(e) => set('callActionUrl', e.target.value)} disabled={!canEdit || saving} className="font-mono text-xs" placeholder="https://…/call_action?call_id={call_id}&action={action}&target={target}" />
            <p className="text-[11px] text-stone-400">Template with {'{call_id} {action} {target}'} placeholders — powers END / MUTE / HOLD / TRANSFER.</p>
          </div>
        </div>

        {canEdit ? (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-stone-100 pt-4">
            <Button size="sm" variant="outline" className="h-9" onClick={test} disabled={testing}>
              {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />}
              Test SIP
            </Button>
            <Button size="sm" className="h-9 bg-emerald-600 text-white hover:bg-emerald-700" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1 h-4 w-4" aria-hidden />}
              Save Settings
            </Button>
          </div>
        ) : (
          <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-400">Read-only for your role.</p>
        )}
      </section>

      {data?.sipStatus?.detail ? (
        <div
          className={cn(
            'rounded-xl border p-3 text-xs',
            data.sipStatus.status === 'CONNECTED'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : data.sipStatus.status === 'ERROR'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-stone-200 bg-stone-50 text-stone-600'
          )}
        >
          <p className="font-medium">Last health check — {formatDateTime(data.sipStatus.lastCheck)}</p>
          <p className="mt-0.5">{data.sipStatus.detail}</p>
        </div>
      ) : null}

      {loading && data ? (
        <p className="flex items-center gap-1.5 text-xs text-stone-400">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Refreshing…
        </p>
      ) : null}
    </div>
  )
}
