import { db } from '@/lib/db'
import { ok, requireUser, route } from '@/lib/api'

export const GET = route(async (req) => {
  await requireUser(['SUPER_ADMIN', 'ADMIN'])
  const sp = new URL(req.url).searchParams
  const q = sp.get('q') || undefined
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 100, 1), 500)
  const page = Math.max(Number(sp.get('page')) || 1, 1)
  const where = q
    ? {
        OR: [
          { action: { contains: q } },
          { entity: { contains: q } },
          { entityId: { contains: q } },
          { userName: { contains: q } },
          { details: { contains: q } },
        ],
      }
    : {}
  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, name: true, role: true } } },
    }),
    db.auditLog.count({ where }),
  ])
  return ok({ logs, total, page, limit })
})
