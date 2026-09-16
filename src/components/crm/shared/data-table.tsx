'use client'

import { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: string
  className?: string
  render?: (row: T) => ReactNode
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  loading,
  emptyMessage = 'No records found',
  onRowClick,
  maxH,
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  emptyMessage?: string
  onRowClick?: (row: T) => void
  maxH?: string
}) {
  return (
    <div className={cn('w-full overflow-auto rounded-xl border border-stone-200 bg-white shadow-sm', maxH)} data-slot="data-table">
      <Table>
        <TableHeader>
          <TableRow className="bg-stone-50 hover:bg-stone-50">
            {columns.map((c) => (
              <TableHead key={c.key} className={cn('h-10 whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-stone-500', c.className)}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={`sk-${i}`}>
                {columns.map((c) => (
                  <TableCell key={c.key}>
                    <Skeleton className="h-4 w-full max-w-[140px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-stone-500">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, idx) => (
              <TableRow
                key={(row.id as string) ?? `row-${idx}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && 'cursor-pointer transition-colors hover:bg-emerald-50/40')}
              >
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn('py-3 text-sm text-stone-700', c.className)}>
                    {c.render ? c.render(row) : ((row[c.key] as ReactNode) ?? <span className="text-stone-400">—</span>)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
