'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Download,
  FileText,
  IndianRupee,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShoppingCart,
  Truck,
  X,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { useMasters } from '@/components/crm/shared/use-masters'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { CUSTOMER_TYPES, DEPARTMENTS, DEPT_LABELS, ORDER_STATUSES, PAYMENT_STATUSES } from '@/lib/constants'
import { formatDate, formatDateTime, formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import {
  AsyncPicker,
  LineItemsEditor,
  itemsSubtotal,
  parseItems,
  useActiveProducts,
  type ItemRow,
  type PickerOption,
} from './quotations-view'
import { RecordPaymentDialog, type PaymentPreset } from './payments-view'

// ---------- types ----------

type OrderInvoice = {
  id: string
  invoiceNo: string
  amount: number
  paidAmount: number
  status: string
  dueDate: string | null
  createdAt: string
}

type OrderShipment = {
  id: string
  stage: string
  courierName: string | null
  awbNumber: string | null
  trackingUrl: string | null
  dispatchedAt: string | null
  deliveredAt: string | null
}

type OrderRow = {
  id: string
  orderNo: string
  leadId: string
  department: string
  items: string
  total: number
  paidAmount: number
  paymentStatus: string
  customerType: string
  status: string
  notes: string | null
  createdAt: string
  lead: { id: string; leadCode: string; customerName: string; department: string; mobile: string }
  shipment: OrderShipment | null
  invoices: OrderInvoice[]
  createdBy: { id: string; name: string } | null
}

type OrdersResponse = {
  orders: OrderRow[]
  total: number
  summary: { count: number; total: number; pending: number; partial: number; paid: number }
}

type Kpis = {
  count: number
  totalValue: number
  pendingAmount: number
  pendingCount: number
  partialCount: number
  partialAmount: number
}

const PAGE_SIZE = 20

export default function OrdersView() {
  const user = useAppStore((s) => s.user)
  const storeParams = useAppStore((s) => s.params)
  const { toast } = useToast()
  const masters = useMasters()

  const canPickDept = !user?.department
  const paramLeadId = typeof storeParams.leadId === 'string' ? storeParams.leadId : ''
  const paramQuotationId = typeof storeParams.quotationId === 'string' ? storeParams.quotationId : ''

  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [dept, setDept] = useState(user?.department ?? '')
  const [status, setStatus] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('')
  const [leadId, setLeadId] = useState(paramLeadId)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<OrdersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [kpi, setKpi] = useState<Kpis>({
    count: 0,
    totalValue: 0,
    pendingAmount: 0,
    pendingCount: 0,
    partialCount: 0,
    partialAmount: 0,
  })
  const [leadLabel, setLeadLabel] = useState('')

  const [detail, setDetail] = useState<OrderRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [payFor, setPayFor] = useState<OrderRow | null>(null)
  const [shipmentFor, setShipmentFor] = useState<OrderRow | null>(null)
  const [shipmentCourier, setShipmentCourier] = useState('')
  const [creatingShipment, setCreatingShipment] = useState(false)
  const [exporting, setExporting] = useState(false)

  // pre-open the create dialog when navigated from a quotation flow
  useEffect(() => {
    if (paramQuotationId) setFormOpen(true)
  }, [paramQuotationId])

  // keep leadId filter in sync when navigated with a leadId param while mounted
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
      paymentStatus: paymentStatus || undefined,
      leadId: leadId || undefined,
      ...(forExport ? { pageSize: 200 } : { page, pageSize: PAGE_SIZE }),
    }),
    [q, dept, status, paymentStatus, leadId, page]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<OrdersResponse>(`/api/orders${qs(buildParams())}`)
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load orders', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [buildParams, toast])

  const loadKpis = useCallback(async () => {
    try {
      const res = await api<OrdersResponse>(
        `/api/orders${qs({ q: q || undefined, dept: dept || undefined, leadId: leadId || undefined, pageSize: 200 })}`
      )
      const rows = res.orders ?? []
      const outstanding = (r: OrderRow) => Math.max(0, (r.total || 0) - (r.paidAmount || 0))
      const pendingRows = rows.filter((r) => r.paymentStatus === 'PENDING')
      const partialRows = rows.filter((r) => r.paymentStatus === 'PARTIAL')
      setKpi({
        count: res.total ?? rows.length,
        totalValue: rows.reduce((s, r) => s + (r.total || 0), 0),
        pendingAmount: pendingRows.reduce((s, r) => s + outstanding(r), 0),
        pendingCount: pendingRows.length,
        partialCount: partialRows.length,
        partialAmount: partialRows.reduce((s, r) => s + outstanding(r), 0),
      })
    } catch {
      // KPI numbers are non-critical — keep previous values
    }
  }, [q, dept, leadId])

  useEffect(() => {
    load()
    loadKpis()
  }, [load, loadKpis, reloadKey])

  // keep the open detail dialog in sync with freshly loaded data
  useEffect(() => {
    if (!detail) return
    const fresh = (data?.orders ?? []).find((o) => o.id === detail.id)
    if (fresh && fresh !== detail) setDetail(fresh)
  }, [data, detail])

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
    setPaymentStatus('')
    setLeadId('')
    setPage(1)
  }

  // ---------- actions ----------

  const patchOrder = async (row: OrderRow, patch: { status?: string; paymentStatus?: string }) => {
    try {
      const res = await api<{ order: OrderRow }>('/api/orders', { method: 'PATCH', body: { id: row.id, ...patch } })
      toast({ title: 'Order updated', description: `${row.orderNo} saved` })
      setDetail(res.order)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const generateInvoice = async (row: OrderRow) => {
    try {
      const res = await api<{ invoice: { invoiceNo: string; amount: number } }>('/api/invoices', {
        method: 'POST',
        body: { orderId: row.id },
      })
      toast({ title: 'Invoice generated', description: `${res.invoice.invoiceNo} — ${formatINR(res.invoice.amount)}` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Invoice failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const submitShipment = async () => {
    if (!shipmentFor) return
    setCreatingShipment(true)
    try {
      const res = await api<{ shipment: { id: string; stage: string } }>('/api/shipments', {
        method: 'POST',
        body: { orderId: shipmentFor.id, courierName: shipmentCourier && shipmentCourier !== 'none' ? shipmentCourier : undefined },
      })
      toast({
        title: 'Shipment created',
        description: `${shipmentFor.orderNo} is now ${res.shipment.stage} — track progress in Dispatch view`,
      })
      setCreatingShipment(false)
      setShipmentFor(null)
      setShipmentCourier('')
      setReloadKey((k) => k + 1)
    } catch (e) {
      setCreatingShipment(false)
      toast({ title: 'Shipment failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await api<OrdersResponse>(`/api/orders${qs(buildParams(true))}`)
      const rows = (res.orders ?? []).map((o) => ({
        orderNo: o.orderNo,
        lead: o.lead.leadCode,
        customer: o.lead.customerName,
        department: o.department,
        items: parseItems(o.items).length,
        total: o.total,
        paid: o.paidAmount,
        balance: Math.max(0, o.total - o.paidAmount),
        paymentStatus: o.paymentStatus,
        status: o.status,
        customerType: o.customerType,
        createdBy: o.createdBy?.name ?? '',
        createdAt: formatDate(o.createdAt),
      }))
      downloadCSV(`sales-orders-${new Date().toISOString().slice(0, 10)}.csv`, rows)
      toast({ title: 'Export ready', description: `${rows.length} orders exported to CSV` })
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  // ---------- table ----------

  const orders = data?.orders ?? []
  const courierOptions = masters.items('courier')

  const columns: Column<OrderRow>[] = [
    {
      key: 'orderNo',
      header: 'Order #',
      render: (row) => <span className="font-mono text-xs font-bold text-stone-800">{row.orderNo}</span>,
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
      key: 'customerType',
      header: 'Type',
      render: (row) => (
        <Badge
          variant="outline"
          className={cn(
            'whitespace-nowrap border font-medium',
            row.customerType === 'REPEAT' ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-stone-200 bg-stone-100 text-stone-600'
          )}
        >
          {row.customerType}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      className: 'text-right',
      render: (row) => <span className="font-semibold text-emerald-700">{formatINR(row.total)}</span>,
    },
    {
      key: 'paid',
      header: 'Paid',
      className: 'text-right',
      render: (row) => <span className="text-stone-600">{formatINR(row.paidAmount)}</span>,
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      render: (row) => <StatusBadge status={row.paymentStatus} variant="payment" />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} variant="order" />,
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
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${row.orderNo}`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetail(row)}>Open details</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPayFor(row)}>
                <IndianRupee className="mr-2 h-4 w-4" aria-hidden /> Record Payment
              </DropdownMenuItem>
              {row.invoices.length === 0 ? (
                <DropdownMenuItem onClick={() => generateInvoice(row)}>
                  <FileText className="mr-2 h-4 w-4" aria-hidden /> Generate Invoice
                </DropdownMenuItem>
              ) : null}
              {!row.shipment ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShipmentFor(row)}>
                    <Truck className="mr-2 h-4 w-4" aria-hidden /> Create Shipment
                  </DropdownMenuItem>
                </>
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
      <PageHeader title="Sales Orders" subtitle="Confirmed orders, payments received and fulfilment status">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh orders">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting} aria-label="Export orders as CSV">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          <span className="ml-1">Export CSV</span>
        </Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="ml-1">New Order</span>
        </Button>
      </PageHeader>

      {/* KPI cards */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Orders"
          value={kpi.count}
          sub="in current scope"
          icon={<ShoppingCart className="h-4 w-4" aria-hidden />}
          onClick={() => {
            setStatus('')
            setPaymentStatus('')
            setPage(1)
          }}
        />
        <KpiCard
          label="Total Value"
          value={formatINR(kpi.totalValue)}
          sub="all filtered orders"
          icon={<FileText className="h-4 w-4" aria-hidden />}
          onClick={() => {
            setStatus('')
            setPaymentStatus('')
            setPage(1)
          }}
        />
        <KpiCard
          label="Pending Payment"
          value={formatINR(kpi.pendingAmount)}
          tone="negative"
          sub={`${kpi.pendingCount} order(s) awaiting payment`}
          icon={<IndianRupee className="h-4 w-4" aria-hidden />}
          onClick={() => {
            setPaymentStatus('PENDING')
            setPage(1)
          }}
        />
        <KpiCard
          label="Partially Paid"
          value={kpi.partialCount}
          tone="warning"
          sub={`${formatINR(kpi.partialAmount)} outstanding`}
          icon={<IndianRupee className="h-4 w-4" aria-hidden />}
          onClick={() => {
            setPaymentStatus('PARTIAL')
            setPage(1)
          }}
        />
      </div>

      <FilterBar>
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search order #, customer, lead code…"
          className="h-9 w-full sm:w-56"
          aria-label="Search orders"
        />
        <Select
          value={status || 'all'}
          onValueChange={(v) => {
            setStatus(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[150px]" aria-label="Order status filter">
            <SelectValue placeholder="Status: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: All</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s.replaceAll('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={paymentStatus || 'all'}
          onValueChange={(v) => {
            setPaymentStatus(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[160px]" aria-label="Payment status filter">
            <SelectValue placeholder="Payment: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Payment: All</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
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
        {q || status || paymentStatus || leadId ? (
          <Button variant="ghost" size="sm" onClick={resetFilters} aria-label="Reset all filters">
            <X className="h-4 w-4" aria-hidden /> Reset
          </Button>
        ) : null}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={orders}
        loading={loading}
        onRowClick={(row) => setDetail(row)}
        emptyMessage="No orders match the current filters"
      />

      {/* pagination */}
      <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p className="text-xs text-stone-500">
          Showing {fromIdx}–{toIdx} of {total} orders
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
                  <span className="font-mono">{detail.orderNo}</span>
                  <StatusBadge status={detail.paymentStatus} variant="payment" />
                  <StatusBadge status={detail.status} variant="order" />
                </DialogTitle>
                <DialogDescription>
                  {detail.lead.customerName} ({detail.lead.leadCode}) · {DEPT_LABELS[detail.department] ?? detail.department} · Created{' '}
                  {formatDateTime(detail.createdAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-400">Contact</p>
                  <p className="mt-0.5">{detail.lead.mobile}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-400">Customer Type</p>
                  <p className="mt-0.5">{detail.customerType}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-400">Created By</p>
                  <p className="mt-0.5">{detail.createdBy?.name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-400">Created At</p>
                  <p className="mt-0.5">{formatDate(detail.createdAt)}</p>
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
                  <span className="text-stone-500">Total</span>
                  <span>{formatINR(detail.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-500">Paid</span>
                  <span className="text-emerald-700">{formatINR(detail.paidAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-1 font-bold">
                  <span className="text-stone-500">Balance</span>
                  <span className={detail.total - detail.paidAmount > 0 ? 'text-rose-600' : 'text-emerald-700'}>
                    {formatINR(Math.max(0, detail.total - detail.paidAmount))}
                  </span>
                </div>
              </div>

              {detail.notes ? (
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-stone-700">{detail.notes}</p>
                </div>
              ) : null}

              {/* invoices */}
              <div className="rounded-lg border border-stone-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Invoices</p>
                  {detail.invoices.length === 0 ? (
                    <Button size="sm" variant="outline" onClick={() => generateInvoice(detail)}>
                      <FileText className="mr-1 h-4 w-4" aria-hidden /> Generate Invoice
                    </Button>
                  ) : null}
                </div>
                {detail.invoices.length ? (
                  <div className="space-y-2">
                    {detail.invoices.map((inv) => {
                      const overdue = Boolean(inv.dueDate && new Date(inv.dueDate).getTime() < Date.now() && inv.status !== 'PAID')
                      return (
                        <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-100 bg-stone-50 px-3 py-2 text-sm">
                          <span className="font-mono text-xs font-bold text-stone-700">{inv.invoiceNo}</span>
                          <span className="text-stone-600">
                            {formatINR(inv.amount)} · paid {formatINR(inv.paidAmount)}
                          </span>
                          <span className={cn('text-xs', overdue ? 'font-semibold text-rose-600' : 'text-stone-500')}>
                            {inv.dueDate ? `Due ${formatDate(inv.dueDate)}` : 'No due date'}
                          </span>
                          <StatusBadge status={inv.status} variant="payment" />
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-stone-400">No invoice yet for this order.</p>
                )}
              </div>

              {/* shipment */}
              {detail.shipment ? (
                <div className="rounded-lg border border-stone-200 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Shipment</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusBadge status={detail.shipment.stage} variant="shipment" />
                    {detail.shipment.courierName ? <span className="text-stone-600">Courier: {detail.shipment.courierName}</span> : null}
                    {detail.shipment.awbNumber ? <span className="font-mono text-xs text-stone-500">AWB {detail.shipment.awbNumber}</span> : null}
                    {detail.shipment.trackingUrl ? (
                      <a
                        href={detail.shipment.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                      >
                        Track parcel
                      </a>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-stone-400">Manage stages in the Dispatch view.</p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-stone-300 p-3">
                  <p className="text-sm text-stone-500">No shipment created yet — packing starts from Dispatch.</p>
                  <Button size="sm" variant="outline" onClick={() => setShipmentFor(detail)}>
                    <Truck className="mr-1 h-4 w-4" aria-hidden /> Create Shipment
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Select value={detail.status} onValueChange={(v) => patchOrder(detail, { status: v })}>
                  <SelectTrigger className="h-9 w-[150px]" aria-label="Update order status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s.replaceAll('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={detail.paymentStatus} onValueChange={(v) => patchOrder(detail, { paymentStatus: v })}>
                  <SelectTrigger className="h-9 w-[150px]" aria-label="Update payment status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" className="ml-auto bg-emerald-600 hover:bg-emerald-700" onClick={() => setPayFor(detail)}>
                  <IndianRupee className="mr-1 h-4 w-4" aria-hidden /> Record Payment
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* new order dialog */}
      <NewOrderDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultLeadId={leadId}
        defaultLeadLabel={leadLabel}
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      {/* record payment (shared dialog, preset to this order) */}
      <RecordPaymentDialog
        open={Boolean(payFor)}
        onOpenChange={(o) => {
          if (!o) setPayFor(null)
        }}
        preset={
          payFor
            ? {
                kind: 'order',
                id: payFor.id,
                label: `${payFor.orderNo} — ${payFor.lead.customerName}`,
                outstanding: Math.max(0, payFor.total - payFor.paidAmount),
              }
            : null
        }
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      {/* create shipment dialog */}
      <Dialog open={Boolean(shipmentFor)} onOpenChange={(o) => { if (!o && !creatingShipment) setShipmentFor(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Shipment {shipmentFor?.orderNo ? `— ${shipmentFor.orderNo}` : ''}</DialogTitle>
            <DialogDescription>
              A packing task is created for the dispatch team. The order moves to IN_PROCESS.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Courier Partner (optional)</Label>
            <Select value={shipmentCourier || 'none'} onValueChange={setShipmentCourier} disabled={creatingShipment}>
              <SelectTrigger aria-label="Courier partner">
                <SelectValue placeholder="Select courier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Decide later —</SelectItem>
                {courierOptions.map((c) => (
                  <SelectItem key={c.id} value={c.label}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={creatingShipment} onClick={() => setShipmentFor(null)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={creatingShipment} onClick={submitShipment}>
              {creatingShipment ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Truck className="mr-1 h-4 w-4" aria-hidden />}
              Create Shipment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------- new order dialog ----------

function NewOrderDialog({
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
  const [customerType, setCustomerType] = useState('')
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
      setCustomerType('')
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
      toast({ title: 'Select a lead', description: 'Choose the customer this order is for.', variant: 'destructive' })
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
      const res = await api<{ order: { id: string; orderNo: string; total: number } }>('/api/orders', {
        method: 'POST',
        body: {
          leadId,
          items,
          discount: discountNum,
          customerType: customerType || undefined,
          notes: notes.trim() || undefined,
        },
      })
      toast({ title: 'Order created', description: `${res.order.orderNo} — ${formatINR(res.order.total)}` })
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
          <DialogTitle>New Sales Order</DialogTitle>
          <DialogDescription>
            Confirm an order for a lead. The lead moves to Order Confirmed and is marked CONVERTED.
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
              ariaLabel="Order lead"
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
              <Label htmlFor="ord-discount">Discount (₹)</Label>
              <Input id="ord-discount" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label>Customer Type</Label>
              <Select value={customerType || 'auto'} onValueChange={(v) => setCustomerType(v === 'auto' ? '' : v)} disabled={saving}>
                <SelectTrigger aria-label="Customer type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (from history)</SelectItem>
                  {CUSTOMER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Label htmlFor="ord-notes">Notes</Label>
            <Textarea id="ord-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions, payment terms…" disabled={saving} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={saving} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Create Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
