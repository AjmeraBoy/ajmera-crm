import { cookies, headers } from 'next/headers'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'

export const SESSION_COOKIE = 'af_crm_session'
const SESSION_DAYS = 7

export type SessionUser = {
  id: string
  name: string
  email: string
  role: string
  department: string | null
  phone: string | null
  languages: string | null
  teamId: string | null
  dailyCallTarget: number
}

export function newSessionToken(): string {
  return randomBytes(24).toString('hex')
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { token, userId, expiresAt } })
  return { token, expiresAt }
}

/**
 * Resolve the raw session token for the current request.
 * Sources, in priority order:
 *   1. `af_crm_session` cookie (normal same-site browser access)
 *   2. `Authorization: Bearer <token>` header (cookie-restricted contexts,
 *      e.g. the sandbox preview panel embedding the app in a cross-site
 *      iframe where third-party cookies are blocked)
 */
export async function resolveSessionToken(): Promise<string | null> {
  try {
    const store = await cookies()
    const cookieToken = store.get(SESSION_COOKIE)?.value
    if (cookieToken) return cookieToken
  } catch {
    // cookies() unavailable in this context — fall through to headers
  }
  try {
    const h = await headers()
    const auth = h.get('authorization')
    if (auth?.toLowerCase().startsWith('bearer ')) {
      const token = auth.slice(7).trim()
      if (token) return token
    }
  } catch {
    // headers() unavailable — no token
  }
  return null
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const token = await resolveSessionToken()
    if (!token) return null
    const session = await db.session.findUnique({
      where: { token },
      include: { user: true },
    })
    if (!session) return null
    if (session.expiresAt < new Date()) {
      await db.session.delete({ where: { id: session.id } }).catch(() => {})
      return null
    }
    if (!session.user.isActive) return null
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      department: session.user.department,
      phone: session.user.phone,
      languages: session.user.languages,
      teamId: session.user.teamId,
      dailyCallTarget: session.user.dailyCallTarget,
    }
  } catch {
    return null
  }
}

export async function destroySession(): Promise<void> {
  const token = await resolveSessionToken()
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => {})
  }
}
