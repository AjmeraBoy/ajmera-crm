'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronsUpDown,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { DEPARTMENTS, DEPT_LABELS, QUOTATION_STATUSES } from '@/lib/constants'
import { formatDate, formatDateTime, formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

// ---------- shared types (reused by orders-view / payments-view) ----------

export type PickerOption = { id: string; label: string; sub?: string }

export type ItemRow = { productId: string; name: string; qty: string; price: string }

export type ProductLite = { id: string; code: string; name: string; price: number }

export type SalesItem = { productId: string | null; name: string; qty: number; price: number }

type QuotationRow = {
  id: string
  quoteNo: string
  leadId: string
  department: string
  items: string
  subtotal: number
  discount: number
  total: number
  status: string
  validUntil: string | null
  notes: string | null
  sentAt: string | null
  createdAt: string
  lead: { id: string; leadCode: string; customerName: string; companyName: string | null; department: string; mobile: string }
  createdBy: { id: string; name: string } | null
}

type QuotationsResponse = { quotations: QuotationRow[]; total: number }

const CONVERTIBLE = ['DRAFT', 'SENT', 'ACCEPTED']
const PAGE_SIZE = 20

// ---------- shared helpers (reused by orders-view) ----------

export function parseItems(raw: string | null | undefined): SalesItem[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SalesItem[]) : []
  } catch {
    return []
  }
}

export function itemsSubtotal(rows: ItemRow[]): number {
  return rows.reduce(
    (sum, r) => sum + Math.max(0, Math.floor(Number(r.qty) || 0)) * Math.max(0, Math.floor(Number(r.price) || 0)),
    0
  )
}

/** Load active products for line-item pickers (fetched while `open` is true) */
export function useActiveProducts(open: boolean): ProductLite[] {
  const [products, setProducts] = useState<ProductLite[]>([])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    api<{ products: Array<{ id: string; code: string; name: string; price: number }> }>(
      `/api/products${qs({ active: 1, pageSize: 200 })}`
    )
      .then((res) => {
        if (!cancelled) setProducts(res.products ?? [])
      })
      .catch(() => {
        if (!cancelled) setProducts([])
      })
    return () => {
      cancelled = true
    }
  }, [open])
  return products
}

// ---------- AsyncPicker: debounced server-side searchable select ----------

export function AsyncPicker({
  value,
  onChange,
  fetchOptions,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches found',
  disabled,
  ariaLabel,
  selectedOption,
}: {
  value: string
  onChange: (id: string) => void
  fetchOptions: (q: string) => Promise<PickerOption[]>
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  ariaLabel?: string
  selectedOption?: PickerOption | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<PickerOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setLoading(true)
      fetchOptions(query)
        .then((opts) => setOptions(opts))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
  }, [open, query, fetchOptions])

  const selected = options.find((o) => o.id === value) ?? selectedOption ?? null

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setQuery('') }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className="h-9 w-full justify-between font-normal"
        >
          <span className="min-w-0 flex-1 text-left">
            <span className={cn('block truncate', !selected && 'text-stone-400')}>{selected?.label ?? (value || placeholder)}</span>
            {selected?.sub ? <span className="block truncate text-[10px] font-medium uppercase tracking-wide text-stone-400">{selected.sub}</span> : null}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandEmpty>{loading ? 'Searching…' : emptyText}</CommandEmpty>
          <CommandGroup className="max-h-60 overflow-y-auto">
            {options.map((o) => (
              <CommandItem
                key={o.id}
                value={o.label}
                onSelect={() => {
                  onChange(o.id)
                  setOpen(false)
                }}
              >
                <Check className={cn('mr-2 h-4 w-4 shrink-0', value === o.id ? 'opacity-100' : 'opacity-0')} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.sub ? <span className="block truncate text-xs text-stone-400">{o.sub}</span> : null}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------- LineItemsEditor: product picker / free-name rows ----------

export function LineItemsEditor({
  rows,
  onChange,
  products,
  disabled,
}: {
  rows: ItemRow[]
  onChange: (rows: ItemRow[]) => void
  products: ProductLite[]
  disabled?: boolean
}) {
  const update = (idx: number, patch: Partial<ItemRow>) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx))
  const add = () => onChange([...rows, { productId: '', name: '', qty: '1', price: '' }])

  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[minmax(0,1fr)_64px_88px_88px_36px] items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400 md:grid">
        <span>Product / Item</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Price ₹</span>
        <span className="text-right">Amount</span>
        <span />
      </div>
      {rows.map((row, idx) => {
        const amount = Math.max(0, Math.floor(Number(row.qty) || 0)) * Math.max(0, Math.floor(Number(row.price) || 0))
        return (
          <div
            key={idx}
            className="grid grid-cols-2 items-center gap-2 rounded-lg border border-stone-200 bg-stone-50/60 p-2 md:grid-cols-[minmax(0,1fr)_64px_88px_88px_36px] md:rounded-none md:border-0 md:bg-transparent md:p-0"
          >
            <div className="col-span-2 space-y-1.5 md:col-span-1">
              <Select
                value={row.productId || 'custom'}
                onValueChange={(v) => {
                  if (v === 'custom') {
                    update(idx, { productId: '' })
                  } else {
                    const p = products.find((x) => x.id === v)
                    update(idx, { productId: v, name: p?.name ?? '', price: p ? String(p.price) : row.price })
                  }
                }}
                disabled={disabled}
              >
                <SelectTrigger className="h-9" aria-label={`Item ${idx + 1} product`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom item (type name)</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!row.productId ? (
                <Input
                  value={row.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="Item name (e.g. Bridal set — 12 pcs)"
                  className="h-9"
                  disabled={disabled}
                  aria-label={`Item ${idx + 1} name`}
                />
              ) : null}
            </div>
            <Input
              type="number"
              min={1}
              value={row.qty}
              onChange={(e) => update(idx, { qty: e.target.value })}
              placeholder="Qty"
              className="h-9"
              disabled={disabled}
              aria-label={`Item ${idx + 1} quantity`}
            />
            <Input
              type="number"
              min={0}
              value={row.price}
              onChange={(e) => update(idx, { price: e.target.value })}
              placeholder="₹"
              className="h-9"
              disabled={disabled}
              aria-label={`Item ${idx + 1} price`}
            />
            <span className="text-right text-sm font-medium text-stone-700">{formatINR(amount)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-rose-500 hover:text-rose-600"
              onClick={() => remove(idx)}
              disabled={disabled || rows.length === 1}
              aria-label={`Remove item ${idx + 1}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
        <Plus className="mr-1 h-4 w-4" aria-hidden /> Add row
      </Button>
    </div>
  )
}

// ---------- component ----------

export default function QuotationsView() {
  const user = useAppStore((s) => s.user)
  const storeParams = useAppStore((s) => s.params)
  const { toast } = useToast()

  const canPickDept = !user?.department
  const paramLeadId = typeof storeParams.leadId === 'string' ? storeParams.leadId : ''

  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [dept, setDept] = useState(user?.department ?? '')
  const [status, setStatus] = useState('')
  const [leadId, setLeadId] = useState(paramLeadId)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<QuotationsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [kpi, setKpi] = useState({ total: 0, sent: 0, accepted: 0, conversionValue: 0 })
  const [leadLabel, setLeadLabel] = useState('')

  const [detail, setDetail] = useState<QuotationRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [convertQuote, setConvertQuote] = useState<QuotationRow | null>(null)
  const [converting, setConverting] = useState(false)
  const [exporting, setExporting] = useState(false)

  // keep in sync when navigated with a leadId param while mounted
  useEffect(() => {
    if (leadId === paramLeadId) return
    setLeadId(paramLeadId)
    setPage(1)
  }, [paramLeadId, leadId])

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [qInput])

  const buildParams = useCallback(
    (forExport = false) => ({
      q: q || undefined,
      dept: dept || undefined,
      status: status || undefined,
      leadId: leadId || undefined,
      ...(forExport ? { pageSize: 200 } : { page, pageSize: PAGE_SIZE }),
    }),
    [q, dept, status, leadId, page]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<QuotationsResponse>(`/api/quotations${qs(buildParams())}`)
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load quotations', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [buildParams, toast])

  const loadKpis = useCallback(async () => {
    try {
      const res = await api<QuotationsResponse>(
        `/api/quotations${qs({ dept: dept || undefined, leadId: leadId || undefined, pageSize: 200 })}`
      )
      const rows = res.quotations ?? []
      setKpi({
        total: res.total ?? rows.length,
        sent: rows.filter((r) => r.status === 'SENT' || r.status === 'VIEWED').length,
        accepted: rows.filter((r) => r.status === 'ACCEPTED').length,
        conversionValue: rows
          .filter((r) => r.status === 'ACCEPTED' || r.status === 'CONVERTED')
          .reduce((s, r) => s + (r.total || 0), 0),
      })
    } catch {
      // KPI numbers are non-critical — keep previous values
    }
  }, [dept, leadId])

  useEffect(() => {
    load()
    loadKpis()
  }, [load, loadKpis, reloadKey])

  // resolve lead label for the active leadId filter chip
  useEffect(() => {
    if (!leadId) {
      setLeadLabel('')
      return
    }
    let cancelled = false
    api<{ lead: { leadCode: string; customerName: string } }>(`/api/leads/detail${qs({ id: leadId })}`)
      .then((r) => {
        if (!cancelled) setLeadLabel(`${r.lead.leadCode} — ${r.lead.customerName}`)
      })
      .catch(() => {
        if (!cancelled) setLeadLabel('Selected lead')
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const resetFilters = () => {
    setQInput('')
    setQ('')
    setStatus('')
    setLeadId('')
    setPage(1)
  }

  // ---------- actions ----------

  const markSent = async (row: QuotationRow) => {
    try {
      await api('/api/quotations', { method: 'PATCH', body: { id: row.id, status: 'SENT' } })
      toast({ title: 'Quotation sent', description: `${row.quoteNo} marked as sent` })
      setDetail((d) => (d && d.id === row.id ? { ...d, status: 'SENT', sentAt: new Date().toISOString() } : d))
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const updateStatus = async (row: QuotationRow, next: string) => {
    try {
      const res = await api<{ quotation: QuotationRow }>('/api/quotations', { method: 'PATCH', body: { id: row.id, status: next } })
      toast({ title: 'Status updated', description: `${row.quoteNo} → ${next}` })
      setDetail(res.quotation)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const convertToOrder = async () => {
    if (!convertQuote) return
    setConverting(true)
    try {
      const items = parseItems(convertQuote.items).map((it) => ({
        productId: it.productId ?? undefined,
        name: it.name,
        qty: it.qty,
        price: it.price,
      }))
      const res = await api<{ order: { id: string; orderNo: string; total: number } }>('/api/orders', {
        method: 'POST',
        body: { leadId: convertQuote.leadId, quotationId: convertQuote.id, items, discount: convertQuote.discount },
      })
      toast({ title: 'Order created', description: `${res.order.orderNo} — ${formatINR(res.order.total)}` })
      setConvertQuote(null)
      setDetail(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Convert failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setConverting(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await api<QuotationsResponse>(`/api/quotations${qs(buildParams(true))}`)
      const rows = (res.quotations ?? []).map((r) => ({
        quoteNo: r.quoteNo,
        lead: r.lead.leadCode,
        customer: r.lead.customerName,
        department: r.department,
        items: parseItems(r.items).length,
        subtotal: r.subtotal,
        discount: r.discount,
        total: r.total,
        status: r.status,
        validUntil: r.validUntil ? formatDate(r.validUntil) : '',
        createdBy: r.createdBy?.name ?? '',
        createdAt: formatDate(r.createdAt),
      }))
      downloadCSV(`quotations-${new Date().toISOString().slice(0, 10)}.csv`, rows)
      toast({ title: 'Export ready', description: `${rows.length} quotations exported to CSV` })
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  // ---------- table ----------

  const quotations = data?.quotations ?? []

  const columns: Column<QuotationRow>[] = [
    {
      key: 'quoteNo',
      header: 'Quote #',
      render: (row) => <span className="font-mono text-xs font-bold text-stone-800">{row.quoteNo}</span>,
    },
    {
      key: 'lead',
      header: 'Lead',
      render: (row) => (
        <div className="min-w-[150px]">
          <p className="font-medium text-stone-800">{row.lead.customerName}</p>
          <div className="flex items-center gap-1.5 text-xs text-stone-500">
            {row.lead.leadCode}
            <StatusBadge status={row.lead.department} variant="dept" className="hidden md:inline-flex" />
          </div>
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (row) => <span className="text-stone-600">{parseItems(row.items).length}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      className: 'text-right',
      render: (row) => <span className="font-semibold text-emerald-700">{formatINR(row.total)}</span>,
    },
    {
      key: 'discount',
      header: 'Discount',
      className: 'text-right',
      render: (row) =>
        row.discount ? <span className="text-rose-600">−{formatINR(row.discount)}</span> : <span className="text-stone-300">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} variant="quotation" />,
    },
    {
      key: 'validUntil',
      header: 'Valid Until',
      render: (row) => {
        if (!row.validUntil) return <span className="text-stone-400">—</span>
        const expired = new Date(row.validUntil).getTime() < Date.now() && !['ACCEPTED', 'CONVERTED', 'REJECTED'].includes(row.status)
        return (
          <span className={cn('whitespace-nowrap text-xs', expired ? 'font-semibold text-rose-600' : 'text-stone-600')}>
            {formatDate(row.validUntil)}
          </span>
        )
      },
    },
    {
      key: 'createdBy',
      header: 'Created By',
      render: (row) =>
        row.createdBy ? (
          <div className="flex items-center gap-2">
            <UserAvatar name={row.createdBy.name} className="h-6 w-6" />
            <span className="whitespace-nowrap text-xs">{row.createdBy.name}</span>
          </div>
        ) : (
          <span className="text-stone-400">—</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row) => <span className="whitespace-nowrap text-xs text-stone-500">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${row.quoteNo}`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetail(row)}>Open details</DropdownMenuItem>
              {row.status === 'DRAFT' ? (
                <DropdownMenuItem onClick={() => markSent(row)}>
                  <Send className="mr-2 h-4 w-4" aria-hidden /> Mark as Sent
                </DropdownMenuItem>
              ) : null}
              {CONVERTIBLE.includes(row.status) ? (
                <DropdownMenuItem onClick={() => setConvertQuote(row)}>
                  <ShoppingCart className="mr-2 h-4 w-4" aria-hidden /> Convert to Order
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ]

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fromIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(total, page * PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Quotations" subtitle="Share prices, track acceptance and convert winning quotes to orders">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh quotations">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting} aria-label="Export quotations as CSV">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          <span className="ml-1">Export CSV</span>
        </Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="ml-1">New Quotation</span>
        </Button>
      </PageHeader>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Quotes"
          value={kpi.total}
          sub="all quotations in scope"
          icon={<FileText className="h-4 w-4" aria-hidden />}
          onClick={() => {
            setStatus('')
            setPage(1)
          }}
        />
        <KpiCard
          label="Sent / Viewed"
          value={kpi.sent}
          tone="warning"
          sub="awaiting customer decision"
          icon={<Send className="h-4 w-4" aria-hidden />}
          onClick={() => {
            setStatus('SENT')
            setPage(1)
          }}
        />
        <KpiCard
          label="Accepted"
          value={kpi.accepted}
          tone="positive"
          sub="customer said yes"
          icon={<Check className="h-4 w-4" aria-hidden />}
          onClick={() => {
            setStatus('ACCEPTED')
            setPage(1)
          }}
        />
        <KpiCard
          label="Conversion Value"
          value={formatINR(kpi.conversionValue)}
          tone="positive"
          sub="accepted + converted value"
          icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
          onClick={() => {
            setStatus('CONVERTED')
            setPage(1)
          }}
        />
      </div>

      <FilterBar>
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search quote #, customer, lead code…"
          className="h-9 w-full sm:w-56"
          aria-label="Search quotations"
        />
        <Select
          value={status || 'all'}
          onValueChange={(v) => {
            setStatus(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[150px]" aria-label="Status filter">
            <SelectValue placeholder="Status: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: All</SelectItem>
            {QUOTATION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canPickDept ? (
          <Select
            value={dept || 'all'}
            onValueChange={(v) => {
              setDept(v === 'all' ? '' : v)
              setPage(1)
            }}
          >
            <SelectTrigger className="h-9 w-[150px]" aria-label="Department filter">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {leadId ? (
          <span className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
            Lead: <span className="max-w-[180px] truncate">{leadLabel || leadId}</span>
            <button type="button" onClick={() => { setLeadId(''); setPage(1) }} aria-label="Clear lead filter">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ) : null}
        {q || status || leadId ? (
          <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset all filters">
            <X className="h-4 w-4" aria-hidden /> Reset
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={quotations}
        loading={loading}
        onRowClick={(row) => setDetail(row)}
        emptyMessage="No quotations match the current filters"
      />

      {/* pagination */}
      <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p className="text-xs text-stone-500">
          Showing {fromIdx}–{toIdx} of {total} quotations
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            Previous
          </Button>
          <span className="text-xs text-stone-600">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            Next
          </Button>
        </div>
      </div>

      {/* detail dialog */}
      <Dialog open={Boolean(detail)} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{detail.quoteNo}</span>
                  <StatusBadge status={detail.status} variant="quotation" />
                </DialogTitle>
                <DialogDescription>
                  {detail.lead.customerName} · {DEPT_LABELS[detail.department] ?? detail.department} · Created {formatDateTime(detail.createdAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-400">Valid Until</p>
                  <p className="mt-0.5">{detail.validUntil ? formatDate(detail.validUntil) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-400">Sent At</p>
                  <p className="mt-0.5">{detail.sentAt ? formatDateTime(detail.sentAt) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-400">Created By</p>
                  <p className="mt-0.5">{detail.createdBy?.name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-400">Contact</p>
                  <p className="mt-0.5">{detail.lead.mobile}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-stone-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50">
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseItems(detail.items).map((it, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{it.name}</TableCell>
                        <TableCell className="text-right text-sm">{it.qty}</TableCell>
                        <TableCell className="text-right text-sm">{formatINR(it.price)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatINR(it.qty * it.price)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-stone-500">Subtotal</span>
                  <span>{formatINR(detail.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Discount</span>
                  <span className="text-rose-600">{detail.discount ? `−${formatINR(detail.discount)}` : formatINR(0)}</span>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-1 text-base font-bold text-emerald-700">
                  <span>Total</span>
                  <span>{formatINR(detail.total)}</span>
                </div>
              </div>

              {detail.notes ? (
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-stone-700">{detail.notes}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Select value={detail.status} onValueChange={(v) => updateStatus(detail, v)}>
                  <SelectTrigger className="h-9 w-[150px]" aria-label="Update quotation status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUOTATION_STATUSES.filter((s) => s !== 'CONVERTED').map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {detail.status === 'DRAFT' ? (
                  <Button variant="outline" size="sm" onClick={() => markSent(detail)}>
                    <Send className="mr-1 h-4 w-4" aria-hidden /> Mark as Sent
                  </Button>
                ) : null}
                {CONVERTIBLE.includes(detail.status) ? (
                  <Button size="sm" className="ml-auto bg-emerald-600 hover:bg-emerald-700" onClick={() => setConvertQuote(detail)}>
                    <ShoppingCart className="mr-1 h-4 w-4" aria-hidden /> Convert to Order
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* new quotation dialog */}
      <NewQuotationDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultLeadId={leadId}
        defaultLeadLabel={leadLabel}
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      {/* convert confirmation */}
      <AlertDialog open={Boolean(convertQuote)} onOpenChange={(o) => { if (!o && !converting) setConvertQuote(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert {convertQuote?.quoteNo} to Order?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a sales order of {convertQuote ? formatINR(convertQuote.total) : ''} for {convertQuote?.lead.customerName ?? 'the customer'},
              marks the quotation as CONVERTED and moves the lead to Order Confirmed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={converting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={converting}
              onClick={(e) => {
                e.preventDefault()
                convertToOrder()
              }}
            >
              {converting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Create Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- new quotation dialog ----------

function NewQuotationDialog({
  open,
  onOpenChange,
  defaultLeadId,
  defaultLeadLabel,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  defaultLeadId: string
  defaultLeadLabel: string
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [leadId, setLeadId] = useState('')
  const [rows, setRows] = useState<ItemRow[]>([{ productId: '', name: '', qty: '1', price: '' }])
  const [discount, setDiscount] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const products = useActiveProducts(open)

  // Reset the form when the dialog opens (render-time state adjustment)
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setLeadId(defaultLeadId ?? '')
      setRows([{ productId: '', name: '', qty: '1', price: '' }])
      setDiscount('')
      setValidUntil('')
      setNotes('')
    }
  }

  const fetchLeadOptions = useCallback(async (search: string): Promise<PickerOption[]> => {
    const res = await api<{
      leads: Array<{ id: string; leadCode: string; customerName: string; department: string; mobile: string }>
    }>(`/api/leads${qs({ q: search || undefined, pageSize: 20 })}`)
    return (res.leads ?? []).map((l) => ({
      id: l.id,
      label: `${l.leadCode} — ${l.customerName}`,
      sub: `${l.department}${l.mobile ? ` · ${l.mobile}` : ''}`,
    }))
  }, [])

  const subtotal = itemsSubtotal(rows)
  const discountNum = Math.max(0, Math.floor(Number(discount) || 0))
  const total = Math.max(0, subtotal - discountNum)

  const submit = async () => {
    if (!leadId) {
      toast({ title: 'Select a lead', description: 'Choose the customer this quotation is for.', variant: 'destructive' })
      return
    }
    const validRows = rows.filter((r) => (r.productId || r.name.trim()) && Math.floor(Number(r.qty) || 0) > 0)
    if (validRows.length === 0) {
      toast({ title: 'Add at least one item', description: 'Pick a product or type a custom item name.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const items = validRows.map((r) => ({
        productId: r.productId || undefined,
        name: r.productId ? (products.find((p) => p.id === r.productId)?.name ?? r.name.trim()) || 'Item' : r.name.trim(),
        qty: Math.floor(Number(r.qty) || 0),
        price: Math.max(0, Math.floor(Number(r.price) || 0)),
      }))
      const res = await api<{ quotation: QuotationRow }>('/api/quotations', {
        method: 'POST',
        body: { leadId, items, discount: discountNum, validUntil: validUntil || undefined, notes: notes.trim() || undefined },
      })
      toast({
        title: `Quotation ${res.quotation.quoteNo} created`,
        description: `${formatINR(res.quotation.total)} for ${res.quotation.lead.customerName}`,
      })
      setSaving(false)
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setSaving(false)
      toast({ title: 'Create failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Quotation</DialogTitle>
          <DialogDescription>
            Pick a lead, add line items and share the quote. Totals are calculated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Lead *</Label>
            <AsyncPicker
              value={leadId}
              onChange={setLeadId}
              fetchOptions={fetchLeadOptions}
              placeholder="Search lead by code or name…"
              searchPlaceholder="Type lead code or customer name…"
              emptyText="No leads found"
              ariaLabel="Quotation lead"
              disabled={saving}
              selectedOption={leadId && defaultLeadId === leadId && defaultLeadLabel ? { id: defaultLeadId, label: defaultLeadLabel } : null}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Line Items *</Label>
            <LineItemsEditor rows={rows} onChange={setRows} products={products} disabled={saving} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="q-discount">Discount (₹)</Label>
              <Input id="q-discount" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q-valid">Valid Until</Label>
              <Input id="q-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={saving} />
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-500">Subtotal</span>
                <span>{formatINR(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Discount</span>
                <span className="text-rose-600">{discountNum ? `−${formatINR(discountNum)}` : formatINR(0)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-stone-200 pt-1 font-bold text-emerald-700">
                <span>Total</span>
                <span>{formatINR(total)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="q-notes">Notes</Label>
            <Textarea id="q-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Terms, delivery window, fabric notes…" disabled={saving} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={saving} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Create Quotation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
