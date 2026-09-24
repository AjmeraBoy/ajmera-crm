'use client'

/**
 * Automation rules engine UI — WHEN (trigger + conditions) THEN (actions).
 * Server stores conditions/actions as JSON strings; the editor works on
 * structured rows and serialises on submit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { formatDateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { EmptyState } from '@/components/crm/shared/empty-state'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'

// ---------- types ----------

type Rule = {
  id: string
  name: string
  trigger: string
  dept: string | null
  conditions: string | null
  actions: string
  isActive: boolean
  lastRunAt: string | null
  runCount: number
  createdAt: string
  updatedAt: string
}

type RuleResponse = { rules?: Rule[] } & Record<string, unknown>

type Condition = { field: string; op: string; value: string }

type ActionDraft = {
  type: string
  templateId: string
  params: string[]
  title: string
  dueInHours: string
  message: string
  field: string
  value: string
}

type RuleLog = {
  id: string
  ruleId: string
  leadId?: string | null
  trigger: string
  status: string
  detail: string | null
  createdAt: string
  rule?: { id: string; name: string }
}

type LeadSearchRow = {
  id: string
  leadCode: string
  customerName: string
  mobile: string
  department: string
  status: string
}

type TemplateLite = {
  id: string
  name: string
  variableCount: number
  variables: string | null
  status: string
  isActive: boolean
}

const TRIGGERS = [
  'LEAD_CREATED',
  'LEAD_ASSIGNED',
  'LEAD_STATUS_CHANGED',
  'FOLLOWUP_DUE',
  'CALL_MISSED',
  'CALL_COMPLETED',
  'INBOUND_WHATSAPP',
  'WHATSAPP_FAILED',
] as const

const TRIGGER_LABELS: Record<string, string> = {
  LEAD_CREATED: 'Lead Created',
  LEAD_ASSIGNED: 'Lead Assigned',
  LEAD_STATUS_CHANGED: 'Lead Status Changed',
  FOLLOWUP_DUE: 'Follow-up Due',
  CALL_MISSED: 'Call Missed',
  CALL_COMPLETED: 'Call Completed',
  INBOUND_WHATSAPP: 'Inbound WhatsApp',
  WHATSAPP_FAILED: 'WhatsApp Failed',
}

const OPS = ['eq', 'neq', 'contains', 'in', 'gt', 'lt'] as const

const ACTION_TYPES = ['SEND_WHATSAPP_TEMPLATE', 'CREATE_TASK', 'NOTIFY_AGENT', 'UPDATE_LEAD_FIELD'] as const

const ACTION_LABELS: Record<string, string> = {
  SEND_WHATSAPP_TEMPLATE: 'Send WhatsApp Template',
  CREATE_TASK: 'Create Task',
  NOTIFY_AGENT: 'Notify Agent',
  UPDATE_LEAD_FIELD: 'Update Lead Field',
}

const UPDATE_FIELDS = ['priority', 'notes', 'customerType'] as const

function emptyAction(): ActionDraft {
  return { type: 'NOTIFY_AGENT', templateId: '', params: [], title: '', dueInHours: '24', message: '', field: 'priority', value: '' }
}

function parseConditions(json: string | null): Condition[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((c) => c && typeof c === 'object' && c.field)
      .map((c: Record<string, unknown>) => ({ field: String(c.field ?? ''), op: String(c.op ?? 'eq'), value: String(c.value ?? '') }))
  } catch {
    return []
  }
}

function parseActions(json: string): ActionDraft[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr.map((a: Record<string, unknown>) => ({
      type: String(a.type ?? 'NOTIFY_AGENT'),
      templateId: String(a.templateId ?? ''),
      params: Array.isArray(a.params) ? a.params.map(String) : [],
      title: String(a.title ?? ''),
      dueInHours: String(a.dueInHours ?? '24'),
      message: String(a.message ?? ''),
      field: String(a.field ?? 'priority'),
      value: String(a.value ?? ''),
    }))
  } catch {
    return []
  }
}

export default function AutomationsView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // editor dialog
  const [editorOpen, setEditorOpen] = useState(false)
  const [editRule, setEditRule] = useState<Rule | null>(null)
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<string>('LEAD_CREATED')
  const [dept, setDept] = useState('__all__')
  const [conditions, setConditions] = useState<Condition[]>([])
  const [actions, setActions] = useState<ActionDraft[]>([emptyAction()])
  const [active, setActive] = useState(false)
  const [saving, setSaving] = useState(false)

  // templates for the WA action editor
  const [templates, setTemplates] = useState<TemplateLite[]>([])

  // run dialog
  const [runRule, setRunRule] = useState<Rule | null>(null)
  const [runQ, setRunQ] = useState('')
  const [runLeads, setRunLeads] = useState<LeadSearchRow[]>([])
  const [runSearching, setRunSearching] = useState(false)
  const [runResults, setRunResults] = useState<string[] | null>(null)
  const [runPending, setRunPending] = useState(false)

  // logs sheet
  const [logsRule, setLogsRule] = useState<Rule | null>(null)
  const [logs, setLogs] = useState<RuleLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // delete
  const [deleteRule, setDeleteRule] = useState<Rule | null>(null)
  const [deleting, setDeleting] = useState(false)

  const canManage = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<RuleResponse>('/api/automations')
      setRules(Array.isArray(res) ? (res as unknown as Rule[]) : (res.rules ?? []))
    } catch (e) {
      toast({ title: 'Failed to load automation rules', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // load templates once for the action editor
  useEffect(() => {
    api<{ templates: TemplateLite[] }>('/api/whatsapp/templates')
      .then((res) => setTemplates((res.templates ?? []).filter((t) => t.status === 'APPROVED' && t.isActive)))
      .catch(() => setTemplates([]))
  }, [])

  // debounce run-dialog search
  useEffect(() => {
    if (!runRule) return
    const t = setTimeout(async () => {
      setRunSearching(true)
      try {
        const res = await api<{ leads: LeadSearchRow[] }>(`/api/leads${qs({ q: runQ || undefined, pageSize: 8 })}`)
        setRunLeads(res.leads ?? [])
      } catch {
        setRunLeads([])
      } finally {
        setRunSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [runQ, runRule])

  const openCreate = () => {
    setEditRule(null)
    setName('')
    setTrigger('LEAD_CREATED')
    setDept(user?.department ?? '__all__')
    setConditions([])
    setActions([emptyAction()])
    setActive(false)
    setEditorOpen(true)
  }

  const openEdit = (rule: Rule) => {
    setEditRule(rule)
    setName(rule.name)
    setTrigger(rule.trigger)
    setDept(rule.dept ?? '__all__')
    setConditions(parseConditions(rule.conditions))
    setActions(parseActions(rule.actions).length ? parseActions(rule.actions) : [emptyAction()])
    setActive(rule.isActive)
    setEditorOpen(true)
  }

  const submit = async () => {
    if (!name.trim()) {
      toast({ title: 'Rule name is required', variant: 'destructive' })
      return
    }
    if (!actions.length) {
      toast({ title: 'Add at least one action', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        trigger,
        dept: dept === '__all__' ? null : dept,
        conditions: JSON.stringify(conditions.filter((c) => c.field.trim())),
        actions: JSON.stringify(
          actions.map((a) => {
            if (a.type === 'SEND_WHATSAPP_TEMPLATE') return { type: a.type, templateId: a.templateId, params: a.params.filter((p) => p !== '') }
            if (a.type === 'CREATE_TASK') return { type: a.type, title: a.title, dueInHours: Number(a.dueInHours) || 24 }
            if (a.type === 'NOTIFY_AGENT') return { type: a.type, message: a.message }
            return { type: a.type, field: a.field, value: a.value }
          })
        ),
        isActive: active,
      }
      if (editRule) {
        await api('/api/automations', { method: 'PATCH', body: { id: editRule.id, ...body } })
        toast({ title: 'Rule updated', description: name })
      } else {
        await api('/api/automations', { method: 'POST', body })
        toast({ title: 'Rule created', description: `${name} is ${active ? 'live' : 'saved as inactive'}.` })
      }
      setEditorOpen(false)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (rule: Rule, next: boolean) => {
    setTogglingId(rule.id)
    try {
      await api('/api/automations', { method: 'PATCH', body: { id: rule.id, isActive: next } })
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isActive: next } : r)))
    } catch (e) {
      toast({ title: 'Toggle failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setTogglingId(null)
    }
  }

  const doDelete = async () => {
    if (!deleteRule) return
    setDeleting(true)
    try {
      await api(`/api/automations${qs({ id: deleteRule.id })}`, { method: 'DELETE' })
      toast({ title: 'Rule deleted', description: deleteRule.name })
      setDeleteRule(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const runNow = async (leadId: string) => {
    if (!runRule) return
    setRunPending(true)
    try {
      const res = await api<{ results: string[] }>('/api/automations/run', { method: 'POST', body: { ruleId: runRule.id, leadId } })
      setRunResults(res.results ?? [])
      toast({ title: 'Rule executed', description: `${(res.results ?? []).length} action result(s).` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Run failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setRunPending(false)
    }
  }

  const openLogs = async (rule: Rule) => {
    setLogsRule(rule)
    setLogsLoading(true)
    try {
      const res = await api<{ logs: RuleLog[] }>(`/api/automations/logs${qs({ ruleId: rule.id, page: 1 })}`)
      setLogs(res.logs ?? [])
    } catch (e) {
      toast({ title: 'Failed to load run history', description: (e as Error).message, variant: 'destructive' })
      setLogs([])
    } finally {
      setLogsLoading(false)
    }
  }

  const actionSummary = useCallback(
    (rule: Rule): string => {
      const list = parseActions(rule.actions)
      return list.map((a) => ACTION_LABELS[a.type] ?? a.type).join(', ') || '—'
    },
    []
  )

  const columns = useMemo<Column<Rule>[]>(
    () => [
      {
        key: 'name',
        header: 'Rule',
        render: (r) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-stone-900">{r.name}</p>
            <p className="text-xs text-stone-400">{r.isActive ? 'Active' : 'Inactive'} · created {timeAgo(r.createdAt)}</p>
          </div>
        ),
      },
      {
        key: 'trigger',
        header: 'Trigger',
        render: (r) => (
          <Badge variant="outline" className="gap-1 border-violet-200 bg-violet-50 text-violet-700">
            <Zap className="h-3 w-3" aria-hidden /> {TRIGGER_LABELS[r.trigger] ?? r.trigger}
          </Badge>
        ),
      },
      {
        key: 'dept',
        header: 'Dept',
        render: (r) => (r.dept ? <StatusBadge status={r.dept} variant="dept" /> : <span className="text-xs text-stone-500">All</span>),
      },
      {
        key: 'actions',
        header: 'Then',
        render: (r) => <span className="text-xs text-stone-600">{actionSummary(r)}</span>,
      },
      {
        key: 'conditions',
        header: 'If',
        render: (r) => {
          const c = parseConditions(r.conditions)
          return <span className="text-xs text-stone-500">{c.length ? `${c.length} condition(s)` : 'Always'}</span>
        },
      },
      {
        key: 'isActive',
        header: 'Active',
        render: (r) => (
          <Switch
            checked={r.isActive}
            disabled={togglingId === r.id || !canManage}
            aria-label={`Toggle ${r.name}`}
            onCheckedChange={(v) => toggleActive(r, v)}
          />
        ),
      },
      {
        key: 'runCount',
        header: 'Runs',
        className: 'text-center',
        render: (r) => <span className="text-sm font-medium text-stone-700">{r.runCount}</span>,
      },
      {
        key: 'lastRunAt',
        header: 'Last Run',
        render: (r) => <span className="text-xs text-stone-500">{r.lastRunAt ? timeAgo(r.lastRunAt) : '—'}</span>,
      },
      {
        key: 'rowActions',
        header: 'Actions',
        className: 'text-right',
        render: (r) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={!canManage} onClick={() => { setRunRule(r); setRunQ(''); setRunLeads([]); setRunResults(null) }}>
              <Play className="h-3.5 w-3.5" aria-hidden /> Run
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Run history" aria-label={`History for ${r.name}`} onClick={() => openLogs(r)}>
              <History className="h-4 w-4 text-stone-500" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" title="Edit rule" aria-label={`Edit ${r.name}`} disabled={!canManage} onClick={() => openEdit(r)}>
              <Pencil className="h-3.5 w-3.5 text-stone-500" aria-hidden /> Edit
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Delete rule" aria-label={`Delete ${r.name}`} disabled={!canManage} onClick={() => setDeleteRule(r)}>
              <Trash2 className="h-4 w-4 text-rose-500" aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [togglingId, canManage, actionSummary]
  )

  const selectedTemplate = (a: ActionDraft) => templates.find((t) => t.id === a.templateId) ?? null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Automations"
        subtitle="WHEN a trigger fires (and conditions match) THEN actions run automatically"
      >
        <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading} aria-label="Refresh rules">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden /> Refresh
        </Button>
        <Button size="sm" className="h-9 bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate} disabled={!canManage}>
          <Plus className="h-4 w-4" aria-hidden /> New Rule
        </Button>
      </PageHeader>

      {rules.length === 0 && !loading ? (
        <EmptyState
          icon={Workflow}
          title="No automation rules yet"
          subtitle="Create rules like “When a call is missed → create a task and notify the agent”."
          action={canManage ? (
            <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" aria-hidden /> New Rule
            </Button>
          ) : undefined}
        />
      ) : (
        <DataTable columns={columns} rows={rules} loading={loading} emptyMessage="No rules yet" maxH="max-h-[620px]" />
      )}

      {/* ---------- create / edit dialog ---------- */}
      <Dialog open={editorOpen} onOpenChange={(o) => { if (!saving) setEditorOpen(o) }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editRule ? `Edit Rule — ${editRule.name}` : 'New Automation Rule'}</DialogTitle>
            <DialogDescription>Triggers fire server-side on real CRM events. Conditions narrow when the rule applies.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Rule Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="e.g. Missed call follow-up" />
            </div>
            <div className="space-y-1.5">
              <Label>When (Trigger) *</Label>
              <Select value={trigger} onValueChange={setTrigger} disabled={saving}>
                <SelectTrigger aria-label="Trigger"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => (
                    <SelectItem key={t} value={t}>{TRIGGER_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={dept} onValueChange={setDept} disabled={saving || !!user?.department}>
                <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!user?.department ? <SelectItem value="__all__">All departments</SelectItem> : null}
                  <SelectItem value="ONLINE">Online</SelectItem>
                  <SelectItem value="EXPORT">Export</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={active} onCheckedChange={setActive} disabled={saving} aria-label="Rule active" id="rule-active" />
              <Label htmlFor="rule-active" className="text-sm text-stone-600">{active ? 'Active — runs automatically' : 'Inactive — manual runs only'}</Label>
            </div>
          </div>

          {/* conditions */}
          <div className="rounded-xl border border-stone-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Conditions (all must match)</p>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConditions((c) => [...c, { field: '', op: 'eq', value: '' }])} disabled={saving}>
                <Plus className="mr-1 h-3 w-3" aria-hidden /> Add condition
              </Button>
            </div>
            {conditions.length === 0 ? (
              <p className="mt-2 text-xs text-stone-400">No conditions — the rule runs for every trigger event.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {conditions.map((c, i) => (
                  <div key={i} className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      className="flex-1"
                      placeholder="Field e.g. department / priority / source"
                      value={c.field}
                      disabled={saving}
                      aria-label={`Condition ${i + 1} field`}
                      onChange={(e) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, field: e.target.value } : x)))}
                    />
                    <Select value={c.op} onValueChange={(v) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, op: v } : x)))} disabled={saving}>
                      <SelectTrigger className="sm:w-28" aria-label={`Condition ${i + 1} operator`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPS.map((op) => (
                          <SelectItem key={op} value={op}>{op}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      className="flex-1"
                      placeholder="Value"
                      value={c.value}
                      disabled={saving}
                      aria-label={`Condition ${i + 1} value`}
                      onChange={(e) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))}
                    />
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={`Remove condition ${i + 1}`} onClick={() => setConditions((arr) => arr.filter((_, idx) => idx !== i))} disabled={saving}>
                      <Trash2 className="h-4 w-4 text-rose-500" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* actions */}
          <div className="rounded-xl border border-stone-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Actions (run in order)</p>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setActions((a) => [...a, emptyAction()])} disabled={saving}>
                <Plus className="mr-1 h-3 w-3" aria-hidden /> Add action
              </Button>
            </div>
            <div className="mt-2 space-y-3">
              {actions.map((a, i) => (
                <div key={i} className="rounded-lg border border-stone-100 bg-stone-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <Select value={a.type} onValueChange={(v) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...emptyAction(), type: v } : x)))} disabled={saving}>
                      <SelectTrigger className="flex-1" aria-label={`Action ${i + 1} type`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{ACTION_LABELS[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {actions.length > 1 ? (
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={`Remove action ${i + 1}`} onClick={() => setActions((arr) => arr.filter((_, idx) => idx !== i))} disabled={saving}>
                        <Trash2 className="h-4 w-4 text-rose-500" aria-hidden />
                      </Button>
                    ) : null}
                  </div>

                  {a.type === 'SEND_WHATSAPP_TEMPLATE' ? (
                    <div className="mt-2 space-y-2">
                      <Select value={a.templateId} onValueChange={(v) => {
                        const tpl = templates.find((t) => t.id === v)
                        setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, templateId: v, params: Array.from({ length: tpl?.variableCount ?? 0 }, (_, k) => x.params[k] ?? '') } : x)))
                      }} disabled={saving}>
                        <SelectTrigger aria-label={`Template for action ${i + 1}`}><SelectValue placeholder="Select approved template" /></SelectTrigger>
                        <SelectContent>
                          {templates.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-stone-500">No approved templates</div>
                          ) : (
                            templates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name} ({t.variableCount} var)</SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      {selectedTemplate(a) && selectedTemplate(a)!.variableCount > 0 ? (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {Array.from({ length: selectedTemplate(a)!.variableCount }).map((_, p) => {
                            let labels: string[] = []
                            try { labels = selectedTemplate(a)!.variables ? JSON.parse(selectedTemplate(a)!.variables as string) : [] } catch { labels = [] }
                            return (
                              <Input
                                key={p}
                                value={a.params[p] ?? ''}
                                disabled={saving}
                                placeholder={labels[p] ? `{{${p + 1}}} — ${labels[p]}` : `Param {{${p + 1}}}`}
                                aria-label={`Template param ${p + 1}`}
                                onChange={(e) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, params: x.params.map((v, pi) => (pi === p ? e.target.value : v)) } : x)))}
                              />
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {a.type === 'CREATE_TASK' ? (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input value={a.title} disabled={saving} placeholder="Task title" aria-label="Task title" onChange={(e) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))} />
                      <Input type="number" min={1} value={a.dueInHours} disabled={saving} placeholder="Due in hours" aria-label="Due in hours" onChange={(e) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, dueInHours: e.target.value } : x)))} />
                    </div>
                  ) : null}

                  {a.type === 'NOTIFY_AGENT' ? (
                    <Textarea className="mt-2" rows={2} value={a.message} disabled={saving} placeholder="Notification message for the lead owner" aria-label="Notification message" onChange={(e) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, message: e.target.value } : x)))} />
                  ) : null}

                  {a.type === 'UPDATE_LEAD_FIELD' ? (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Select value={a.field} onValueChange={(v) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, field: v } : x)))} disabled={saving}>
                        <SelectTrigger aria-label="Lead field"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {UPDATE_FIELDS.map((f) => (
                            <SelectItem key={f} value={f}>{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input value={a.value} disabled={saving} placeholder="New value" aria-label="Field value" onChange={(e) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={saving} onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={submit}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              {editRule ? 'Save Changes' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- run now dialog ---------- */}
      <Dialog open={!!runRule} onOpenChange={(o) => { if (!o && !runPending) setRunRule(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run “{runRule?.name}” on a lead</DialogTitle>
            <DialogDescription>Pick a lead to execute this rule against. Useful to verify before it runs automatically.</DialogDescription>
          </DialogHeader>
          {runResults ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-stone-700">Results:</p>
              <ScrollArea className="h-40 rounded-lg border border-stone-200 p-3">
                {runResults.length === 0 ? (
                  <p className="text-xs text-stone-500">No actions ran (conditions may not have matched).</p>
                ) : (
                  <ul className="list-inside list-disc space-y-1 text-xs text-stone-600">
                    {runResults.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setRunResults(null)}>Run on another lead</Button>
                <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setRunRule(null)}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Input value={runQ} onChange={(e) => setRunQ(e.target.value)} placeholder="Search lead by name or phone…" aria-label="Search leads" />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {runSearching ? (
                  <p className="flex items-center gap-2 p-3 text-xs text-stone-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Searching…</p>
                ) : runLeads.length === 0 ? (
                  <p className="p-3 text-xs text-stone-400">No leads match.</p>
                ) : (
                  runLeads.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      disabled={runPending}
                      onClick={() => runNow(l.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-stone-100 p-2.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-stone-800">{l.customerName}</p>
                        <p className="text-xs text-stone-400">{l.leadCode} · {l.mobile}</p>
                      </div>
                      {runPending ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden /> : <Play className="h-4 w-4 text-emerald-600" aria-hidden />}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- logs sheet ---------- */}
      <Sheet open={!!logsRule} onOpenChange={(o) => { if (!o) setLogsRule(null) }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Run history — {logsRule?.name}</SheetTitle>
            <SheetDescription>Every execution of this rule, newest first.</SheetDescription>
          </SheetHeader>
          <div className="space-y-2 px-4 pb-6">
            {logsLoading ? (
              <p className="flex items-center gap-2 text-xs text-stone-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…</p>
            ) : logs.length === 0 ? (
              <p className="py-6 text-center text-xs text-stone-400">This rule has not run yet.</p>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="rounded-lg border border-stone-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={l.status} variant="autoStatus" />
                    <span className="text-xs text-stone-400">{formatDateTime(l.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 break-words text-xs text-stone-600">{l.detail ?? '—'}</p>
                  {l.leadId ? <p className="mt-1 font-mono text-[10px] text-stone-400">lead {l.leadId}</p> : null}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ---------- delete confirm ---------- */}
      <AlertDialog open={!!deleteRule} onOpenChange={(o) => { if (!o && !deleting) setDeleteRule(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rule “{deleteRule?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The rule and its run history will stop working immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                doDelete()
              }}
            >
              {deleting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
