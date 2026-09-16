import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, route } from '@/lib/api'
import { SESSION_COOKIE, createSession, type SessionUser } from '@/lib/auth'
import { verifyPassword } from '@/lib/password'

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 // 7 days in seconds

export const POST = route(async (req) => {
  const body = await readBody<{ email?: string; password?: string }>(req)
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  if (!email || !password) throw new ApiError('Email and password are required', 400)

  const user = await db.user.findUnique({ where: { email }, include: { team: true } })
  if (!user || !user.isActive || !verifyPassword(password, user.password)) {
    throw new ApiError('Invalid email or password', 401)
  }

  const { token } = await createSession(user.id)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })

  const sessionUser: SessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    phone: user.phone,
    languages: user.languages,
    teamId: user.teamId,
    dailyCallTarget: user.dailyCallTarget,
  }
  await audit(sessionUser, 'LOGIN', 'User', user.id, { email })
  return ok({
    user: {
      ...sessionUser,
      team: user.team ? { id: user.team.id, name: user.team.name, department: user.team.department } : null,
    },
  })
})
