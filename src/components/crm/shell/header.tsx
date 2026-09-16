'use client'

import { useCallback, useState } from 'react'
import { Bell, LogOut, Menu } from 'lucide-react'
import { api } from '@/lib/client'
import { NAV_ITEMS, ROLE_COLORS, ROLE_LABELS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { UserAvatar } from '@/components/crm/shared/avatar'
import Sidebar from '@/components/crm/shell/sidebar'

const TITLE_FALLBACKS: Record<string, string> = {
  'lead-detail': 'Lead Detail',
  notifications: 'Notifications',
}

function viewTitle(view: string): string {
  if (TITLE_FALLBACKS[view]) return TITLE_FALLBACKS[view]
  return NAV_ITEMS.find((n) => n.id === view)?.label ?? 'Dashboard'
}

export default function Header() {
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const unread = useAppStore((s) => s.unreadNotifications)
  const deptFilter = useAppStore((s) => s.deptFilter)
  const setDeptFilter = useAppStore((s) => s.setDeptFilter)
  const setUser = useAppStore((s) => s.setUser)
  const setUnread = useAppStore((s) => s.setUnread)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const canFilterDept = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN'

  const handleLogout = useCallback(async () => {
    setLoggingOut(true)
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch {
      // proceed with local logout regardless
    }
    setUser(null)
    setUnread(0)
    setDeptFilter('')
    setView('dashboard')
    setLoggingOut(false)
  }, [setUser, setUnread, setDeptFilter, setView])

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-stone-200 bg-white px-4 md:gap-3 md:px-6">
      {/* Mobile hamburger + sheet sidebar */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open menu"
        onClick={() => setSheetOpen(true)}
      >
        <Menu className="h-5 w-5" aria-hidden />
      </Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="w-72 gap-0 border-stone-800 bg-stone-950 p-0 [&>button]:text-stone-400">
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <Sidebar onNavigate={() => setSheetOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Current view title */}
      <h2 className="truncate text-sm font-semibold text-stone-900 md:text-base">{viewTitle(view)}</h2>

      <div className="ml-auto flex items-center gap-1.5 md:gap-3">
        {/* Department filter (SUPER_ADMIN / ADMIN) */}
        {canFilterDept ? (
          <Select value={deptFilter || 'ALL'} onValueChange={(v) => setDeptFilter(v === 'ALL' ? '' : v)}>
            <SelectTrigger
              size="sm"
              className="h-9 w-[120px] text-xs md:w-[150px]"
              aria-label="Filter by department"
            >
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Departments</SelectItem>
              <SelectItem value="ONLINE">Online</SelectItem>
              <SelectItem value="EXPORT">Export</SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        {/* Notifications bell */}
        <button
          type="button"
          onClick={() => setView('notifications')}
          aria-label={`Notifications${unread > 0 ? ` — ${unread} unread` : ''}`}
          className="relative rounded-md p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>

        {/* User menu */}
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Open user menu"
              className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <UserAvatar name={user.name} online />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="text-sm font-semibold text-stone-900">{user.name}</p>
                <p className="truncate text-xs font-normal text-stone-500">{user.email}</p>
                <span
                  className={cn(
                    'mt-1 inline-block rounded-full px-1.5 py-px text-[10px] font-semibold',
                    ROLE_COLORS[user.role] ?? 'bg-stone-100 text-stone-600'
                  )}
                >
                  {ROLE_LABELS[user.role] ?? user.role}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setView('notifications')}>
                <Bell className="h-4 w-4" aria-hidden /> Notifications
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={loggingOut} onClick={handleLogout}>
                <LogOut className="h-4 w-4" aria-hidden /> Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  )
}
