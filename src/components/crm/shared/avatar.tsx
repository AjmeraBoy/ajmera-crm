'use client'

import { cn } from '@/lib/utils'

export function UserAvatar({ name, className, online }: { name?: string | null; className?: string; online?: boolean }) {
  const initials = (name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <span className={cn('relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xs font-semibold text-white', className)} aria-hidden>
      {initials || '?'}
      {online ? <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" /> : null}
    </span>
  )
}
