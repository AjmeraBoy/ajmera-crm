'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const tones = {
  default: 'bg-white border-stone-200',
  positive: 'bg-white border-emerald-200',
  warning: 'bg-white border-amber-200',
  negative: 'bg-white border-rose-200',
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = 'default',
  progress,
  onClick,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: keyof typeof tones
  progress?: number
  onClick?: () => void
}) {
  const clickable = !!onClick
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) onClick() }}
      className={cn(
        'relative overflow-hidden rounded-xl border p-4 shadow-sm transition-all md:p-5',
        tones[tone],
        clickable && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
          <p className="mt-1.5 truncate text-xl font-bold text-stone-900 md:text-2xl">{value}</p>
          {sub ? <p className="mt-1 truncate text-xs text-stone-500">{sub}</p> : null}
        </div>
        {icon ? <div className="shrink-0 rounded-lg bg-emerald-50 p-2 text-emerald-600">{icon}</div> : null}
      </div>
      {typeof progress === 'number' ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-100" aria-hidden>
          <div
            className={cn('h-full rounded-full transition-all', progress >= 100 ? 'bg-emerald-500' : progress >= 60 ? 'bg-amber-500' : 'bg-rose-400')}
            style={{ width: `${Math.min(100, Math.max(2, progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}
