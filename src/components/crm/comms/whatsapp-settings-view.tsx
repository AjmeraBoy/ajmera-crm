'use client'

/**
 * Settings → Communication → WhatsApp (Alendei live API).
 * Secrets are NEVER rendered — the API key input stays empty; the placeholder
 * shows the server-masked value. Only type a new key to replace it.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, MessageSquareDot, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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

type CommSettings = {
  whatsapp: {
    provider: string
    baseUrl: string
    apiKeyMasked: string | null
    apiKeySource: string | null
    hasApiKey: boolean
    businessNumber: string
    defaultCampaign: string
  }
  sip: Record<string, unknown>
  waStatus: StatusInfo
  sipStatus: StatusInfo
  webhook: { url: string; secret: string | null; active: boolean; lastReceivedAt: string | null }
}

function StatusCell({ status, label, info }: { status: string; label: string; info?: StatusInfo }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</span>
            <StatusBadge status={status || 'UNKNOWN'} variant="conn" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-64">
          <p className="font-medium">{info?.detail || 'No health check has run yet'}</p>
          {info?.lastCheck ? <p className="mt-1 text-xs opacity-70">Checked {formatDateTime(info.lastCheck)}</p> : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default function WhatsAppSettingsView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const canEdit = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role ?? '')

  const [data, setData] = useState<CommSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [revealSecret, setRevealSecret] = useState(false)
  const [copied, setCopied] = useState(false)

  // draft — apiKey is only sent when the user actually typed one ('' = unchanged)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [businessNumber, setBusinessNumber] = useState('')
  const [defaultCampaign, setDefaultCampaign] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<CommSettings>('/api/comm/settings')
      setData(res)
      setBaseUrl(res.whatsapp?.baseUrl ?? '')
      setBusinessNumber(res.whatsapp?.businessNumber ?? '')
      setDefaultCampaign(res.whatsapp?.defaultCampaign ?? '')
    } catch (e) {
      toast({ title: 'Failed to load communication settings', description: (e as Error).message, variant: 'destructive' })
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
      const body: Record<string, unknown> = {
        whatsapp: {
          ...(baseUrl !== (data?.whatsapp.baseUrl ?? '') ? { baseUrl } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(businessNumber !== (data?.whatsapp.businessNumber ?? '') ? { businessNumber } : {}),
          ...(defaultCampaign !== (data?.whatsapp.defaultCampaign ?? '') ? { defaultCampaign } : {}),
        },
      }
      await api('/api/comm/settings', { method: 'PUT', body })
      setApiKey('')
      toast({ title: 'WhatsApp settings saved', description: 'Stored encrypted server-side.' })
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
        body: { target: 'whatsapp' },
      })
      if (res.status === 'CONNECTED') toast({ title: 'WhatsApp API connected', description: res.detail })
      else toast({ title: `WhatsApp API: ${res.status.replaceAll('_', ' ')}`, description: res.detail, variant: 'destructive' })
      await load()
    } catch (e) {
      toast({ title: 'Connection test failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setTesting(false)
    }
  }

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(data?.webhook?.url ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Copy failed', description: 'Select the URL and copy manually.', variant: 'destructive' })
    }
  }

  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Communication — WhatsApp" subtitle="Alendei WhatsApp Business API configuration" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={`sk-wa-${i}`} className="h-72 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const maskedPlaceholder = data?.whatsapp?.apiKeyMasked
    ? `${data.whatsapp.apiKeyMasked}${data.whatsapp.apiKeySource ? ` (from ${data.whatsapp.apiKeySource})` : ''}`
    : 'Not configured yet'

  return (
    <div className="space-y-4">
      <PageHeader
        title="Communication — WhatsApp"
        subtitle="Alendei (FlexiWaba) live API — credentials are encrypted at rest and never displayed again"
      >
        <StatusCell status={data?.waStatus?.status ?? ''} label="API" info={data?.waStatus} />
        <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading} aria-label="Refresh status">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden /> Refresh Status
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* API credentials */}
        <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex items-center gap-2.5">
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600" aria-hidden>
              <MessageSquareDot className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-stone-900">WhatsApp Business API</h3>
              <p className="text-xs text-stone-500">Messages, templates and broadcasts are sent through this API</p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-600">Provider</Label>
              <Input value={data?.whatsapp?.provider ?? 'Alendei'} readOnly disabled />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wa-base-url" className="text-xs font-medium text-stone-600">API Base URL</Label>
              <Input
                id="wa-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={!canEdit || saving}
                placeholder="https://live.alendei.com/v1"
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wa-api-key" className="text-xs font-medium text-stone-600">API Key</Label>
              <Input
                id="wa-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!canEdit || saving}
                autoComplete="new-password"
                placeholder={maskedPlaceholder}
              />
              <p className="flex items-start gap-1 text-[11px] text-stone-400">
                <KeyRound className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Stored encrypted server-side. Env var WHATSAPP_API_KEY overrides this.
                {data?.whatsapp?.hasApiKey ? ' Leave empty to keep the current key.' : ''}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-number" className="text-xs font-medium text-stone-600">Business WhatsApp Number</Label>
                <Input
                  id="wa-number"
                  value={businessNumber}
                  onChange={(e) => setBusinessNumber(e.target.value)}
                  disabled={!canEdit || saving}
                  placeholder="+91 261 354 7700"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-campaign" className="text-xs font-medium text-stone-600">Default Campaign Name</Label>
                <Input
                  id="wa-campaign"
                  value={defaultCampaign}
                  onChange={(e) => setDefaultCampaign(e.target.value)}
                  disabled={!canEdit || saving}
                  placeholder="Ajmera Live API campaign"
                />
              </div>
            </div>
          </div>

          {canEdit ? (
            <div className="mt-5 flex flex-wrap gap-2 border-t border-stone-100 pt-4">
              <Button size="sm" variant="outline" className="h-9" onClick={test} disabled={testing}>
                {testing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />}
                Test Connection
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

        {/* Webhook */}
        <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600" aria-hidden>
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-stone-900">Inbound Webhook</h3>
                <p className="text-xs text-stone-500">Point the provider here to receive delivery receipts &amp; replies</p>
              </div>
            </div>
            <StatusBadge status={data?.webhook?.active ? 'ACTIVE' : 'INACTIVE'} variant="conn" />
          </div>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-600">Webhook URL</Label>
              <div className="flex gap-2">
                <Input value={data?.webhook?.url ?? ''} readOnly disabled className="font-mono text-xs" />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  aria-label="Copy webhook URL"
                  onClick={copyWebhookUrl}
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                </Button>
              </div>
              <p className="text-[11px] text-stone-400">Copy this URL into the Alendei / Meta webhook configuration.</p>
            </div>

            {data?.webhook?.lastReceivedAt ? (
              <p className="text-xs text-stone-500">Last event received: {formatDateTime(data.webhook.lastReceivedAt)}</p>
            ) : (
              <p className="text-xs text-stone-400">No webhook events received yet.</p>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-stone-600">Webhook Secret</Label>
              <div className="flex gap-2">
                <Input
                  value={isSuperAdmin && revealSecret ? (data?.webhook?.secret ?? '') : '••••••••••••••••'}
                  readOnly
                  disabled
                  className="font-mono text-xs"
                />
                {isSuperAdmin ? (
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9 shrink-0"
                    aria-label={revealSecret ? 'Hide webhook secret' : 'Reveal webhook secret'}
                    onClick={() => setRevealSecret((v) => !v)}
                  >
                    {revealSecret ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </Button>
                ) : null}
              </div>
              <p className="text-[11px] text-stone-400">
                {isSuperAdmin
                  ? 'Visible to Super Admin only. Share securely with the provider when configuring the webhook.'
                  : 'Only the last 4 characters are stored masked — Super Admin can reveal it.'}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Health hint */}
      {data?.waStatus?.detail ? (
        <div
          className={cn(
            'rounded-xl border p-3 text-xs',
            data.waStatus.status === 'CONNECTED'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : data.waStatus.status === 'ERROR'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-stone-200 bg-stone-50 text-stone-600'
          )}
        >
          <p className="font-medium">Last health check — {formatDateTime(data.waStatus.lastCheck)}</p>
          <p className="mt-0.5">{data.waStatus.detail}</p>
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
