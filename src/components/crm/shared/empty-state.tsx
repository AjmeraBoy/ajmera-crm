'use client'

import { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'

export function EmptyState({ icon: Icon, title, subtitle, action }: { icon?: LucideIcon; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50/60 px-6 py-12 text-center">
      {Icon ? (
        <div className="mb-3 rounded-full bg-white p-3 shadow-sm">
          <Icon className="h-6 w-6 text-stone-400" aria-hidden />
        </div>
      ) : null}
      <p className="text-sm font-semibold text-stone-700">{title}</p>
      {subtitle ? <p className="mt-1 max-w-sm text-xs text-stone-500">{subtitle}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
