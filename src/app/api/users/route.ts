import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'
import { hashPassword } from '@/lib/password'

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  department: true,
  phone: true,
  languages: true,
  teamId: true,
  isActive: true,
  dailyCallTarget: true,
  team: { select: { id: true, name: true } },
} as const

type UserBody = {
  id?: string
  name?: string
  email?: string
  password?: string
  role?: string
  department?: string | null
  phone?: string | null
  languages?: string | null
  teamId?: string | null
  dailyCallTarget?: number
  isActive?: boolean
}

export const GET = route(async (req) => {
  await requireUser()
  const sp = new URL(req.url).searchParams
  const role = sp.get('role') || undefined
  const dept = sp.get('dept') || undefined
  const q = sp.get('q') || undefined
  const teamId = sp.get('teamId') || undefined
  const active = sp.get('active')
  const users = await db.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(dept ? { department: dept } : {}),
      ...(teamId ? { teamId } : {}),
      ...(active === '1' || active === 'true' ? { isActive: true } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
    },
    select: USER_SELECT,
    orderBy: { name: 'asc' },
  })
  return ok({ users })
})

export const POST = route(async (req) => {
  const actor = await requireUser(['SUPER_ADMIN', 'ADMIN'])
  const body = await readBody<UserBody>(req)
  if (!body.name || !body.email || !body.password || !body.role) {
    throw new ApiError('name, email, password and role are required', 400)
  }
  const email = body.email.trim().toLowerCase()
  const dup = await db.user.findUnique({ where: { email } })
  if (dup) throw new ApiError('A user with this email already exists', 409)
  const user = await db.user.create({
    data: {
      name: body.name,
      email,
      password: hashPassword(body.password),
      role: body.role,
      department: body.department ?? null,
      phone: body.phone ?? null,
      languages: body.languages ?? null,
      teamId: body.teamId ?? null,
      dailyCallTarget: typeof body.dailyCallTarget === 'number' ? body.dailyCallTarget : 60,
    },
    select: USER_SELECT,
  })
  await audit(actor, 'USER_CREATE', 'User', user.id, { email, role: body.role })
  return ok({ user })
})

export const PATCH = route(async (req) => {
  const actor = await requireUser(['SUPER_ADMIN', 'ADMIN'])
  const body = await readBody<UserBody>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.user.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('User not found', 404)
  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = body.name
  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase()
    if (email !== existing.email) {
      const dup = await db.user.findUnique({ where: { email } })
      if (dup) throw new ApiError('A user with this email already exists', 409)
      data.email = email
    }
  }
  if (body.password) data.password = hashPassword(body.password)
  if (body.role !== undefined) data.role = body.role
  if (body.department !== undefined) data.department = body.department
  if (body.phone !== undefined) data.phone = body.phone
  if (body.languages !== undefined) data.languages = body.languages
  if (body.teamId !== undefined) data.teamId = body.teamId
  if (body.dailyCallTarget !== undefined) data.dailyCallTarget = body.dailyCallTarget
  if (body.isActive !== undefined) data.isActive = body.isActive
  const user = await db.user.update({ where: { id: body.id }, data, select: USER_SELECT })
  await audit(actor, 'USER_UPDATE', 'User', user.id, { fields: Object.keys(data) })
  return ok({ user })
})

export const DELETE = route(async (req) => {
  const actor = await requireUser(['SUPER_ADMIN', 'ADMIN'])
  const id = new URL(req.url).searchParams.get('id')
  if (!id) throw new ApiError('id query param is required', 400)
  const existing = await db.user.findUnique({ where: { id } })
  if (!existing) throw new ApiError('User not found', 404)
  await db.user.update({ where: { id }, data: { isActive: false } })
  await audit(actor, 'USER_DELETE', 'User', id, { email: existing.email })
  return ok({ success: true })
})
