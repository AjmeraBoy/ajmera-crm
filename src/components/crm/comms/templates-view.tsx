'use client'

/**
 * WhatsApp message templates manager — full CRUD.
 * variableCount is auto-counted from {{N}} placeholders in the body; the
 * variables list holds human-friendly labels for the composer & automations.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MessageSquareDot, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { EmptyState } from '@/components/crm/shared/empty-state'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'

type Template = {
  id: string
  name: string
  providerTemplateId: string | null
  language: string
  category: string
  status: string
  body: string
  headerType: string
  headerText: string | null
  footerText: string | null
  variableCount: number
  variables: string | null
  dept: string | null
  isActive: boolean
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION', 'SESSION'] as const
const STATUSES = ['APPROVED', 'PENDING', 'REJECTED', 'DISABLED'] as const
const HEADER_TYPES = ['NONE', 'TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO'] as const

/** Count the highest {{N}} placeholder in a template body. */
function countVars(body: string): number {
  const matches = body.match(/\{\{(\d+)\}\}/g) ?? []
  let max = 0
  for (const m of matches) {
    const n = Number(m.replace(/\D/g, ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

function parseLabels(variables: string | null): string[] {
  if (!variables) return []
  try {
    const arr = JSON.parse(variables)
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return []
  }
}

export default function TemplatesView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const canManage = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user?.role ?? '')

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [deptFilter, setDeptFilter] = useState(user?.department ?? '__all__')

  // editor
  const [open, setOpen] = useState(false)
  const [editTpl, setEditTpl] = useState<Template | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    providerTemplateId: '',
    language: 'en',
    category: 'MARKETING',
    status: 'PENDING',
    body: '',
    headerType: 'NONE',
    headerText: '',
    footerText: '',
    dept: '__all__',
    isActive: true,
  })
  const [labels, setLabels] = useState<string[]>([])

  const [deleteTpl, setDeleteTpl] = useState<Template | null>(null)
  const [deleting, setDeleting] = useState(false)

  const varCount = useMemo(() => countVars(form.body), [form.body])
  const preview = useMemo(
    () => form.body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
      const label = labels[Number(n) - 1]
      return label ? `[${label}]` : `{{${n}}}`
    }),
    [form.body, labels]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ templates: Template[] }>(
        `/api/whatsapp/templates${qs({ dept: deptFilter === '__all__' ? undefined : deptFilter, all: '1' })}`
      )
      setTemplates(res.templates ?? [])
    } catch (e) {
      toast({ title: 'Failed to load templates', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptFilter, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const openCreate = () => {
    setEditTpl(null)
    setForm({ name: '', providerTemplateId: '', language: 'en', category: 'MARKETING', status: 'PENDING', body: '', headerType: 'NONE', headerText: '', footerText: '', dept: user?.department ?? '__all__', isActive: true })
    setLabels([])
    setOpen(true)
  }

  const openEdit = (t: Template) => {
    setEditTpl(t)
    setForm({
      name: t.name,
      providerTemplateId: t.providerTemplateId ?? '',
      language: t.language,
      category: t.category,
      status: t.status,
      body: t.body,
      headerType: t.headerType ?? 'NONE',
      headerText: t.headerText ?? '',
      footerText: t.footerText ?? '',
      dept: t.dept ?? '__all__',
      isActive: t.isActive,
    })
    setLabels(parseLabels(t.variables))
    setOpen(true)
  }

  // keep the label list in sync with the placeholder count
  useEffect(() => {
    setLabels((prev) => {
      if (prev.length === varCount) return prev
      if (prev.length > varCount) return prev.slice(0, varCount)
      return [...prev, ...Array.from({ length: varCount - prev.length }, () => '')]
    })
  }, [varCount])

  const submit = async () => {
    if (!form.name.trim() || !form.body.trim()) {
      toast({ title: 'Name and body are required', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        providerTemplateId: form.providerTemplateId.trim() || undefined,
        language: form.language.trim() || 'en',
        category: form.category,
        status: form.status,
        body: form.body,
        headerType: form.headerType,
        headerText: form.headerType === 'TEXT' && form.headerText.trim() ? form.headerText.trim() : undefined,
        footerText: form.footerText.trim() || undefined,
        dept: form.dept === '__all__' ? null : form.dept,
        isActive: form.isActive,
        variables: JSON.stringify(labels.filter((l) => l.trim() !== '')),
      }
      if (editTpl) {
        await api('/api/whatsapp/templates', { method: 'PATCH', body: { id: editTpl.id, ...payload } })
        toast({ title: 'Template updated', description: form.name })
      } else {
        await api('/api/whatsapp/templates', { method: 'POST', body: payload })
        toast({ title: 'Template created', description: `${form.name} (${varCount} variable${varCount === 1 ? '' : 's'})` })
      }
      setOpen(false)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (t: Template, next: boolean) => {
    try {
      await api('/api/whatsapp/templates', { method: 'PATCH', body: { id: t.id, isActive: next } })
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: next } : x)))
    } catch (e) {
      toast({ title: 'Toggle failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const doDelete = async () => {
    if (!deleteTpl) return
    setDeleting(true)
    try {
      await api(`/api/whatsapp/templates${qs({ id: deleteTpl.id })}`, { method: 'DELETE' })
      toast({ title: 'Template deleted', description: deleteTpl.name })
      setDeleteTpl(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      // templates may only support deactivation server-side — fall back
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  const columns = useMemo<Column<Template>[]>(
    () => [
      {
        key: 'name',
        header: 'Template',
        render: (t) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-stone-900">{t.name}</p>
            <p className="truncate font-mono text-[10px] text-stone-400">{t.providerTemplateId ?? 'no provider id'}</p>
          </div>
        ),
      },
      { key: 'category', header: 'Category', render: (t) => <Badge variant="outline" className="border-stone-200 text-[10px] text-stone-600">{t.category}</Badge> },
      { key: 'language', header: 'Lang', render: (t) => <span className="text-xs uppercase text-stone-500">{t.language}</span> },
      { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} variant="tplStatus" /> },
      { key: 'dept', header: 'Dept', render: (t) => (t.dept ? <StatusBadge status={t.dept} variant="dept" /> : <span className="text-xs text-stone-500">All</span>) },
      { key: 'variableCount', header: 'Vars', className: 'text-center', render: (t) => <span className="text-sm font-medium text-stone-700">{t.variableCount}</span> },
      { key: 'body', header: 'Body', render: (t) => <span className="block max-w-64 truncate text-xs text-stone-500" title={t.body}>{t.body}</span> },
      { key: 'lastSyncedAt', header: 'Synced', render: (t) => <span className="text-xs text-stone-400">{t.lastSyncedAt ? timeAgo(t.lastSyncedAt) : '—'}</span> },
      {
        key: 'isActive',
        header: 'Active',
        render: (t) => <Switch checked={t.isActive} disabled={!canManage} aria-label={`Toggle ${t.name}`} onCheckedChange={(v) => toggleActive(t, v)} />,
      },
      {
        key: 'rowActions',
        header: 'Actions',
        className: 'text-right',
        render: (t) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={!canManage} aria-label={`Edit ${t.name}`} onClick={() => openEdit(t)}>
              <Pencil className="h-3.5 w-3.5 text-stone-500" aria-hidden /> Edit
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!canManage} aria-label={`Delete ${t.name}`} onClick={() => setDeleteTpl(t)}>
              <Trash2 className="h-4 w-4 text-rose-500" aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage]
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="WhatsApp Templates"
        subtitle="Pre-approved message templates for chats, broadcasts and automations — {{1}}, {{2}}… placeholders are auto-counted"
      >
        <div className="flex items-center gap-2">
          {!user?.department ? (
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-9 w-36" aria-label="Filter by department">
                <SelectValue placeholder="All depts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All depts</SelectItem>
                <SelectItem value="ONLINE">Online</SelectItem>
                <SelectItem value="EXPORT">Export</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading} aria-label="Refresh templates">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden /> Refresh
          </Button>
          <Button size="sm" className="h-9 bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate} disabled={!canManage}>
            <Plus className="h-4 w-4" aria-hidden /> New Template
          </Button>
        </div>
      </PageHeader>

      {templates.length === 0 && !loading ? (
        <EmptyState
          icon={MessageSquareDot}
          title="No templates yet"
          subtitle="Templates must be APPROVED and active before agents can send them in chats, broadcasts or automations."
          action={canManage ? (
            <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" aria-hidden /> New Template
            </Button>
          ) : undefined}
        />
      ) : (
        <DataTable columns={columns} rows={templates} loading={loading} emptyMessage="No templates for this filter" maxH="max-h-[620px]" />
      )}

      {/* ---------- create / edit dialog ---------- */}
      <Dialog open={open} onOpenChange={(o) => { if (!saving) setOpen(o) }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editTpl ? `Edit Template — ${editTpl.name}` : 'New WhatsApp Template'}</DialogTitle>
            <DialogDescription>Use {'{{1}}'}, {'{{2}}'}… in the body — the variable count updates automatically.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Template Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={saving} placeholder="order_confirmation" />
            </div>
            <div className="space-y-1.5">
              <Label>Provider Template ID</Label>
              <Input value={form.providerTemplateId} onChange={(e) => setForm((f) => ({ ...f, providerTemplateId: e.target.value }))} disabled={saving} placeholder="id on Alendei / Meta (optional)" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Input value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} disabled={saving} placeholder="en / hi / gu" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))} disabled={saving}>
                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))} disabled={saving}>
                <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={form.dept} onValueChange={(v) => setForm((f) => ({ ...f, dept: v }))} disabled={saving || !!user?.department}>
                <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!user?.department ? <SelectItem value="__all__">All departments</SelectItem> : null}
                  <SelectItem value="ONLINE">Online</SelectItem>
                  <SelectItem value="EXPORT">Export</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Header Type</Label>
              <Select value={form.headerType} onValueChange={(v) => setForm((f) => ({ ...f, headerType: v }))} disabled={saving}>
                <SelectTrigger aria-label="Header type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HEADER_TYPES.map((h) => (
                    <SelectItem key={h} value={h}>{h}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Header Text {form.headerType === 'TEXT' ? '*' : '(TEXT header only)'}</Label>
              <Input value={form.headerText} onChange={(e) => setForm((f) => ({ ...f, headerText: e.target.value }))} disabled={saving || form.headerType !== 'TEXT'} placeholder="e.g. Ajmera Fashion" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Body *</Label>
              <Textarea
                rows={4}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                disabled={saving}
                placeholder="Namaste {{1}}! Your order {{2}} is confirmed…"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn('border-emerald-200 bg-emerald-50 text-emerald-700', varCount === 0 && 'border-stone-200 bg-stone-50 text-stone-500')}>
                  {varCount} variable{varCount === 1 ? '' : 's'}
                </Badge>
                <span className="text-[11px] text-stone-400">Add placeholders to grow the list below.</span>
              </div>
            </div>
            {varCount > 0 ? (
              <div className="space-y-2 sm:col-span-2">
                <Label>Variable Labels (helps agents fill values)</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {labels.map((label, i) => (
                    <Input
                      key={i}
                      value={label}
                      disabled={saving}
                      placeholder={`{{${i + 1}}} label e.g. Customer Name`}
                      aria-label={`Label for variable ${i + 1}`}
                      onChange={(e) => setLabels((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Footer Text (optional)</Label>
              <Input value={form.footerText} onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))} disabled={saving} placeholder="Reply STOP to opt out" />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch id="tpl-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} disabled={saving} />
              <Label htmlFor="tpl-active" className="text-sm text-stone-600">{form.isActive ? 'Active' : 'Inactive'}</Label>
            </div>
            {form.body.trim() ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Live preview</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{preview}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={submit}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1 h-4 w-4" aria-hidden />}
              {editTpl ? 'Save Changes' : 'Create Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- delete confirm ---------- */}
      <AlertDialog open={!!deleteTpl} onOpenChange={(o) => { if (!o && !deleting) setDeleteTpl(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template “{deleteTpl?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Agents will no longer be able to send it. Active automations using this template will fail.</AlertDialogDescription>
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
