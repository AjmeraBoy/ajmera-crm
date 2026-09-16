'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CalendarDays,
  Clock,
  Download,
  FileText,
  IndianRupee,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Wallet,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { DEPARTMENTS, DEPT_LABELS, PAYMENT_MODES, PAYMENT_MODE_LABELS } from '@/lib/constants'
import { formatDate, formatDateTime, formatINR, toInputDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { AsyncPicker, type PickerOption } from './quotations-view'

// ---------- types ----------

type PaymentRow = {
  id: string
  receiptNo: string
  amount: number
  mode: string
  reference: string | null
  isAdvance: boolean
  notes: string | null
  paidAt: string
  department: string
  lead: { id: string; leadCode: string; customerName: string } | null
  order: { orderNo: string } | null
  invoice: { invoiceNo: string } | null
  createdBy: { id: string; name: string } | null
}

type PaymentsResponse = {
  payments: PaymentRow[]
  total: number
  summary: { total: number; thisMonth: number; today: number }
}

type InvoiceRow = {
  id: string
  invoiceNo: string
  amount: number
  paidAmount: number
  status: string
  dueDate: string | null
  notes: string | null
  createdAt: string
  order: { orderNo: string; department: string; lead: { id: string; leadCode: string; customerName: string; department: string } }
}

type InvoicesResponse = {
  invoices: InvoiceRow[]
  total: number
  summary: { totalAmount: number; outstanding: number }
}

export type PaymentPreset =
  | { kind: 'order'; id: string; label: string; outstanding?: number }
  | { kind: 'invoice'; id: string; label: string; amount?: number; paidAmount?: number }
  | { kind: 'lead'; id: string; label: string }

const PAGE_SIZE = 20
const INVOICE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE']
const INVOICE_MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTS']

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- component ----------

export default function PaymentsView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const canPickDept = !user?.department
  const canManageInvoiceStatus = INVOICE_MANAGEMENT_ROLES.includes(user?.role ?? '')

  const [tab, setTab] = useState<'payments' | 'invoices'>('payments')
  const [reloadKey, setReloadKey] = useState(0)
  const [exporting, setExporting] = useState(false)

  // payments tab state
  const [pmtQInput, setPmtQInput] = useState('')
  const [pmtQ, setPmtQ] = useState('')
  const [pmtMode, setPmtMode] = useState('')
  const [pmtFrom, setPmtFrom] = useState('')
  const [pmtTo, setPmtTo] = useState('')
  const [pmtDept, setPmtDept] = useState(user?.department ?? '')
  const [pmtPage, setPmtPage] = useState(1)
  const [pmtData, setPmtData] = useState<PaymentsResponse | null>(null)
  const [pmtLoading, setPmtLoading] = useState(true)

  // invoices tab state
  const [invQInput, setInvQInput] = useState('')
  const [invQ, setInvQ] = useState('')
  const [invStatus, setInvStatus] = useState('')
  const [invDept, setInvDept] = useState(user?.department ?? '')
  const [invPage, setInvPage] = useState(1)
  const [invData, setInvData] = useState<InvoicesResponse | null>(null)
  const [invLoading, setInvLoading] = useState(true)

  const [payOpen, setPayOpen] = useState(false)
  const [payPreset, setPayPreset] = useState<PaymentPreset | null>(null)
  const [invoiceOpen, setInvoiceOpen] = useState(false)

  // debounce searches
  useEffect(() => {
    const t = setTimeout(() => {
      setPmtQ(pmtQInput)
      setPmtPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [pmtQInput])

  useEffect(() => {
    const t = setTimeout(() => {
      setInvQ(invQInput)
      setInvPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [invQInput])

  const loadPayments = useCallback(async () => {
    setPmtLoading(true)
    try {
      const res = await api<PaymentsResponse>(
        `/api/payments${qs({
          q: pmtQ || undefined,
          mode: pmtMode || undefined,
          from: pmtFrom || undefined,
          to: pmtTo || undefined,
          dept: pmtDept || undefined,
          page: pmtPage,
          pageSize: PAGE_SIZE,
        })}`
      )
      setPmtData(res)
    } catch (e) {
      toast({ title: 'Failed to load payments', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setPmtLoading(false)
    }
  }, [pmtQ, pmtMode, pmtFrom, pmtTo, pmtDept, pmtPage, toast])

  const loadInvoices = useCallback(async () => {
    setInvLoading(true)
    try {
      const res = await api<InvoicesResponse>(
        `/api/invoices${qs({
          q: invQ || undefined,
          status: invStatus || undefined,
          dept: invDept || undefined,
          page: invPage,
          pageSize: PAGE_SIZE,
        })}`
      )
      setInvData(res)
    } catch (e) {
      toast({ title: 'Failed to load invoices', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setInvLoading(false)
    }
  }, [invQ, invStatus, invDept, invPage, toast])

  useEffect(() => {
    loadPayments()
  }, [loadPayments, reloadKey])

  useEffect(() => {
    loadInvoices()
  }, [loadInvoices, reloadKey])

  // ---------- actions ----------

  const updateInvoiceStatus = async (inv: InvoiceRow, status: string) => {
    try {
      await api('/api/invoices', { method: 'PATCH', body: { id: inv.id, status } })
      toast({ title: 'Invoice updated', description: `${inv.invoiceNo} → ${status}` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const openPaymentForInvoice = (inv: InvoiceRow) => {
    setPayPreset({
      kind: 'invoice',
      id: inv.id,
      label: `${inv.invoiceNo} — ${inv.order.lead.customerName}`,
      amount: inv.amount,
      paidAmount: inv.paidAmount,
    })
    setPayOpen(true)
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      if (tab === 'payments') {
        const res = await api<PaymentsResponse>(
          `/api/payments${qs({
            q: pmtQ || undefined,
            mode: pmtMode || undefined,
            from: pmtFrom || undefined,
            to: pmtTo || undefined,
            dept: pmtDept || undefined,
            pageSize: 200,
          })}`
        )
        const rows = (res.payments ?? []).map((p) => ({
          receiptNo: p.receiptNo,
          lead: p.lead ? `${p.lead.leadCode} — ${p.lead.customerName}` : '',
          order: p.order?.orderNo ?? '',
          invoice: p.invoice?.invoiceNo ?? '',
          amount: p.amount,
          mode: PAYMENT_MODE_LABELS[p.mode] ?? p.mode,
          reference: p.reference ?? '',
          type: p.isAdvance ? 'Advance' : 'Regular',
          paidAt: formatDateTime(p.paidAt),
          receivedBy: p.createdBy?.name ?? '',
        }))
        downloadCSV(`payments-${new Date().toISOString().slice(0, 10)}.csv`, rows)
        toast({ title: 'Export ready', description: `${rows.length} payments exported to CSV` })
      } else {
        const res = await api<InvoicesResponse>(
          `/api/invoices${qs({
            q: invQ || undefined,
            status: invStatus || undefined,
            dept: invDept || undefined,
            pageSize: 200,
          })}`
        )
        const rows = (res.invoices ?? []).map((i) => ({
          invoiceNo: i.invoiceNo,
          orderNo: i.order.orderNo,
          lead: `${i.order.lead.leadCode} — ${i.order.lead.customerName}`,
          amount: i.amount,
          paidAmount: i.paidAmount,
          balance: Math.max(0, i.amount - i.paidAmount),
          dueDate: i.dueDate ? formatDate(i.dueDate) : '',
          status: i.status,
          createdAt: formatDate(i.createdAt),
        }))
        downloadCSV(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, rows)
        toast({ title: 'Export ready', description: `${rows.length} invoices exported to CSV` })
      }
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  // ---------- payments table ----------

  const payments = pmtData?.payments ?? []
  const pmtSummary = pmtData?.summary ?? { total: 0, thisMonth: 0, today: 0 }
  const pmtTotal = pmtData?.total ?? 0
  const pmtTotalPages = Math.max(1, Math.ceil(pmtTotal / PAGE_SIZE))
  const pmtFromIdx = pmtTotal === 0 ? 0 : (pmtPage - 1) * PAGE_SIZE + 1
  const pmtToIdx = Math.min(pmtTotal, pmtPage * PAGE_SIZE)

  const paymentColumns: Column<PaymentRow>[] = [
    {
      key: 'receiptNo',
      header: 'Receipt #',
      render: (row) => <span className="font-mono text-xs font-bold text-stone-800">{row.receiptNo}</span>,
    },
    {
      key: 'lead',
      header: 'Lead',
      render: (row) =>
        row.lead ? (
          <div className="min-w-[130px]">
            <p className="font-medium text-stone-800">{row.lead.customerName}</p>
            <p className="text-xs text-stone-500">{row.lead.leadCode}</p>
          </div>
        ) : (
          <span className="text-stone-400">—</span>
        ),
    },
    {
      key: 'order',
      header: 'Order',
      render: (row) =>
        row.order ? <span className="font-mono text-xs text-stone-600">{row.order.orderNo}</span> : <span className="text-stone-300">—</span>,
    },
    {
      key: 'invoice',
      header: 'Invoice',
      render: (row) =>
        row.invoice ? <span className="font-mono text-xs text-stone-600">{row.invoice.invoiceNo}</span> : <span className="text-stone-300">—</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right',
      render: (row) => <span className="font-semibold text-emerald-700">{formatINR(row.amount)}</span>,
    },
    {
      key: 'mode',
      header: 'Mode',
      render: (row) => (
        <Badge variant="outline" className="whitespace-nowrap border-stone-200 font-medium text-stone-600">
          {PAYMENT_MODE_LABELS[row.mode] ?? row.mode}
        </Badge>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (row) => (row.reference ? <span className="text-xs text-stone-500">{row.reference}</span> : <span className="text-stone-300">—</span>),
    },
    {
      key: 'isAdvance',
      header: 'Type',
      render: (row) =>
        row.isAdvance ? (
          <Badge className="border border-amber-200 bg-amber-100 font-medium text-amber-700">Advance</Badge>
        ) : (
          <span className="text-xs text-stone-400">Regular</span>
        ),
    },
    {
      key: 'paidAt',
      header: 'Paid At',
      render: (row) => <span className="whitespace-nowrap text-xs text-stone-500">{formatDateTime(row.paidAt)}</span>,
    },
    {
      key: 'createdBy',
      header: 'By',
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
  ]

  // ---------- invoices table ----------

  const invoices = invData?.invoices ?? []
  const invSummary = invData?.summary ?? { totalAmount: 0, outstanding: 0 }
  const invTotal = invData?.total ?? 0
  const invTotalPages = Math.max(1, Math.ceil(invTotal / PAGE_SIZE))
  const invFromIdx = invTotal === 0 ? 0 : (invPage - 1) * PAGE_SIZE + 1
  const invToIdx = Math.min(invTotal, invPage * PAGE_SIZE)

  const isOverdue = (inv: InvoiceRow) => Boolean(inv.dueDate && new Date(inv.dueDate).getTime() < Date.now() && inv.status !== 'PAID')

  const invoiceColumns: Column<InvoiceRow>[] = [
    {
      key: 'invoiceNo',
      header: 'Invoice #',
      render: (row) => <span className="font-mono text-xs font-bold text-stone-800">{row.invoiceNo}</span>,
    },
    {
      key: 'orderNo',
      header: 'Order',
      render: (row) => <span className="font-mono text-xs text-stone-600">{row.order.orderNo}</span>,
    },
    {
      key: 'lead',
      header: 'Lead',
      render: (row) => (
        <div className="min-w-[130px]">
          <p className="font-medium text-stone-800">{row.order.lead.customerName}</p>
          <div className="flex items-center gap-1.5 text-xs text-stone-500">
            {row.order.lead.leadCode}
            <StatusBadge status={row.order.lead.department} variant="dept" className="hidden md:inline-flex" />
          </div>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right',
      render: (row) => <span className="font-semibold text-stone-800">{formatINR(row.amount)}</span>,
    },
    {
      key: 'paidAmount',
      header: 'Paid',
      className: 'text-right',
      render: (row) => <span className="text-stone-600">{formatINR(row.paidAmount)}</span>,
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      render: (row) =>
        row.dueDate ? (
          <span className={cn('whitespace-nowrap text-xs', isOverdue(row) ? 'font-semibold text-rose-600' : 'text-stone-600')}>
            {formatDate(row.dueDate)}
            {isOverdue(row) ? ' · Overdue' : ''}
          </span>
        ) : (
          <span className="text-stone-400">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={row.status} variant="payment" />,
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${row.invoiceNo}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openPaymentForInvoice(row)}>
              <IndianRupee className="mr-2 h-4 w-4" aria-hidden /> Record Payment
            </DropdownMenuItem>
            {canManageInvoiceStatus ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Update status</DropdownMenuLabel>
                {INVOICE_STATUSES.filter((s) => s !== row.status).map((s) => (
                  <DropdownMenuItem key={s} onClick={() => updateInvoiceStatus(row, s)}>
                    Mark {s.toLowerCase()}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title="Payments & Invoices" subtitle="Collections, receipts and order invoicing">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh">
          <RefreshCw className={cn('h-4 w-4', (pmtLoading || invLoading) && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting} aria-label="Export as CSV">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          <span className="ml-1">Export CSV</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-sky-200 text-sky-700 hover:bg-sky-50"
          onClick={() => setInvoiceOpen(true)}
        >
          <FileText className="h-4 w-4" aria-hidden />
          <span className="ml-1">Generate Invoice</span>
        </Button>
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={() => {
            setPayPreset(null)
            setPayOpen(true)
          }}
        >
          <IndianRupee className="h-4 w-4" aria-hidden />
          <span className="ml-1">Record Payment</span>
        </Button>
      </PageHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'payments' | 'invoices')}>
        <TabsList className="mb-4">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        {/* ---------- PAYMENTS TAB ---------- */}
        <TabsContent value="payments" className="mt-0">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard
              label="Total Collected"
              value={formatINR(pmtSummary.total)}
              sub={`${pmtTotal} receipt(s) in scope`}
              icon={<Wallet className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setPmtFrom('')
                setPmtTo('')
                setPmtPage(1)
              }}
            />
            <KpiCard
              label="This Month"
              value={formatINR(pmtSummary.thisMonth)}
              tone="positive"
              sub="collected this month"
              icon={<CalendarDays className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setPmtFrom(`${todayStr().slice(0, 8)}01`)
                setPmtTo('')
                setPmtPage(1)
              }}
            />
            <KpiCard
              label="Today"
              value={formatINR(pmtSummary.today)}
              tone="positive"
              sub="collected today"
              icon={<Clock className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setPmtFrom(todayStr())
                setPmtTo('')
                setPmtPage(1)
              }}
            />
          </div>

          <FilterBar>
            <Input
              value={pmtQInput}
              onChange={(e) => setPmtQInput(e.target.value)}
              placeholder="Search receipt, reference, customer…"
              className="h-9 w-full sm:w-56"
              aria-label="Search payments"
            />
            <Select
              value={pmtMode || 'all'}
              onValueChange={(v) => {
                setPmtMode(v === 'all' ? '' : v)
                setPmtPage(1)
              }}
            >
              <SelectTrigger className="h-9 w-[150px]" aria-label="Payment mode filter">
                <SelectValue placeholder="Mode: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Mode: All</SelectItem>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={pmtFrom}
                onChange={(e) => {
                  setPmtFrom(e.target.value)
                  setPmtPage(1)
                }}
                className="h-9 w-[140px]"
                aria-label="Paid from date"
              />
              <span className="text-xs text-stone-400">to</span>
              <Input
                type="date"
                value={pmtTo}
                onChange={(e) => {
                  setPmtTo(e.target.value)
                  setPmtPage(1)
                }}
                className="h-9 w-[140px]"
                aria-label="Paid to date"
              />
            </div>
            {canPickDept ? (
              <Select
                value={pmtDept || 'all'}
                onValueChange={(v) => {
                  setPmtDept(v === 'all' ? '' : v)
                  setPmtPage(1)
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
            {pmtQ || pmtMode || pmtFrom || pmtTo ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPmtQInput('')
                  setPmtQ('')
                  setPmtMode('')
                  setPmtFrom('')
                  setPmtTo('')
                  setPmtPage(1)
                }}
                aria-label="Reset payment filters"
              >
                <X className="h-4 w-4" aria-hidden /> Reset
              </Button>
            ) : null}
          </FilterBar>

          <DataTable
            columns={paymentColumns}
            rows={payments}
            loading={pmtLoading}
            emptyMessage="No payments match the current filters"
          />

          <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
            <p className="text-xs text-stone-500">
              Showing {pmtFromIdx}–{pmtToIdx} of {pmtTotal} payments
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={pmtPage <= 1 || pmtLoading} onClick={() => setPmtPage((p) => p - 1)} aria-label="Previous page">
                Previous
              </Button>
              <span className="text-xs text-stone-600">Page {pmtPage} of {pmtTotalPages}</span>
              <Button variant="outline" size="sm" disabled={pmtPage >= pmtTotalPages || pmtLoading} onClick={() => setPmtPage((p) => p + 1)} aria-label="Next page">
                Next
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ---------- INVOICES TAB ---------- */}
        <TabsContent value="invoices" className="mt-0">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiCard
              label="Invoiced"
              value={formatINR(invSummary.totalAmount)}
              sub={`${invTotal} invoice(s) in scope`}
              icon={<FileText className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setInvStatus('')
                setInvPage(1)
              }}
            />
            <KpiCard
              label="Outstanding"
              value={formatINR(invSummary.outstanding)}
              tone="negative"
              sub="unpaid + partial + overdue balance"
              icon={<IndianRupee className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setInvStatus('UNPAID')
                setInvPage(1)
              }}
            />
          </div>

          <FilterBar>
            <Input
              value={invQInput}
              onChange={(e) => setInvQInput(e.target.value)}
              placeholder="Search invoice #, order, customer…"
              className="h-9 w-full sm:w-56"
              aria-label="Search invoices"
            />
            <Select
              value={invStatus || 'all'}
              onValueChange={(v) => {
                setInvStatus(v === 'all' ? '' : v)
                setInvPage(1)
              }}
            >
              <SelectTrigger className="h-9 w-[150px]" aria-label="Invoice status filter">
                <SelectValue placeholder="Status: All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Status: All</SelectItem>
                {INVOICE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canPickDept ? (
              <Select
                value={invDept || 'all'}
                onValueChange={(v) => {
                  setInvDept(v === 'all' ? '' : v)
                  setInvPage(1)
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
            {invQ || invStatus ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setInvQInput('')
                  setInvQ('')
                  setInvStatus('')
                  setInvPage(1)
                }}
                aria-label="Reset invoice filters"
              >
                <X className="h-4 w-4" aria-hidden /> Reset
              </Button>
            ) : null}
          </FilterBar>

          <DataTable
            columns={invoiceColumns}
            rows={invoices}
            loading={invLoading}
            emptyMessage="No invoices match the current filters"
          />

          <div className="mt-3 flex flex-col items-center justify-between gap-2 sm:flex-row">
            <p className="text-xs text-stone-500">
              Showing {invFromIdx}–{invToIdx} of {invTotal} invoices
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={invPage <= 1 || invLoading} onClick={() => setInvPage((p) => p - 1)} aria-label="Previous page">
                Previous
              </Button>
              <span className="text-xs text-stone-600">Page {invPage} of {invTotalPages}</span>
              <Button variant="outline" size="sm" disabled={invPage >= invTotalPages || invLoading} onClick={() => setInvPage((p) => p + 1)} aria-label="Next page">
                Next
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* record payment dialog (payments + invoices tabs, and preset from orders-view) */}
      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        preset={payPreset}
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      {/* generate invoice dialog */}
      <GenerateInvoiceDialog
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        onSaved={() => {
          setTab('invoices')
          setReloadKey((k) => k + 1)
        }}
      />
    </div>
  )
}

// ---------- record payment dialog (exported — reused by orders-view) ----------

export function RecordPaymentDialog({
  open,
  onOpenChange,
  preset,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  preset?: PaymentPreset | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [targetType, setTargetType] = useState<'LEAD' | 'ORDER'>('ORDER')
  const [targetId, setTargetId] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('UPI')
  const [reference, setReference] = useState('')
  const [isAdvance, setIsAdvance] = useState(false)
  const [paidAt, setPaidAt] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-initialise when the dialog opens or the preset target changes (render-time state adjustment)
  const presetKey = `${open ? 'open' : 'closed'}-${preset?.kind ?? ''}-${preset?.id ?? ''}`
  const [lastPresetKey, setLastPresetKey] = useState('')
  if (presetKey !== lastPresetKey) {
    setLastPresetKey(presetKey)
    if (open) {
      setTargetType(preset ? (preset.kind === 'lead' ? 'LEAD' : 'ORDER') : 'ORDER')
      setTargetId(preset?.id ?? '')
      if (preset?.kind === 'order') {
        setAmount(preset.outstanding && preset.outstanding > 0 ? String(preset.outstanding) : '')
      } else if (preset?.kind === 'invoice') {
        const balance = (preset.amount ?? 0) - (preset.paidAmount ?? 0)
        setAmount(balance > 0 ? String(balance) : '')
      } else {
        setAmount('')
      }
      setMode('UPI')
      setReference('')
      setIsAdvance(false)
      setPaidAt(toInputDateTime(new Date()))
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

  const fetchOrderOptions = useCallback(async (search: string): Promise<PickerOption[]> => {
    const res = await api<{
      orders: Array<{ id: string; orderNo: string; lead: { customerName: string }; total: number; paymentStatus: string }>
    }>(`/api/orders${qs({ q: search || undefined, pageSize: 20 })}`)
    return (res.orders ?? []).map((o) => ({
      id: o.id,
      label: `${o.orderNo} — ${o.lead.customerName}`,
      sub: `${formatINR(o.total)} · ${o.paymentStatus}`,
    }))
  }, [])

  const submit = async () => {
    const amt = Math.floor(Number(amount) || 0)
    if (amt <= 0) {
      toast({ title: 'Enter a valid amount', description: 'Amount must be a positive integer ₹', variant: 'destructive' })
      return
    }
    if (!targetId) {
      toast({ title: 'Select a target', description: targetType === 'LEAD' ? 'Choose the lead.' : 'Choose the order.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        amount: amt,
        mode,
        reference: reference.trim() || undefined,
        isAdvance,
        paidAt: paidAt || undefined,
      }
      if (preset?.kind === 'invoice') body.invoiceId = preset.id
      else if (targetType === 'LEAD') body.leadId = targetId
      else body.orderId = targetId

      const res = await api<{ payment: { id: string; receiptNo: string; amount: number; mode: string } }>('/api/payments', {
        method: 'POST',
        body,
      })
      toast({
        title: 'Payment recorded',
        description: `${res.payment.receiptNo} — ${formatINR(res.payment.amount)} via ${PAYMENT_MODE_LABELS[res.payment.mode] ?? res.payment.mode}`,
      })
      setSaving(false)
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setSaving(false)
      toast({ title: 'Payment failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Invoice and order payment status update automatically and the lead owner is notified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {preset ? (
            <div className="space-y-1.5">
              <Label>{preset.kind === 'invoice' ? 'Invoice' : preset.kind === 'order' ? 'Sales Order' : 'Lead'}</Label>
              <Input value={preset.label} disabled aria-label="Payment target" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Receive Against *</Label>
                <Select
                  value={targetType}
                  onValueChange={(v) => {
                    setTargetType(v as 'LEAD' | 'ORDER')
                    setTargetId('')
                  }}
                  disabled={saving}
                >
                  <SelectTrigger aria-label="Payment target type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LEAD">Lead (advance payment)</SelectItem>
                    <SelectItem value="ORDER">Sales Order</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{targetType === 'LEAD' ? 'Lead *' : 'Order *'}</Label>
                <AsyncPicker
                  value={targetId}
                  onChange={setTargetId}
                  fetchOptions={targetType === 'LEAD' ? fetchLeadOptions : fetchOrderOptions}
                  placeholder={targetType === 'LEAD' ? 'Search lead by code or name…' : 'Search order by number or customer…'}
                  searchPlaceholder="Type to search…"
                  emptyText="No matches found"
                  ariaLabel="Payment target"
                  disabled={saving}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount (₹) *</Label>
              <Input id="pay-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 25000" disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label>Mode *</Label>
              <Select value={mode} onValueChange={setMode} disabled={saving}>
                <SelectTrigger aria-label="Payment mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Reference</Label>
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-at">Paid At</Label>
              <Input id="pay-at" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} disabled={saving} />
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
            <Switch checked={isAdvance} onCheckedChange={setIsAdvance} disabled={saving} aria-label="Advance payment" />
            <span className="text-stone-600">Advance payment (no order linked yet)</span>
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={saving} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- generate invoice dialog ----------

function GenerateInvoiceDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [orderId, setOrderId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  // Reset when the dialog opens (render-time state adjustment)
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setOrderId('')
      setDueDate('')
    }
  }

  const fetchOrderOptions = useCallback(async (search: string): Promise<PickerOption[]> => {
    const res = await api<{
      orders: Array<{ id: string; orderNo: string; lead: { customerName: string }; total: number; department: string }>
    }>(`/api/orders${qs({ q: search || undefined, paymentStatus: 'PENDING', pageSize: 50 })}`)
    return (res.orders ?? []).map((o) => ({
      id: o.id,
      label: `${o.orderNo} — ${o.lead.customerName}`,
      sub: `${formatINR(o.total)} · ${o.department}`,
    }))
  }, [])

  const submit = async () => {
    if (!orderId) {
      toast({ title: 'Select an order', description: 'Choose the order to invoice.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await api<{ invoice: { invoiceNo: string; amount: number } }>('/api/invoices', {
        method: 'POST',
        body: { orderId, dueDate: dueDate || undefined },
      })
      toast({ title: 'Invoice generated', description: `${res.invoice.invoiceNo} — ${formatINR(res.invoice.amount)}` })
      setSaving(false)
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setSaving(false)
      toast({ title: 'Invoice failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Invoice</DialogTitle>
          <DialogDescription>
            Pick a pending order. The invoice amount equals the order total.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Order *</Label>
            <AsyncPicker
              value={orderId}
              onChange={setOrderId}
              fetchOptions={fetchOrderOptions}
              placeholder="Search pending orders…"
              searchPlaceholder="Type order no. or customer…"
              emptyText="No pending orders found"
              ariaLabel="Invoice order"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-due">Due Date</Label>
            <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={saving} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={saving} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <FileText className="mr-1 h-4 w-4" aria-hidden />}
            Generate Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
