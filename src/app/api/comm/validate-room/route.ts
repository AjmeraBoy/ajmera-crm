import { db } from '@/lib/db'
import { fail, ok, route, readBody } from '@/lib/api'

/**
 * POST /api/comm/validate-room
 * INTERNAL — socket relay asks whether a user may join `conversation:<id>`.
 */
export const POST = route(async (req) => {
  const secret = req.headers.get('x-internal-secret')
  if (secret !== (process.env.INTERNAL_EVENT_SECRET || 'dev-internal-secret')) {
    return fail('unauthorized', 401)
  }
  const body = await readBody<{ userId?: string; role?: string; conversationId?: string }>(req)
  if (!body.userId || !body.conversationId) return fail('userId and conversationId required', 400)

  if (['SUPER_ADMIN', 'ADMIN'].includes(body.role ?? '')) return ok({ allowed: true })

  const conv = await db.whatsAppConversation.findUnique({
    where: { id: body.conversationId },
    select: { ownerId: true, owner: { select: { teamId: true } } },
  })
  if (!conv) return ok({ allowed: false })
  if (conv.ownerId === body.userId) return ok({ allowed: true })
  if (body.role === 'TEAM_LEADER' && conv.owner?.teamId) {
    const leader = await db.user.findUnique({ where: { id: body.userId }, select: { teamId: true } })
    if (leader?.teamId && leader.teamId === conv.owner.teamId) return ok({ allowed: true })
  }
  return ok({ allowed: false })
})
