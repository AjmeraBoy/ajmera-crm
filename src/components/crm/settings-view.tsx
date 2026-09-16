'use client'

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import {
  Building2,
  CalendarClock,
  Database,
  IndianRupee,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  Save,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { api } from '@/lib/client'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/crm/shared/page-header'
import { EmptyState } from '@/components/crm/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

type SettingsMap = Record<string, string>

type EditableSettings = {
  WORKING_DAYS: string
  AI_REMINDER_TRIGGER_MINUTES: string
  AI_REMINDER_VOICE: string
  AI_REMINDER_ENABLED: string
  AUTO_WELCOME_MESSAGE: string
  REPEAT_REMINDER_DAYS: string
}

const DEFAULT_DRAFT: EditableSettings = {
  WORKING_DAYS: '26',
  AI_REMINDER_TRIGGER_MINUTES: '60',
  AI_REMINDER_VOICE: '',
  AI_REMINDER_ENABLED: 'true',
  AUTO_WELCOME_MESSAGE: 'true',
  REPEAT_REMINDER_DAYS: '30',
}

function Card({
  title,
  subtitle,
  icon: Icon,
  children,
  className,
}: {
  title: string
  subtitle?: string
  icon: ComponentType<{ className?: string }>
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600" aria-hidden>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
            {subtitle ? <p className="text-xs text-stone-500">{subtitle}</p> : null}
          </div>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-stone-600">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-stone-400">{hint}</p> : null}
    </div>
  )
}

export default function SettingsView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'

  const [settings, setSettings] = useState<SettingsMap | null>(null)
  const [draft, setDraft] = useState<EditableSettings>(DEFAULT_DRAFT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api<{ settings: SettingsMap }>('/api/settings')
      setSettings(res.settings)
      setDraft({
        WORKING_DAYS: res.settings.WORKING_DAYS ?? DEFAULT_DRAFT.WORKING_DAYS,
        AI_REMINDER_TRIGGER_MINUTES: res.settings.AI_REMINDER_TRIGGER_MINUTES ?? DEFAULT_DRAFT.AI_REMINDER_TRIGGER_MINUTES,
        AI_REMINDER_VOICE: res.settings.AI_REMINDER_VOICE ?? '',
        AI_REMINDER_ENABLED: res.settings.AI_REMINDER_ENABLED ?? 'true',
        AUTO_WELCOME_MESSAGE: res.settings.AUTO_WELCOME_MESSAGE ?? 'true',
        REPEAT_REMINDER_DAYS: res.settings.REPEAT_REMINDER_DAYS ?? DEFAULT_DRAFT.REPEAT_REMINDER_DAYS,
      })
    } catch (e) {
      const msg = (e as Error).message || 'Failed to load settings'
      setError(msg)
      toast({ title: 'Failed to load settings', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const dirty =
    !!settings &&
    (draft.WORKING_DAYS !== (settings.WORKING_DAYS ?? '') ||
      draft.AI_REMINDER_TRIGGER_MINUTES !== (settings.AI_REMINDER_TRIGGER_MINUTES ?? '') ||
      draft.AI_REMINDER_VOICE !== (settings.AI_REMINDER_VOICE ?? '') ||
      draft.AI_REMINDER_ENABLED !== (settings.AI_REMINDER_ENABLED ?? 'true') ||
      draft.AUTO_WELCOME_MESSAGE !== (settings.AUTO_WELCOME_MESSAGE ?? 'true') ||
      draft.REPEAT_REMINDER_DAYS !== (settings.REPEAT_REMINDER_DAYS ?? ''))

  async function save() {
    setSaving(true)
    try {
      const res = await api<{ settings: SettingsMap }>('/api/settings', { method: 'PUT', body: { settings: draft } })
      setSettings(res.settings)
      toast({ title: 'Settings saved', description: 'Configuration updated successfully.' })
    } catch (e) {
      toast({ title: 'Could not save settings', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="System configuration" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={`sk-st-${i}`} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error && !settings) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="System configuration" />
        <EmptyState
          title="Could not load settings"
          subtitle={error}
          action={
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={`System configuration${canEdit ? ' — you can edit the highlighted fields' : ' — read-only for your role'}`}
      >
        {canEdit ? (
          <Button
            size="sm"
            className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={save}
            disabled={!dirty || saving}
          >
            <Save className="h-4 w-4" aria-hidden /> {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Company */}
        <Card title="Company Profile" subtitle="Read-only identity fields" icon={Building2}>
          <div className="space-y-4">
            <Field label="Company Name">
              <Input value={settings?.COMPANY_NAME ?? 'Ajmera Fashion Limited'} disabled readOnly />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Export SLA (hours)">
                <Input value={settings?.EXPORT_SLA_HOURS ?? '48'} disabled readOnly />
              </Field>
              <Field label="Working Days / Month" hint={canEdit ? 'Editable — used for daily target split' : 'Used for daily target split'}>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.WORKING_DAYS}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, WORKING_DAYS: e.target.value }))}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* Currency */}
        <Card title="Currency" subtitle="Single-currency system" icon={Wallet}>
          <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <span className="rounded-lg bg-white p-2 text-lg font-bold text-emerald-700" aria-hidden>₹</span>
            <div>
              <p className="text-sm font-semibold text-stone-900">Indian Rupees (₹ INR) — fixed</p>
              <p className="text-xs text-stone-500">
                All amounts are in Indian Rupees (₹) system-wide — no multi-currency.
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Currency Code">
              <Input value={settings?.CURRENCY ?? 'INR'} disabled readOnly />
            </Field>
            <Field label="Symbol">
              <Input value={settings?.CURRENCY_SYMBOL ?? '₹'} disabled readOnly />
            </Field>
          </div>
        </Card>

        {/* AI Visit Reminder */}
        <Card title="AI Visit Reminder" subtitle="Automated reminder calls for Online-department visits" icon={PhoneCall}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
              <div>
                <p className="text-sm font-medium text-stone-800">Enabled</p>
                <p className="text-xs text-stone-500">Places AI reminder calls before scheduled visits</p>
              </div>
              <Switch
                checked={draft.AI_REMINDER_ENABLED === 'true'}
                disabled={!canEdit}
                aria-label="AI visit reminder enabled"
                onCheckedChange={(v) => setDraft((d) => ({ ...d, AI_REMINDER_ENABLED: v ? 'true' : 'false' }))}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Trigger (minutes before visit)">
                <Input
                  type="number"
                  min={5}
                  max={720}
                  value={draft.AI_REMINDER_TRIGGER_MINUTES}
                  disabled={!canEdit}
                  onChange={(e) => setDraft((d) => ({ ...d, AI_REMINDER_TRIGGER_MINUTES: e.target.value }))}
                />
              </Field>
              <Field label="Voice" hint="Recorded voice persona used for calls">
                <Input
                  value={draft.AI_REMINDER_VOICE}
                  disabled={!canEdit}
                  placeholder="Ajay Sir (Recorded)"
                  onChange={(e) => setDraft((d) => ({ ...d, AI_REMINDER_VOICE: e.target.value }))}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* Automation */}
        <Card title="Automation" subtitle="WhatsApp & follow-up automation" icon={Sparkles}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-stone-200 p-3">
              <div>
                <p className="text-sm font-medium text-stone-800">Auto Welcome Message</p>
                <p className="text-xs text-stone-500">Send a WhatsApp welcome when a new lead is created</p>
              </div>
              <Switch
                checked={draft.AUTO_WELCOME_MESSAGE === 'true'}
                disabled={!canEdit}
                aria-label="Auto welcome message enabled"
                onCheckedChange={(v) => setDraft((d) => ({ ...d, AUTO_WELCOME_MESSAGE: v ? 'true' : 'false' }))}
              />
            </div>
            <Field label="Repeat Customer Reminder (days)" hint="Remind to re-contact customers after this many days">
              <Input
                type="number"
                min={1}
                max={365}
                value={draft.REPEAT_REMINDER_DAYS}
                disabled={!canEdit}
                onChange={(e) => setDraft((d) => ({ ...d, REPEAT_REMINDER_DAYS: e.target.value }))}
              />
            </Field>
          </div>
        </Card>

        {/* Integrations */}
        <Card title="Integrations" subtitle="Communication channels — demo mode" icon={MessageCircle}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 p-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-emerald-600" aria-hidden />
                <p className="text-sm font-medium text-stone-800">WhatsApp Business API</p>
              </div>
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                {settings?.WHATSAPP_API_PROVIDER ?? 'WABA (Demo Mode)'}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 p-3">
              <div className="flex items-center gap-2">
                <PhoneCall className="h-4 w-4 text-teal-600" aria-hidden />
                <p className="text-sm font-medium text-stone-800">Calling / Dialer API</p>
              </div>
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                {settings?.CALLING_API_PROVIDER ?? 'CRM Dialer (Demo Mode)'}
              </Badge>
            </div>
            <p className="text-[11px] text-stone-400">
              Providers are simulated in this build — calls and messages are logged for demo purposes only.
            </p>
          </div>
        </Card>

        {/* Master data pointer */}
        <Card title="Master Data" subtitle="Stages, dispositions, geo & more" icon={Database}>
          <p className="text-sm text-stone-600">
            Dynamic master data (pipeline stages, dispositions, countries, states, couriers, ticket types, etc.) is
            managed under <span className="font-semibold text-stone-800">Administration → Master Data</span>.
          </p>
          <Separator className="my-3" />
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            Working days drive the “Today’s Target” split on dashboards and target views.
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
            <IndianRupee className="h-3.5 w-3.5" aria-hidden />
            Amounts are stored as whole ₹ integers with Indian digit grouping.
          </div>
        </Card>
      </div>
    </div>
  )
}
