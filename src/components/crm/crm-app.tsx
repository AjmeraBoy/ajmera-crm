'use client'

import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/client'
import { toast } from '@/hooks/use-toast'
import type { MasterItemDTO, UserInfo } from '@/types/crm'
import { useAppStore } from '@/store/app-store'
import Sidebar from '@/components/crm/shell/sidebar'
import Header from '@/components/crm/shell/header'
import LoginView from '@/components/crm/login-view'
import DashboardView from '@/components/crm/dashboard/dashboard-view'
import LeadsView from '@/components/crm/leads/leads-view'
import PipelineView from '@/components/crm/leads/pipeline-view'
import LeadDetail from '@/components/crm/leads/lead-detail'
import FollowupsView from '@/components/crm/leads/followups-view'
import DialerView from '@/components/crm/comms/dialer-view'
import WhatsAppView from '@/components/crm/comms/whatsapp-view'
import BroadcastView from '@/components/crm/comms/broadcast-view'
import MeetingsView from '@/components/crm/comms/meetings-view'
import CommunicationHealthView from '@/components/crm/comms/communication-health-view'
import TemplatesView from '@/components/crm/comms/templates-view'
import AutomationsView from '@/components/crm/comms/automations-view'
import ApiLogsView from '@/components/crm/comms/api-logs-view'
import WhatsAppSettingsView from '@/components/crm/comms/whatsapp-settings-view'
import SipSettingsView from '@/components/crm/comms/sip-settings-view'
import IncomingCallPopup from '@/components/crm/comms/incoming-call-popup'
import CampaignsView from '@/components/crm/marketing/campaigns-view'
import ProductsView from '@/components/crm/sales/products-view'
import QuotationsView from '@/components/crm/sales/quotations-view'
import OrdersView from '@/components/crm/sales/orders-view'
import PaymentsView from '@/components/crm/sales/payments-view'
import DispatchView from '@/components/crm/ops/dispatch-view'
import TicketsView from '@/components/crm/ops/tickets-view'
import MastersView from '@/components/crm/admin/masters-view'
import UsersView from '@/components/crm/admin/users-view'
import TargetsView from '@/components/crm/admin/targets-view'
import AuditView from '@/components/crm/admin/audit-view'
import ReportsView from '@/components/crm/reports/reports-view'
import NotificationsView from '@/components/crm/notifications-view'
import SettingsView from '@/components/crm/settings-view'

const VIEW_MAP: Record<string, ComponentType> = {
  dashboard: DashboardView,
  leads: LeadsView,
  pipeline: PipelineView,
  'lead-detail': LeadDetail,
  followups: FollowupsView,
  dialer: DialerView,
  whatsapp: WhatsAppView,
  broadcast: BroadcastView,
  meetings: MeetingsView,
  'comm-health': CommunicationHealthView,
  'wa-templates': TemplatesView,
  automations: AutomationsView,
  'api-logs': ApiLogsView,
  'comm-whatsapp': WhatsAppSettingsView,
  'comm-sip': SipSettingsView,
  campaigns: CampaignsView,
  products: ProductsView,
  quotations: QuotationsView,
  orders: OrdersView,
  payments: PaymentsView,
  dispatch: DispatchView,
  tickets: TicketsView,
  masters: MastersView,
  users: UsersView,
  targets: TargetsView,
  audit: AuditView,
  reports: ReportsView,
  notifications: NotificationsView,
  settings: SettingsView,
}

const MASTER_TYPES_TO_LOAD = [
  'disposition',
  'sub_disposition',
  'lead_source',
  'pipeline_stage',
  'country',
  'state',
  'business_type',
  'product_category',
  'courier',
  'ticket_type',
  'payment_mode',
  'language',
  'conversation_label',
].join(',')

function groupMasters(items: MasterItemDTO[]): Record<string, MasterItemDTO[]> {
  const grouped: Record<string, MasterItemDTO[]> = {}
  for (const item of items) {
    if (!grouped[item.type]) grouped[item.type] = []
    grouped[item.type].push(item)
  }
  return grouped
}

export default function CrmApp() {
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  const setMasters = useAppStore((s) => s.setMasters)
  const setUnread = useAppStore((s) => s.setUnread)
  const setUser = useAppStore((s) => s.setUser)
  const setView = useAppStore((s) => s.setView)
  const [booting, setBooting] = useState(true)

  // Real-time session can be revoked server-side — force a clean re-login
  useEffect(() => {
    const onAuthError = () => {
      setUser(null)
      setView('dashboard')
      toast({ title: 'Session expired', description: 'Please sign in again to continue.' })
    }
    window.addEventListener('crm:auth-error', onAuthError)
    return () => window.removeEventListener('crm:auth-error', onAuthError)
  }, [setUser, setView])

  // Restore the session on page refresh (silent /api/auth/me check)
  useEffect(() => {
    let cancelled = false
    api<{ user: UserInfo }>('/api/auth/me')
      .then((res) => {
        if (!cancelled && res.user) setUser(res.user)
      })
      .catch(() => {
        // not logged in — show login screen
      })
      .finally(() => {
        if (!cancelled) setBooting(false)
      })
    return () => {
      cancelled = true
    }
  }, [setUser])

  // Preload global masters + unread notification count when the signed-in user changes
  const loadedForUser = useRef<string | null>(null)
  useEffect(() => {
    if (!user) {
      loadedForUser.current = null
      return
    }
    if (loadedForUser.current === user.id) return
    loadedForUser.current = user.id
    let cancelled = false
    async function bootstrap() {
      try {
        const res = await api<{ items: MasterItemDTO[] }>(
          `/api/masters?types=${MASTER_TYPES_TO_LOAD}&onlyActive=1`
        )
        if (!cancelled) setMasters(groupMasters(res.items))
      } catch {
        // Views will retry masters via their own fetches if needed
      }
      try {
        const res = await api<{ unreadCount: number }>('/api/notifications?unread=1&limit=1')
        if (!cancelled) setUnread(res.unreadCount)
      } catch {
        if (!cancelled) setUnread(0)
      }
    }
    bootstrap()
    return () => {
      cancelled = true
    }
  }, [user, setMasters, setUnread])

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50" role="status" aria-label="Loading CRM">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" aria-hidden />
      </div>
    )
  }

  if (!user) return <LoginView />

  const ContentView = VIEW_MAP[view] ?? DashboardView

  return (
    <div className="flex bg-stone-50">
      <div className="hidden lg:flex">
        <Sidebar />
      </div>
      <div className="flex min-h-screen w-full min-w-0 flex-col">
        <Header />
        <main className="flex-1 p-4 md:p-6">
          <ContentView />
        </main>
        <footer className="mt-auto flex flex-col gap-1 border-t border-stone-200 px-4 py-3 text-xs text-stone-500 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Ajmera Fashion Limited — In-House CRM</p>
          <p>All amounts in ₹ INR</p>
        </footer>
      </div>
      {/* global real-time call popup + toast pump */}
      <IncomingCallPopup />
    </div>
  )
}
