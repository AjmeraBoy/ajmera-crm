import { db } from '@/lib/db'
import { ApiError, assertDeptAccess, ok, requireUser, route } from '@/lib/api'

// GET /api/tickets/comments?ticketId=
export const GET = route(async (req) => {
  const user = await requireUser()
  const ticketId = new URL(req.url).searchParams.get('ticketId')
  if (!ticketId) throw new ApiError('ticketId is required', 400)
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId } })
  if (!ticket) throw new ApiError('Ticket not found', 404)
  assertDeptAccess(user, ticket.department)
  const comments = await db.ticketComment.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  })
  return ok({ comments })
})
