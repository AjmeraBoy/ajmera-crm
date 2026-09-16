'use client'

import { create } from 'zustand'
import type { UserInfo, MasterItemDTO } from '@/types/crm'

interface AppState {
  user: UserInfo | null
  view: string
  params: Record<string, unknown>
  masters: Record<string, MasterItemDTO[]>
  mastersLoaded: boolean
  unreadNotifications: number
  /** Department filter for SUPER_ADMIN/ADMIN ('' = all departments). Set by Header, read by Dashboard etc. */
  deptFilter: string
  setView: (view: string, params?: Record<string, unknown>) => void
  setUser: (u: UserInfo | null) => void
  setMasters: (m: Record<string, MasterItemDTO[]>) => void
  setUnread: (n: number) => void
  setDeptFilter: (d: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  view: 'dashboard',
  params: {},
  masters: {},
  mastersLoaded: false,
  unreadNotifications: 0,
  deptFilter: '',
  setView: (view, params = {}) => set({ view, params }),
  setUser: (user) => set({ user }),
  setMasters: (masters) => set({ masters, mastersLoaded: true }),
  setUnread: (unreadNotifications) => set({ unreadNotifications }),
  setDeptFilter: (deptFilter) => set({ deptFilter }),
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
