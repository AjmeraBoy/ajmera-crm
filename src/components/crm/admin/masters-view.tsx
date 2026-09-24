'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Plus, RefreshCw, Search } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'
import { MASTER_TYPES, MASTER_TYPE_LABELS, type MasterType } from '@/lib/constants'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { PageHeader } from '@/components/crm/shared/page-header'
import type { MasterItemDTO } from '@/types/crm'
import { useAppStore } from '@/store/app-store'

// ---------- helpers ----------

/** Local type-alias mirror of MasterItemDTO (interfaces don't satisfy DataTable's Record<string, unknown> constraint). */
type MasterRow = {
  id: string
  type: string
  label: string
  value?: string | null
  parentId?: string | null
  dept: string
  extra?: string | null
  order: number
  isActive: boolean
}

const EXTRA_HINTS: Record<string, string> = {
  disposition:
    'Disposition config — {"showCallback":true} / {"showEstimated":true} / {"showPayment":true} / {"showFollowUp":true} (drives dynamic fields in the after-call form)',
  pipeline_stage: 'Stage config — {"color":"#059669"} (column accent colour in the pipeline kanban)',
}

function DeptChip({ dept }: { dept: string }) {
  const cls =
    dept === 'ONLINE'
      ? 'border-sky-200 bg-sky-100 text-sky-700'
      : dept === 'EXPORT'
        ? 'border-amber-200 bg-amber-100 text-amber-700'
        : 'border-stone-200 bg-stone-100 text-stone-600'
  return <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', cls)}>{dept}</span>
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

// ---------- main view ----------

export default function MastersView() {
  const { toast } = useToast()

  const [items, setItems] = useState<MasterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState<MasterType>('disposition')
  const [q, setQ] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MasterItemDTO | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ items: MasterItemDTO[] }>(`/api/masters?types=${MASTER_TYPES.join(',')}`)
      const all = res.items ?? []
      setItems(all)
      // keep the global masters store in sync (active items only — same shape crm-app bootstraps)
      const grouped: Record<string, MasterItemDTO[]> = {}
      for (const it of all) {
        if (!it.isActive) continue
        if (!grouped[it.type]) grouped[it.type] = []
        grouped[it.type].push(it)
      }
      const st = useAppStore.getState()
      st.setMasters({ ...st.masters, ...grouped })
    } catch (e) {
      toast({ title: 'Failed to load master data', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  /** Re-fetch one type after a mutation: updates local rows AND the global masters store so dropdowns update live. */
  const refreshType = useCallback(async (t: string) => {
    try {
      const res = await api<{ items: MasterItemDTO[] }>(`/api/masters?types=${t}`)
      const fresh = res.items ?? []
      setItems((prev) => [...prev.filter((i) => i.type !== t), ...fresh])
      const st = useAppStore.getState()
      st.setMasters({ ...st.masters, [t]: fresh.filter((i) => i.isActive) })
    } catch {
      // full reload will cover it
      setReloadKey((k) => k + 1)
    }
  }, [])

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const it of items) map[it.type] = (map[it.type] ?? 0) + 1
    return map
  }, [items])

  const parentLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of items) {
      if (it.type === 'disposition') map.set(it.id, it.label)
    }
    return map
  }, [items])

  const typeItems = useMemo(() => items.filter((i) => i.type === activeType), [items, activeType])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return typeItems
    return typeItems.filter(
      (i) => i.label.toLowerCase().includes(needle) || (i.value ?? '').toLowerCase().includes(needle)
    )
  }, [typeItems, q])

  const toggleActive = async (item: MasterRow) => {
    setBusyId(item.id)
    try {
      await api('/api/masters', { method: 'PATCH', body: { id: item.id, isActive: !item.isActive } })
      toast({ title: item.isActive ? 'Item deactivated' : 'Item activated', description: `${item.label} — ${MASTER_TYPE_LABELS[item.type] ?? item.type}` })
      await refreshType(item.type)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const columns = useMemo<Column<MasterRow>[]>(() => {
    const cols: Column<MasterRow>[] = [
      {
        key: 'label',
        header: 'Label',
        render: (i) => (
          <span className={cn('text-sm font-medium text-stone-900', !i.isActive && 'opacity-40 line-through')} title={i.label}>
            {i.label}
          </span>
        ),
      },
      {
        key: 'value',
        header: 'Value',
        render: (i) => <span className={cn('font-mono text-xs text-stone-500', !i.isActive && 'opacity-40')}>{i.value || '—'}</span>,
      },
      { key: 'dept', header: 'Dept', render: (i) => <DeptChip dept={i.dept} /> },
      {
        key: 'order',
        header: 'Order',
        className: 'text-center',
        render: (i) => <span className="text-sm text-stone-600">{i.order}</span>,
      },
    ]
    if (activeType === 'sub_disposition') {
      cols.push({
        key: 'parent',
        header: 'Parent Disposition',
        render: (i) => {
          const label = i.parentId ? parentLabel.get(i.parentId) : undefined
          return label ? (
            <span className="text-sm text-stone-600">{label}</span>
          ) : (
            <span className="text-stone-400">—</span>
          )
        },
      })
    }
    cols.push(
      {
        key: 'extra',
        header: 'Extra Config (JSON)',
        render: (i) =>
          i.extra ? (
            <code className="block max-w-[220px] truncate rounded bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] text-stone-600" title={i.extra}>
              {truncate(i.extra, 40)}
            </code>
          ) : (
            <span className="text-stone-400">—</span>
          ),
      },
      {
        key: 'isActive',
        header: 'Active',
        render: (i) => (
          <Switch
            checked={i.isActive}
            disabled={busyId === i.id}
            aria-label={`Toggle active for ${i.label}`}
            onCheckedChange={() => toggleActive(i)}
          />
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        className: 'text-right',
        render: (i) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={`Edit ${i.label}`}
            aria-label={`Edit ${i.label}`}
            onClick={() => {
              setEditing(i)
              setDialogOpen(true)
            }}
          >
            <Pencil className="h-4 w-4 text-stone-500" aria-hidden />
          </Button>
        ),
      }
    )
    return cols
  }, [activeType, parentLabel, busyId])

  return (
    <div>
      <PageHeader title="Master Data" subtitle="Dynamic configuration engine — dispositions, pipeline stages, geo, couriers and more">
        <Button variant="outline" size="sm" className="h-9" onClick={() => setReloadKey((k) => k + 1)}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </Button>
        <Button
          size="sm"
          className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add Item
        </Button>
      </PageHeader>

      {/* mobile type strip */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden" role="tablist" aria-label="Master types">
        {MASTER_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={activeType === t}
            onClick={() => {
              setActiveType(t)
              setQ('')
            }}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              activeType === t
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400'
            )}
          >
            {MASTER_TYPE_LABELS[t]}
            <span className={cn('rounded-full px-1.5 text-[10px]', activeType === t ? 'bg-white/20' : 'bg-stone-100 text-stone-500')}>
              {counts[t] ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* desktop type nav */}
        <nav className="hidden rounded-xl border border-stone-200 bg-white p-2 shadow-sm lg:block" aria-label="Master types">
          {MASTER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setActiveType(t)
                setQ('')
              }}
              aria-pressed={activeType === t}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeType === t
                  ? 'bg-emerald-50 font-medium text-emerald-700'
                  : 'text-stone-600 hover:bg-stone-50'
              )}
            >
              <span className="truncate text-left">{MASTER_TYPE_LABELS[t]}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs', activeType === t ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500')}>
                {counts[t] ?? 0}
              </span>
            </button>
          ))}
        </nav>

        {/* table panel */}
        <section className="min-w-0">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">{MASTER_TYPE_LABELS[activeType]}</h2>
              <p className="text-xs text-stone-500">
                {typeItems.length} item(s) · {typeItems.filter((i) => i.isActive).length} active · inactive items shown dimmed
              </p>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by label or value…"
                className="h-9 w-full bg-white pl-8 sm:w-64"
                aria-label={`Filter ${MASTER_TYPE_LABELS[activeType]}`}
              />
            </div>
          </div>

          <DataTable
            columns={columns}
            rows={visible}
            loading={loading}
            emptyMessage={loading ? 'Loading…' : `No ${MASTER_TYPE_LABELS[activeType].toLowerCase()} yet — click “Add Item” to create the first one`}
            maxH="max-h-[600px]"
          />
        </section>
      </div>

      {/* add / edit master item dialog */}
      <MasterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={activeType}
        item={editing}
        dispositions={items.filter((i) => i.type === 'disposition')}
        onSaved={(t) => refreshType(t)}
      />
    </div>
  )
}

// ---------- master item dialog ----------

function MasterDialog({
  open,
  onOpenChange,
  type,
  item,
  dispositions,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: MasterType
  item: MasterRow | null
  dispositions: MasterRow[]
  onSaved: (type: string) => void
}) {
  const { toast } = useToast()
  const isEdit = !!item
  const isSub = type === 'sub_disposition'

  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [parentId, setParentId] = useState('__none__')
  const [dept, setDept] = useState('ALL')
  const [order, setOrder] = useState('0')
  const [extraText, setExtraText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setLabel(item?.label ?? '')
    setValue(item?.value ?? '')
    setParentId(item?.parentId ?? '__none__')
    setDept(item?.dept ?? 'ALL')
    setOrder(String(item?.order ?? 0))
    setExtraText(item?.extra ?? '')
  }, [open, item])

  const jsonError = useMemo(() => {
    const t = extraText.trim()
    if (!t) return ''
    try {
      const parsed: unknown = JSON.parse(t)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'Extra must be a JSON object like {"showCallback":true}'
      }
      return ''
    } catch {
      return 'Invalid JSON — fix the syntax before saving'
    }
  }, [extraText])

  const hint = EXTRA_HINTS[type] ?? 'Optional JSON configuration for this item.'

  const submit = async () => {
    setError('')
    if (!label.trim()) {
      setError('Label is required.')
      return
    }
    if (jsonError) {
      setError(jsonError)
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await api('/api/masters', {
          method: 'PATCH',
          body: {
            id: item.id,
            label: label.trim(),
            value: value.trim() || null,
            parentId: isSub ? (parentId === '__none__' ? null : parentId) : null,
            dept,
            order: Number(order) || 0,
            extra: extraText.trim() || undefined,
          },
        })
        toast({ title: 'Master item updated', description: `${label} — ${MASTER_TYPE_LABELS[type]}` })
      } else {
        await api('/api/masters', {
          method: 'POST',
          body: {
            type,
            label: label.trim(),
            value: value.trim() || null,
            parentId: isSub && parentId !== '__none__' ? parentId : null,
            dept,
            order: Number(order) || 0,
            extra: extraText.trim() || undefined,
          },
        })
        toast({ title: 'Master item created', description: `${label} added to ${MASTER_TYPE_LABELS[type]}.` })
      }
      onSaved(type)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
      toast({ title: isEdit ? 'Update failed' : 'Create failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${MASTER_TYPE_LABELS[type]}` : `Add ${MASTER_TYPE_LABELS[type]}`}</DialogTitle>
          <DialogDescription>
            Master items power dropdowns, pipeline columns and dynamic forms across the CRM.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Label *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={saving} placeholder="Display name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Value</Label>
              <Input value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} placeholder="Optional stored value" />
            </div>
            <div className="space-y-1.5">
              <Label>Sort Order</Label>
              <Input type="number" value={order} onChange={(e) => setOrder(e.target.value)} disabled={saving} />
            </div>
          </div>
          {isSub ? (
            <div className="space-y-1.5">
              <Label>Parent Disposition *</Label>
              <Select value={parentId} onValueChange={setParentId} disabled={saving}>
                <SelectTrigger aria-label="Parent disposition"><SelectValue placeholder="Select parent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {dispositions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.label}{d.isActive ? '' : ' (inactive)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={dept} onValueChange={setDept} disabled={saving}>
              <SelectTrigger aria-label="Department scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All departments</SelectItem>
                <SelectItem value="ONLINE">Online only</SelectItem>
                <SelectItem value="EXPORT">Export only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Extra Config (JSON)</Label>
            <Textarea
              rows={3}
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              disabled={saving}
              className="font-mono text-xs"
              placeholder={type === 'disposition' ? '{"showCallback":true}' : type === 'pipeline_stage' ? '{"color":"#059669"}' : '{"key":"value"}'}
            />
            <p className="text-[11px] text-stone-400">{hint}</p>
            {jsonError ? <p className="text-xs font-medium text-rose-600">{jsonError}</p> : null}
          </div>
          {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving || !!jsonError || !label.trim()} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            {isEdit ? 'Save Changes' : 'Create Item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
