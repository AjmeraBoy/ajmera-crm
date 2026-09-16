'use client'

import { create } from 'zustand'
import type { UserInfo, MasterItemDTO } from '@/types/crm'

/** Live SIP call shared between the incoming-call popup, dialer and lead detail. */
export interface ActiveCallInfo {
  callId: string
  callStatus?: string | null // QUEUED | RINGING | IN_PROGRESS | ON_HOLD | COMPLETED | FAILED | MISSED
  customerNumber?: string | null
  known?: boolean
  lead?: {
    id: string
    leadCode: string
    customerName: string
    mobile?: string | null
    department: string
    source?: string | null
    assignedTo?: string | null
  } | null
  agentExtension?: string | null
  answerAt?: string | null
  startedAt?: string | null
}

interface AppState {
  user: UserInfo | null
  view: string
  params: Record<string, unknown>
  masters: Record<string, MasterItemDTO[]>
  mastersLoaded: boolean
  unreadNotifications: number
  /** Department filter for SUPER_ADMIN/ADMIN ('' = all departments). Set by Header, read by Dashboard etc. */
  deptFilter: string
  activeCall: ActiveCallInfo | null
  setView: (view: string, params?: Record<string, unknown>) => void
  setUser: (u: UserInfo | null) => void
  setMasters: (m: Record<string, MasterItemDTO[]>) => void
  setUnread: (n: number) => void
  setDeptFilter: (d: string) => void
  setActiveCall: (c: ActiveCallInfo | null) => void
  patchActiveCall: (patch: Partial<ActiveCallInfo>) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  view: 'dashboard',
  params: {},
  masters: {},
  mastersLoaded: false,
  unreadNotifications: 0,
  deptFilter: '',
  activeCall: null,
  setView: (view, params = {}) => set({ view, params }),
  setUser: (user) => set({ user }),
  setMasters: (masters) => set({ masters, mastersLoaded: true }),
  setUnread: (unreadNotifications) => set({ unreadNotifications }),
  setDeptFilter: (deptFilter) => set({ deptFilter }),
  setActiveCall: (activeCall) => set({ activeCall }),
  patchActiveCall: (patch) =>
    set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, ...patch } } : s)),
}))

/** Helper to parse disposition extra config */
export function dispositionExtra(extra?: string | null): {
  showCallback?: boolean
  showEstimated?: boolean
  showPayment?: boolean
  showFollowUp?: boolean
  color?: string
} {
  if (!extra) return {}
  try {
    return JSON.parse(extra)
  } catch {
    return {}
  }
}
