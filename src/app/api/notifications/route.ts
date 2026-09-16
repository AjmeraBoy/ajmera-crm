import { db } from '@/lib/db'
import { ApiError, ok, readBody, requireUser, route } from '@/lib/api'

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const unreadOnly = sp.get('unread') === '1' || sp.get('unread') === 'true'
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 20, 1), 100)
  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
  ])
  return ok({ notifications, unreadCount })
})

export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ id?: string; all?: boolean }>(req)
  if (body.all) {
    const res = await db.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    })
    return ok({ updated: res.count })
  }
  if (!body.id) throw new ApiError('id or all is required', 400)
  const res = await db.notification.updateMany({
    where: { id: body.id, userId: user.id },
    data: { isRead: true },
  })
  if (res.count === 0) throw new ApiError('Notification not found', 404)
  return ok({ success: true })
})
