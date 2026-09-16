import { db } from '@/lib/db'
import { ApiError, assertDeptAccess, audit, deptScope, ok, readBody, requireUser, route } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function teamScopedUserIds(user: SessionUser): Promise<string[]> {
  const led = await db.team.findMany({ where: { leaderId: user.id }, select: { id: true } })
  const teamIds = led.map((t) => t.id)
  if (user.teamId && !teamIds.includes(user.teamId)) teamIds.push(user.teamId)
  const members = await db.user.findMany({ where: { teamId: { in: teamIds } }, select: { id: true } })
  return Array.from(new Set([user.id, ...members.map((m) => m.id)]))
}

const TARGET_SELECT = {
  id: true,
  userId: true,
  month: true,
  amount: true,
  user: { select: { id: true, name: true, role: true, department: true } },
} as const

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const month = sp.get('month') || currentMonth()
  const userId = sp.get('userId') || undefined
  const dept = sp.get('dept') || undefined
  if (dept) assertDeptAccess(user, dept)
  const scope = dept ? [dept] : deptScope(user)

  let userIds: string[] | undefined
  if (user.role === 'EXECUTIVE') userIds = [user.id]
  else if (user.role === 'TEAM_LEADER') userIds = await teamScopedUserIds(user)

  const targets = await db.target.findMany({
    where: {
      month,
      ...(userId ? { userId } : {}),
      ...(userIds ? { userId: { in: userIds } } : {}),
      ...(scope ? { user: { department: { in: scope } } } : {}),
    },
    select: TARGET_SELECT,
    orderBy: { user: { name: 'asc' } },
  })
  return ok({ targets })
})

export const POST = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER'])
  const body = await readBody<{ month?: string; items?: { userId: string; amount: number }[] }>(req)
  const month = body.month || currentMonth()
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError('month must be in YYYY-MM format', 400)
  const items = (body.items ?? []).filter((i) => i && typeof i.userId === 'string')
  if (items.length === 0) throw new ApiError('items (userId + amount) are required', 400)

  if (user.role === 'TEAM_LEADER') {
    const allowed = new Set(await teamScopedUserIds(user))
    const bad = items.find((i) => !allowed.has(i.userId))
    if (bad) throw new ApiError('Team leaders can only set targets for their own team members', 403)
  } else {
    const scope = deptScope(user)
    if (scope) {
      const users = await db.user.findMany({
        where: { id: { in: items.map((i) => i.userId) } },
        select: { id: true, department: true },
      })
      const bad = users.find((u) => !u.department || !scope.includes(u.department))
      if (bad) throw new ApiError('You cannot set targets for users outside your department', 403)
    }
  }

  await db.$transaction(
    items.map((i) =>
      db.target.upsert({
        where: { userId_month: { userId: i.userId, month } },
        update: { amount: Math.round(Number(i.amount) || 0) },
        create: { userId: i.userId, month, amount: Math.round(Number(i.amount) || 0) },
      })
    )
  )
  await audit(user, 'TARGET_UPSERT', 'Target', undefined, { month, count: items.length })

  const scope = user.role === 'TEAM_LEADER' ? null : deptScope(user)
  const targets = await db.target.findMany({
    where: {
      month,
      ...(user.role === 'TEAM_LEADER' ? { userId: { in: await teamScopedUserIds(user) } } : {}),
      ...(scope ? { user: { department: { in: scope } } } : {}),
    },
    select: TARGET_SELECT,
    orderBy: { user: { name: 'asc' } },
  })
  return ok({ targets })
})
