'use client'

import { ReactNode } from 'react'

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 ${className ?? ''}`} role="search">
      {children}
    </div>
  )
}
