import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, requireUser, route } from '@/lib/api'

/** GET /api/comm/api-logs — technical provider call logs (management only). */
export const GET = route(async (req) => {
  await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const sp = new URL(req.url).searchParams
  const where: Prisma.ApiLogWhereInput = {}
  const provider = sp.get('provider')
  if (provider) where.provider = provider
  const success = sp.get('success')
  if (success === '1' || success === 'true') where.success = true
  if (success === '0' || success === 'false') where.success = false
  const errorType = sp.get('errorType')
  if (errorType) where.errorType = errorType

  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 25))
  const [logs, total] = await Promise.all([
    db.apiLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.apiLog.count({ where }),
  ])
  return ok({ logs, total, page, pageSize })
})
