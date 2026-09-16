'use client'

import { useCallback, useState } from 'react'
import {
  BarChart3,
  CalendarClock,
  Database,
  FileText,
  IndianRupee,
  KanbanSquare,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  MessageCircle,
  Package,
  PhoneCall,
  ScrollText,
  Settings,
  ShoppingCart,
  Target,
  Truck,
  UserCog,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/client'
import { DEPT_LABELS, ROLE_COLORS, ROLE_LABELS, navForRoles } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { UserAvatar } from '@/components/crm/shared/avatar'

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  KanbanSquare,
  CalendarClock,
  PhoneCall,
  MessageCircle,
  Megaphone,
  Video,
  Package,
  FileText,
  ShoppingCart,
  IndianRupee,
  Truck,
  LifeBuoy,
  BarChart3,
  Database,
  UserCog,
  Target,
  ScrollText,
  Settings,
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const setUser = useAppStore((s) => s.setUser)
  const setUnread = useAppStore((s) => s.setUnread)
  const setDeptFilter = useAppStore((s) => s.setDeptFilter)
  const [loggingOut, setLoggingOut] = useState(false)

  const navItems = user ? navForRoles(user.role) : []

  const groups: Array<{ label: string; items: typeof navItems }> = []
  for (const item of navItems) {
    const g = groups.find((x) => x.label === item.group)
    if (g) g.items.push(item)
    else groups.push({ label: item.group, items: [item] })
  }

  const handleLogout = useCallback(async () => {
    setLoggingOut(true)
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch {
      // session may already be dead — proceed with local logout regardless
    }
    setUser(null)
    setUnread(0)
    setDeptFilter('')
    setView('dashboard')
    setLoggingOut(false)
  }, [setUser, setUnread, setDeptFilter, setView])

  return (
    <aside
      className="flex h-screen w-64 shrink-0 flex-col bg-stone-950 text-stone-300"
      aria-label="Primary navigation"
    >
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 text-sm font-bold text-white shadow-md shadow-emerald-900/40">
          AF
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">Ajmera Fashion CRM</p>
          <p className="truncate text-[11px] text-stone-400">
            {user?.department ? (DEPT_LABELS[user.department] ?? user.department) : 'All Departments'}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main menu">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-stone-500">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard
                const active = view === item.id || (view === 'lead-detail' && item.id === 'leads')
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setView(item.id)
                        onNavigate?.()
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 border-l-2 px-3 py-2 text-left text-sm transition-colors',
                        active
                          ? 'border-emerald-500 bg-emerald-600/15 font-medium text-emerald-400'
                          : 'border-transparent text-stone-300 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User card */}
      {user ? (
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-lg bg-white/5 p-2.5">
            <UserAvatar name={user.name} className="h-9 w-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user.name}</p>
              <span
                className={cn(
                  'mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold',
                  ROLE_COLORS[user.role] ?? 'bg-stone-100 text-stone-600'
                )}
              >
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              aria-label="Logout"
              title="Logout"
              className="rounded-md p-2 text-stone-400 transition-colors hover:bg-white/10 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
