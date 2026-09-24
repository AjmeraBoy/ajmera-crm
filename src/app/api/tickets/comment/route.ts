import { db } from '@/lib/db'
import { ApiError, assertDeptAccess, audit, ok, readBody, requireUser, route } from '@/lib/api'

// POST /api/tickets/comment {ticketId, body, isInternal?}
export const POST = route(async (req) => {
  const user = await requireUser()
  const input = await readBody<{ ticketId?: string; body?: string; isInternal?: boolean }>(req)
  if (!input.ticketId) throw new ApiError('ticketId is required', 400)
  if (!input.body || !input.body.trim()) throw new ApiError('Comment body is required', 400)
  const ticket = await db.supportTicket.findUnique({ where: { id: input.ticketId } })
  if (!ticket) throw new ApiError('Ticket not found', 404)
  assertDeptAccess(user, ticket.department)
  const comment = await db.ticketComment.create({
    data: {
      ticketId: ticket.id,
      userId: user.id,
      body: input.body.trim(),
      isInternal: !!input.isInternal,
    },
    include: { user: { select: { id: true, name: true } } },
  })
  await audit(user, 'CREATE', 'ticket_comment', comment.id, { ticketId: ticket.id })
  return ok({ comment }, 201)
})
