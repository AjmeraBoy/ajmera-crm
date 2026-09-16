'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  IndianRupee,
  Info,
  LifeBuoy,
  MessageCircle,
  Phone,
  Truck,
  User,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/client'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useToast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/crm/shared/page-header'
import { EmptyState } from '@/components/crm/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type NotificationItem = {
  id: string
  title: string
  body?: string | null
  type: string
  link?: string | null
  isRead: boolean
  createdAt: string
}

const TYPE_ICONS: Record<string, { icon: LucideIcon; className: string }> = {
  LEAD: { icon: User, className: 'bg-sky-100 text-sky-700' },
  PAYMENT: { icon: IndianRupee, className: 'bg-emerald-100 text-emerald-700' },
  SHIPMENT: { icon: Truck, className: 'bg-orange-100 text-orange-700' },
  TICKET: { icon: LifeBuoy, className: 'bg-rose-100 text-rose-700' },
  ALERT: { icon: AlertTriangle, className: 'bg-amber-100 text-amber-700' },
  CALL: { icon: Phone, className: 'bg-teal-100 text-teal-700' },
  WHATSAPP: { icon: MessageCircle, className: 'bg-lime-100 text-lime-700' },
  INFO: { icon: Info, className: 'bg-stone-100 text-stone-600' },
}

export default function NotificationsView() {
  const setUnread = useAppStore((s) => s.setUnread)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ notifications: NotificationItem[]; unreadCount: number }>(
        '/api/notifications?limit=100'
      )
      setItems(res.notifications)
      setUnread(res.unreadCount)
    } catch (e) {
      toast({ title: 'Failed to load notifications', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [setUnread, toast])

  // Load on mount (polls the unread count into the global store)
  useEffect(() => {
    load()
  }, [load])

  const unreadCount = items.filter((n) => !n.isRead).length

  function openNotification(n: NotificationItem) {
    if (!n.isRead) markRead(n.id)
    // Deep-link notifications that point at a lead (e.g. "/?lead=<id>")
    const leadId = n.link?.match(/lead=([a-z0-9]+)/i)?.[1]
    if (leadId) setView('lead-detail', { leadId })
  }

  async function markRead(id: string) {
    try {
      await api('/api/notifications', { method: 'PATCH', body: { id } })
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
      setUnread(Math.max(0, unreadCount - 1))
    } catch (e) {
      toast({ title: 'Could not mark as read', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function markAllRead() {
    setMarkingAll(true)
    try {
      await api('/api/notifications', { method: 'PATCH', body: { all: true } })
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnread(0)
      toast({ title: 'All notifications marked as read' })
    } catch (e) {
      toast({ title: 'Could not mark all as read', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setMarkingAll(false)
    }
  }

  const unreadShown = items.filter((n) => !n.isRead).length

  return (
    <div>
      <PageHeader title="Notifications" subtitle={unreadShown > 0 ? `${unreadShown} unread notification${unreadShown === 1 ? '' : 's'}` : 'You are all caught up'}>
        <Button variant="outline" size="sm" className="h-9" onClick={markAllRead} disabled={markingAll || unreadCount === 0}>
          <CheckCheck className="h-4 w-4" aria-hidden /> Mark all read
        </Button>
      </PageHeader>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`sk-nt-${i}`} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          subtitle="Alerts about leads, payments, dispatch and tickets will appear here."
          action={
            <Button variant="outline" size="sm" onClick={load}>
              Refresh
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const meta = TYPE_ICONS[n.type] ?? TYPE_ICONS.INFO
            const Icon = meta.icon
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  aria-label={n.isRead ? `Notification: ${n.title}` : `Unread notification: ${n.title} — click to mark read`}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-3 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
                    n.isRead
                      ? 'border-stone-200 bg-white hover:bg-stone-50'
                      : 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50'
                  )}
                >
                  <span className={cn('mt-0.5 shrink-0 rounded-lg p-2', meta.className)} aria-hidden>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('truncate text-sm', n.isRead ? 'font-medium text-stone-700' : 'font-semibold text-stone-900')}>
                        {n.title}
                      </span>
                      {!n.isRead ? <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="Unread" /> : null}
                      <span className="ml-auto shrink-0 text-xs text-stone-400">{timeAgo(n.createdAt)}</span>
                    </span>
                    {n.body ? <span className="mt-0.5 block text-xs text-stone-500">{n.body}</span> : null}
                  </span>
                  {!n.isRead ? (
                    <CheckCheck className="mt-1 h-4 w-4 shrink-0 text-stone-300" aria-hidden />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
