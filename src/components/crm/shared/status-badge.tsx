'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const COLOR_MAPS: Record<string, Record<string, string>> = {
  priority: {
    HIGH: 'bg-rose-100 text-rose-700 border-rose-200',
    MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
    LOW: 'bg-stone-100 text-stone-600 border-stone-200',
  },
  leadStatus: {
    ACTIVE: 'bg-sky-100 text-sky-700 border-sky-200',
    CONVERTED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    LOST: 'bg-rose-100 text-rose-700 border-rose-200',
  },
  payment: {
    PENDING: 'bg-rose-100 text-rose-700 border-rose-200',
    PARTIAL: 'bg-amber-100 text-amber-700 border-amber-200',
    PAID: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    UNPAID: 'bg-rose-100 text-rose-700 border-rose-200',
    OVERDUE: 'bg-red-200 text-red-800 border-red-300',
  },
  ticket: {
    OPEN: 'bg-rose-100 text-rose-700 border-rose-200',
    IN_PROGRESS: 'bg-amber-100 text-amber-700 border-amber-200',
    RESOLVED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    CLOSED: 'bg-stone-100 text-stone-600 border-stone-200',
    ESCALATED: 'bg-red-200 text-red-800 border-red-300',
  },
  followup: {
    PENDING: 'bg-amber-100 text-amber-700 border-amber-200',
    COMPLETED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    RESCHEDULED: 'bg-sky-100 text-sky-700 border-sky-200',
    NO_RESPONSE: 'bg-stone-100 text-stone-600 border-stone-200',
    ESCALATED: 'bg-red-200 text-red-800 border-red-300',
  },
  quotation: {
    DRAFT: 'bg-stone-100 text-stone-600 border-stone-200',
    SENT: 'bg-sky-100 text-sky-700 border-sky-200',
    VIEWED: 'bg-violet-100 text-violet-700 border-violet-200',
    ACCEPTED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-rose-100 text-rose-700 border-rose-200',
    EXPIRED: 'bg-stone-100 text-stone-500 border-stone-200',
    CONVERTED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  order: {
    CONFIRMED: 'bg-sky-100 text-sky-700 border-sky-200',
    IN_PROCESS: 'bg-amber-100 text-amber-700 border-amber-200',
    DISPATCHED: 'bg-violet-100 text-violet-700 border-violet-200',
    DELIVERED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    CANCELLED: 'bg-rose-100 text-rose-700 border-rose-200',
  },
  shipment: {
    PACKING: 'bg-amber-100 text-amber-700 border-amber-200',
    QC: 'bg-violet-100 text-violet-700 border-violet-200',
    DISPATCHED: 'bg-sky-100 text-sky-700 border-sky-200',
    IN_TRANSIT: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    DELIVERED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  direction: {
    INCOMING: 'bg-sky-100 text-sky-700 border-sky-200',
    OUTGOING: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  call: {
    CONNECTED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    NOT_CONNECTED: 'bg-rose-100 text-rose-700 border-rose-200',
    MISSED: 'bg-red-200 text-red-800 border-red-300',
  },
  dept: {
    ONLINE: 'bg-sky-100 text-sky-700 border-sky-200',
    EXPORT: 'bg-amber-100 text-amber-700 border-amber-200',
  },
}

export type StatusBadgeVariant = keyof typeof COLOR_MAPS

export function StatusBadge({ status, variant, className }: { status?: string | null; variant?: StatusBadgeVariant; className?: string }) {
  if (!status) return <span className="text-stone-400">—</span>
  const key = variant ?? guessVariant(status)
  const cls = (key && COLOR_MAPS[key]?.[status]) || 'bg-stone-100 text-stone-600 border-stone-200'
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium', cls, className)}>
      {status.replaceAll('_', ' ')}
    </Badge>
  )
}

function guessVariant(status: string): StatusBadgeVariant | undefined {
  if (['HIGH', 'MEDIUM', 'LOW', 'URGENT'].includes(status)) return 'priority'
  if (['ACTIVE', 'CONVERTED', 'LOST'].includes(status)) return 'leadStatus'
  if (['PENDING', 'PARTIAL', 'PAID', 'UNPAID', 'OVERDUE'].includes(status)) return 'payment'
  if (['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ESCALATED'].includes(status)) return 'ticket'
  if (['PACKING', 'QC', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(status)) return 'shipment'
  if (['CONFIRMED', 'CANCELLED'].includes(status)) return 'order'
  if (['CONNECTED', 'NOT_CONNECTED', 'MISSED'].includes(status)) return 'call'
  if (['INCOMING', 'OUTGOING'].includes(status)) return 'direction'
  return undefined
}
