import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'

export const GET = route(async (req) => {
  await requireUser()
  const dept = new URL(req.url).searchParams.get('dept') || undefined
  const teams = await db.team.findMany({
    where: dept ? { department: dept } : {},
    select: {
      id: true,
      name: true,
      department: true,
      leader: { select: { id: true, name: true } },
      members: { select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } },
    },
    orderBy: { name: 'asc' },
  })
  return ok({ teams })
})

export const POST = route(async (req) => {
  const actor = await requireUser(['SUPER_ADMIN', 'ADMIN'])
  const body = await readBody<{ name?: string; department?: string; leaderId?: string | null }>(req)
  if (!body.name || !body.department) throw new ApiError('name and department are required', 400)
  const team = await db.team.create({
    data: { name: body.name, department: body.department, leaderId: body.leaderId ?? null },
    select: {
      id: true,
      name: true,
      department: true,
      leader: { select: { id: true, name: true } },
      members: { select: { id: true, name: true, role: true } },
    },
  })
  await audit(actor, 'TEAM_CREATE', 'Team', team.id, { name: team.name, department: team.department })
  return ok({ team })
})

export const PATCH = route(async (req) => {
  const actor = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const body = await readBody<{ id?: string; name?: string; leaderId?: string | null }>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.team.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Team not found', 404)
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.leaderId !== undefined) data.leaderId = body.leaderId
  const team = await db.team.update({
    where: { id: body.id },
    data,
    select: {
      id: true,
      name: true,
      department: true,
      leader: { select: { id: true, name: true } },
      members: { select: { id: true, name: true, role: true } },
    },
  })
  await audit(actor, 'TEAM_UPDATE', 'Team', team.id, data)
  return ok({ team })
})
