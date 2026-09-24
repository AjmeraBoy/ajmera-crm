'use client'

import { useMemo } from 'react'
import { useAppStore } from '@/store/app-store'
import type { MasterItemDTO } from '@/types/crm'

/**
 * Access dynamically-configured master data (dispositions, sources, stages, countries...).
 * - masters: all grouped by type
 * - items(type, dept?): active items of a type, optionally filtered to a department (incl 'ALL' shared)
 * - byId(id): lookup a master item anywhere
 */
export function useMasters() {
  const masters = useAppStore((s) => s.masters)

  return useMemo(
    () => ({
      masters,
      items(type: string, dept?: string | null): MasterItemDTO[] {
        const list = masters[type] ?? []
        return list.filter((m) => {
          if (!m.isActive) return false
          if (dept && m.dept !== 'ALL' && m.dept !== dept) return false
          return true
        })
      },
      byId(id: string): MasterItemDTO | undefined {
        for (const list of Object.values(masters)) {
          const hit = list.find((m) => m.id === id)
          if (hit) return hit
        }
        return undefined
      },
      labelOf(id?: string | null): string {
        if (!id) return '—'
        return this.byId(id)?.label ?? '—'
      },
      subItems(dispositionId: string, dept?: string | null): MasterItemDTO[] {
        return (masters['sub_disposition'] ?? []).filter((m) => {
          if (!m.isActive || m.parentId !== dispositionId) return false
          if (dept && m.dept !== 'ALL' && m.dept !== dept) return false
          return true
        })
      },
    }),
    [masters]
  )
}

/** Parse a master item's extra JSON config safely */
export function masterExtra(extra?: string | null): Record<string, unknown> {
  if (!extra) return {}
  try {
    const v = JSON.parse(extra)
    return typeof v === 'object' && v !== null ? v : {}
  } catch {
    return {}
  }
}
