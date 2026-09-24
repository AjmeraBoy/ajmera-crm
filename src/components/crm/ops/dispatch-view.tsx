'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Send,
  Truck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { formatDateTime, formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DEPARTMENTS, DEPT_LABELS, SHIPMENT_STAGES, SHIPMENT_STAGE_LABELS } from '@/lib/constants'
import { PageHeader } from '@/components/crm/shared/page-header'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { useMasters } from '@/components/crm/shared/use-masters'
import { useAppStore } from '@/store/app-store'

// ---------- types ----------

type ShipmentRow = {
  id: string
  department: string
  stage: string
  courierName: string | null
  awbNumber: string | null
  trackingUrl: string | null
  proofUrl: string | null
  dispatchedAt: string | null
  deliveredAt: string | null
  notes: string | null
  createdAt: string
  order: {
    orderNo: string
    total: number
    status: string
    lead: { id: string; leadCode: string; customerName: string; department: string; mobile: string } | null
  }
}

type ShipmentsResponse = {
  shipments: ShipmentRow[]
  total: number
  summary: { packing: number; qc: number; dispatched: number; inTransit: number; delivered: number }
}

type OrderRow = {
  id: string
  orderNo: string
  total: number
  department: string
  lead: { id: string; leadCode: string; customerName: string; department: string; mobile: string } | null
  shipment: { id: string } | null
}

const PAGE_SIZE = 20
const STAGE_ICONS: Record<string, React.ReactNode> = {
  PACKING: <Package className="h-5 w-5" aria-hidden />,
  QC: <ScanSearch className="h-5 w-5" aria-hidden />,
  DISPATCHED: <Send className="h-5 w-5" aria-hidden />,
  IN_TRANSIT: <Truck className="h-5 w-5" aria-hidden />,
  DELIVERED: <CheckCircle2 className="h-5 w-5" aria-hidden />,
}

/** Display ref derived from shipment id (shipments have no code column) */
function shipmentRef(id: string) {
  return `SHP-${id.slice(-6).toUpperCase()}`
}

// ---------- component ----------

export default function DispatchView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()

  const isAdminLevel = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'
  const canEdit = isAdminLevel || user?.role === 'DISPATCH'

  const [stage, setStage] = useState('')
  const [dept, setDept] = useState(user?.department ?? '')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ShipmentsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // detail dialog
  const [detail, setDetail] = useState<ShipmentRow | null>(null)
  const [dStage, setDStage] = useState('')
  const [dCourier, setDCourier] = useState('')
  const [dAwb, setDAwb] = useState('')
  const [dTracking, setDTracking] = useState('')
  const [dProof, setDProof] = useState('')
  const [movingStage, setMovingStage] = useState(false)
  const [savingDetail, setSavingDetail] = useState(false)

  // new shipment dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [orderQ, setOrderQ] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [courier, setCourier] = useState('')
  const [customCourier, setCustomCourier] = useState('')
  const [awb, setAwb] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 400)
    return () => clearTimeout(t)
  }, [qInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<ShipmentsResponse>(
        `/api/shipments${qs({ stage: stage || undefined, dept: dept || undefined, q: q || undefined, page, pageSize: PAGE_SIZE })}`
      )
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load shipments', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [stage, dept, q, page, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // candidate orders for new shipment
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const res = await api<{ orders: OrderRow[] }>(
        `/api/orders${qs({ status: 'CONFIRMED', dept: dept || undefined, q: orderQ.trim() || undefined, pageSize: 50 })}`
      )
      setOrders((res.orders ?? []).filter((o) => !o.shipment))
    } catch {
      setOrders([])
    } finally {
      setOrdersLoading(false)
    }
  }, [dept, orderQ])

  useEffect(() => {
    if (!createOpen) return
    const t = setTimeout(loadOrders, 300)
    return () => clearTimeout(t)
  }, [createOpen, loadOrders])

  const openDetail = (s: ShipmentRow) => {
    setDetail(s)
    setDStage(s.stage)
    setDCourier(s.courierName ?? '')
    setDAwb(s.awbNumber ?? '')
    setDTracking(s.trackingUrl ?? '')
    setDProof(s.proofUrl ?? '')
  }

  const applyDetail = (s: ShipmentRow) => {
    setDetail(s)
    setDStage(s.stage)
  }

  const moveStage = async (newStage: string) => {
    if (!detail || !newStage || newStage === detail.stage) return
    setMovingStage(true)
    try {
      const res = await api<{ shipment: ShipmentRow }>('/api/shipments', {
        method: 'PATCH',
        body: { id: detail.id, stage: newStage },
      })
      applyDetail(res.shipment)
      toast({
        title: `Stage → ${SHIPMENT_STAGE_LABELS[newStage] ?? newStage}`,
        description:
          newStage === 'DISPATCHED'
            ? 'WhatsApp notification sent to customer'
            : newStage === 'DELIVERED'
              ? 'Order marked as delivered'
              : undefined,
      })
      setReloadKey((k) => k + 1)
    } catch (e) {
      setDStage(detail.stage)
      toast({ title: 'Stage change failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setMovingStage(false)
    }
  }

  const saveDetail = async () => {
    if (!detail) return
    setSavingDetail(true)
    try {
      const res = await api<{ shipment: ShipmentRow }>('/api/shipments', {
        method: 'PATCH',
        body: {
          id: detail.id,
          courierName: dCourier,
          awbNumber: dAwb,
          trackingUrl: dTracking,
          proofUrl: dProof,
        },
      })
      applyDetail(res.shipment)
      toast({ title: 'Shipment updated', description: `Courier / AWB details saved for ${res.shipment.order.orderNo}` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSavingDetail(false)
    }
  }

  const openCreate = () => {
    setSelectedOrderId('')
    setOrderQ('')
    setCourier('')
    setCustomCourier('')
    setAwb('')
    setNotes('')
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    if (!selectedOrderId) {
      toast({ title: 'Select an order', description: 'Pick a confirmed order to dispatch', variant: 'destructive' })
      return
    }
    const courierName = courier === '__custom' ? customCourier.trim() : courier
    setCreating(true)
    try {
      const res = await api<{ shipment: ShipmentRow }>('/api/shipments', {
        method: 'POST',
        body: { orderId: selectedOrderId, courierName: courierName || undefined, awbNumber: awb.trim() || undefined, notes: notes.trim() || undefined },
      })
      toast({ title: 'Shipment created', description: `${res.shipment.order.orderNo} is now in Packing` })
      setCreateOpen(false)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Could not create shipment', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const exportCsv = () => {
    const rows = (data?.shipments ?? []).map((s) => ({
      shipment: shipmentRef(s.id),
      orderNo: s.order.orderNo,
      customer: s.order.lead ? `${s.order.lead.leadCode} — ${s.order.lead.customerName}` : '',
      department: s.department,
      stage: s.stage,
      courier: s.courierName ?? '',
      awbNumber: s.awbNumber ?? '',
      trackingUrl: s.trackingUrl ?? '',
      orderValue: s.order.total,
      dispatchedAt: s.dispatchedAt ? formatDateTime(s.dispatchedAt) : '',
      deliveredAt: s.deliveredAt ? formatDateTime(s.deliveredAt) : '',
      createdAt: formatDateTime(s.createdAt),
    }))
    downloadCSV(`shipments-${new Date().toISOString().slice(0, 10)}.csv`, rows)
    toast({ title: 'Export ready', description: `${rows.length} shipment(s) exported to CSV` })
  }

  const columns: Column<ShipmentRow>[] = [
    {
      key: 'shipment',
      header: 'Shipment',
      render: (s) => <span className="whitespace-nowrap font-mono text-xs font-bold text-stone-800">{shipmentRef(s.id)}</span>,
    },
    {
      key: 'order',
      header: 'Order',
      render: (s) => (
        <div className="min-w-[110px]">
          <p className="whitespace-nowrap font-mono text-xs font-semibold text-stone-800">{s.order.orderNo}</p>
          <p className="text-xs text-emerald-700">{formatINR(s.order.total)}</p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (s) => {
        const lead = s.order.lead
        if (!lead) return <span className="text-stone-400">—</span>
        return (
          <button
            type="button"
            className="text-left text-xs hover:text-emerald-700 hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              setView('lead-detail', { leadId: lead.id })
            }}
            aria-label={`Open lead ${lead.customerName}`}
          >
            <span className="font-medium text-stone-800">{lead.customerName}</span>
            <span className="block font-mono text-stone-500">{lead.leadCode}</span>
          </button>
        )
      },
    },
    {
      key: 'department',
      header: 'Dept',
      render: (s) => <StatusBadge status={s.department} variant="dept" />,
    },
    {
      key: 'courier',
      header: 'Courier',
      render: (s) => s.courierName ?? <span className="text-stone-400">—</span>,
    },
    {
      key: 'awb',
      header: 'AWB / Tracking',
      render: (s) => (
        <div className="min-w-[110px]">
          {s.awbNumber ? <p className="font-mono text-xs">{s.awbNumber}</p> : <span className="text-xs text-stone-400">No AWB</span>}
          {s.trackingUrl ? (
            <a
              href={s.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-xs text-emerald-700 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Track <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>
      ),
    },
    {
      key: 'dispatchedAt',
      header: 'Dispatched',
      render: (s) => (
        <span className="whitespace-nowrap text-xs text-stone-600">{s.dispatchedAt ? formatDateTime(s.dispatchedAt) : '—'}</span>
      ),
    },
    {
      key: 'deliveredAt',
      header: 'Delivered',
      render: (s) => (
        <span className="whitespace-nowrap text-xs text-stone-600">{s.deliveredAt ? formatDateTime(s.deliveredAt) : '—'}</span>
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      render: (s) => <StatusBadge status={s.stage} variant="shipment" />,
    },
  ]

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fromIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(total, page * PAGE_SIZE)
  const summary = data?.summary
  const courierOptions = masters.items('courier', dept || user?.department || undefined)
  const currentStageIdx = detail ? SHIPMENT_STAGES.indexOf(detail.stage as (typeof SHIPMENT_STAGES)[number]) : -1

  return (
    <div>
      <PageHeader title="Dispatch & Shipment Tracking" subtitle="Packing → QC → Dispatch → In Transit → Delivered">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh shipments">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} aria-label="Export shipments as CSV">
          <Download className="h-4 w-4" aria-hidden />
          <span className="ml-1">Export CSV</span>
        </Button>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          <span className="ml-1">New Shipment</span>
        </Button>
      </PageHeader>

      {/* summary strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label="Packing"
          value={summary?.packing ?? 0}
          icon={STAGE_ICONS.PACKING}
          onClick={() => {
            setStage('PACKING')
            setPage(1)
          }}
        />
        <KpiCard
          label="QC Check"
          value={summary?.qc ?? 0}
          icon={STAGE_ICONS.QC}
          onClick={() => {
            setStage('QC')
            setPage(1)
          }}
        />
        <KpiCard
          label="Dispatched"
          value={summary?.dispatched ?? 0}
          icon={STAGE_ICONS.DISPATCHED}
          onClick={() => {
            setStage('DISPATCHED')
            setPage(1)
          }}
        />
        <KpiCard
          label="In Transit"
          value={summary?.inTransit ?? 0}
          icon={STAGE_ICONS.IN_TRANSIT}
          onClick={() => {
            setStage('IN_TRANSIT')
            setPage(1)
          }}
        />
        <KpiCard
          label="Delivered"
          value={summary?.delivered ?? 0}
          tone="positive"
          icon={STAGE_ICONS.DELIVERED}
          onClick={() => {
            setStage('DELIVERED')
            setPage(1)
          }}
        />
      </div>

      <FilterBar>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" aria-hidden />
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search order no, AWB, courier, customer…"
            className="w-60 pl-8"
            aria-label="Search shipments"
          />
        </div>
        <Select value={stage || 'ALL'} onValueChange={(v) => { setStage(v === 'ALL' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-40" aria-label="Stage filter">
            <SelectValue placeholder="All Stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Stages</SelectItem>
            {SHIPMENT_STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {SHIPMENT_STAGE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdminLevel ? (
          <Select value={dept || 'ALL'} onValueChange={(v) => { setDept(v === 'ALL' ? '' : v); setPage(1) }}>
            <SelectTrigger className="w-44" aria-label="Department filter">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Departments</SelectItem>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d}>
                  {DEPT_LABELS[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={data?.shipments ?? []}
        loading={loading}
        emptyMessage="No shipments found — create one from a confirmed order"
        onRowClick={openDetail}
      />

      {/* pagination */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
        <span>{total === 0 ? '0 records' : `Showing ${fromIdx}–${toIdx} of ${total}`}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      {/* new shipment dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Shipment</DialogTitle>
            <DialogDescription>Pick a confirmed order. It starts at the PACKING stage and moves the order to In Process.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-search">Order</Label>
              <Input
                id="order-search"
                value={orderQ}
                onChange={(e) => setOrderQ(e.target.value)}
                placeholder="Search confirmed orders by no / customer…"
              />
              <div className="max-h-48 overflow-y-auto rounded-lg border border-stone-200 bg-white">
                {ordersLoading ? (
                  <p className="flex items-center gap-2 px-3 py-3 text-xs text-stone-500">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading orders…
                  </p>
                ) : orders.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-stone-400">No dispatchable confirmed orders found</p>
                ) : (
                  orders.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelectedOrderId(o.id)}
                      aria-pressed={selectedOrderId === o.id}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 border-b border-stone-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-emerald-50',
                        selectedOrderId === o.id && 'bg-emerald-50'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-xs font-bold text-stone-800">{o.orderNo}</span>
                        <span className="block truncate text-xs text-stone-500">
                          {o.lead ? `${o.lead.customerName} · ${o.lead.mobile}` : '—'}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-right">
                        <span className="block text-xs font-semibold text-emerald-700">{formatINR(o.total)}</span>
                        <StatusBadge status={o.department} variant="dept" className="mt-0.5" />
                      </span>
                    </button>
                  ))
                )}
              </div>
              {selectedOrderId ? (
                <p className="text-xs text-emerald-700">
                  Selected: <span className="font-mono font-semibold">{orders.find((o) => o.id === selectedOrderId)?.orderNo}</span>
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Courier</Label>
                <Select value={courier || 'NONE'} onValueChange={setCourier}>
                  <SelectTrigger aria-label="Courier">
                    <SelectValue placeholder="Select courier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Not decided yet</SelectItem>
                    {courierOptions.map((c) => (
                      <SelectItem key={c.id} value={c.label}>
                        {c.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom">Other (type manually)</SelectItem>
                  </SelectContent>
                </Select>
                {courier === '__custom' ? (
                  <Input value={customCourier} onChange={(e) => setCustomCourier(e.target.value)} placeholder="Courier name" className="mt-1.5" />
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="awb-number">AWB Number</Label>
                <Input id="awb-number" value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="e.g. AWB12345678" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shipment-notes">Notes</Label>
              <Textarea id="shipment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Packing instructions, fragile items, gift wrap…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submitCreate} disabled={creating || !selectedOrderId}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Create Shipment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* shipment detail dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{shipmentRef(detail.id)}</span>
                  <StatusBadge status={detail.stage} variant="shipment" />
                  <StatusBadge status={detail.department} variant="dept" />
                </DialogTitle>
                <DialogDescription>
                  Order <span className="font-mono font-semibold text-stone-700">{detail.order.orderNo}</span>
                  {detail.order.lead ? ` · ${detail.order.lead.customerName} (${detail.order.lead.leadCode})` : ''} ·{' '}
                  {formatINR(detail.order.total)}
                </DialogDescription>
              </DialogHeader>

              <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                {detail.stage === 'DISPATCHED' ? (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    WhatsApp notification sent to customer on dispatch.
                  </div>
                ) : null}

                {/* stage progression */}
                <div className="rounded-xl border border-stone-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Stage progression</p>
                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={dStage} onValueChange={moveStage} disabled={movingStage}>
                        <SelectTrigger className="w-48" aria-label="Shipment stage">
                          {movingStage ? (
                            <span className="flex items-center gap-1 text-stone-500">
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Updating…
                            </span>
                          ) : (
                            <SelectValue />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {SHIPMENT_STAGES.map((s, i) => (
                            <SelectItem key={s} value={s} disabled={i < currentStageIdx}>
                              {SHIPMENT_STAGE_LABELS[s]}
                              {i < currentStageIdx ? ' (done)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-stone-500">Stages only move forward. Dispatch triggers a WhatsApp update to the customer.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-stone-500">Only the Dispatch team can move stages. Contact them for updates.</p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
                    <div>
                      <p className="text-stone-400">Dispatched At</p>
                      <p className="font-medium text-stone-700">{detail.dispatchedAt ? formatDateTime(detail.dispatchedAt) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-stone-400">Delivered At</p>
                      <p className="font-medium text-stone-700">{detail.deliveredAt ? formatDateTime(detail.deliveredAt) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-stone-400">Created</p>
                      <p className="font-medium text-stone-700">{formatDateTime(detail.createdAt)}</p>
                    </div>
                  </div>
                </div>

                {/* courier / tracking edit */}
                <div className="rounded-xl border border-stone-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Courier & tracking details</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor="d-courier">Courier name</Label>
                      <Input id="d-courier" value={dCourier} onChange={(e) => setDCourier(e.target.value)} disabled={!canEdit} placeholder="e.g. DHL Express" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor="d-awb">AWB number</Label>
                      <Input id="d-awb" value={dAwb} onChange={(e) => setDAwb(e.target.value)} disabled={!canEdit} placeholder="Airway bill no." />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor="d-tracking">Tracking URL</Label>
                      <Input id="d-tracking" value={dTracking} onChange={(e) => setDTracking(e.target.value)} disabled={!canEdit} placeholder="https://…" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor="d-proof">Proof of delivery URL</Label>
                      <Input id="d-proof" value={dProof} onChange={(e) => setDProof(e.target.value)} disabled={!canEdit} placeholder="https://… (POD image / doc)" />
                    </div>
                  </div>
                  {detail.trackingUrl ? (
                    <a
                      href={detail.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden /> Open tracking link
                    </a>
                  ) : null}
                  {detail.proofUrl ? (
                    <a
                      href={detail.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-3 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden /> View delivery proof
                    </a>
                  ) : null}
                  {detail.notes ? <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">Notes: {detail.notes}</p> : null}
                  {canEdit ? (
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={saveDetail} disabled={savingDetail}>
                        {savingDetail ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                        Save Details
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
