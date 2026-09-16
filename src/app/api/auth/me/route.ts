import { db } from '@/lib/db'
import { ApiError, ok, requireUser, route } from '@/lib/api'

export const GET = route(async () => {
  const session = await requireUser()
  const user = await db.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      department: true,
      phone: true,
      languages: true,
      teamId: true,
      dailyCallTarget: true,
      isActive: true,
      team: { select: { id: true, name: true, department: true } },
    },
  })
  if (!user) throw new ApiError('User not found', 404)
  const { team, ...rest } = user
  return ok({ user: { ...rest, team: team ?? null } })
})
