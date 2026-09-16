import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, type SessionUser } from '@/lib/auth'

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data as Record<string, unknown>, { status })
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Wrap a route handler with unified error handling */
export function route(handler: (req: Request, ctx?: unknown) => Promise<Response>) {
  return async (req: Request, ctx?: unknown): Promise<Response> => {
    try {
      return await handler(req, ctx)
    } catch (e) {
      if (e instanceof ApiError) return fail(e.message, e.status)
      console.error('[api-error]', e)
      const message = e instanceof Error ? e.message : 'Internal server error'
      return fail(message, 500)
    }
  }
}

/** Require an authenticated user, optionally with specific roles */
export async function requireUser(roles?: string[]): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) throw new ApiError('Please login to continue', 401)
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    throw new ApiError('You do not have permission to perform this action', 403)
  }
  return user
}

export async function readBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
}

/** Departments visible to a user. null means ALL departments */
export function deptScope(user: SessionUser): string[] | null {
  if (user.role === 'SUPER_ADMIN') return null
  if (user.department) return [user.department]
  return null
}

/** Throw 403 if the user's department scope excludes the given department */
export function assertDeptAccess(user: SessionUser, department: string | null | undefined) {
  const scope = deptScope(user)
  if (scope && department && !scope.includes(department)) {
    throw new ApiError('This record belongs to another department', 403)
  }
}

const MANAGEMENT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER']
export function isManagement(user: SessionUser): boolean {
  return MANAGEMENT_ROLES.includes(user.role)
}
export { MANAGEMENT_ROLES }

/** Write an audit log entry (never throws) */
export async function audit(
  user: SessionUser | null,
  action: string,
  entity?: string,
  entityId?: string,
  details?: unknown
) {
  try {
    await db.auditLog.create({
      data: {
        userId: user?.id,
        userName: user?.name,
        action,
        entity,
        entityId,
        details: details ? JSON.stringify(details) : undefined,
      },
    })
  } catch (e) {
    console.error('[audit-fail]', e)
  }
}

/** Create an in-app notification (never throws) */
export async function notify(
  userId: string,
  title: string,
  body?: string,
  type = 'INFO',
  link?: string
) {
  try {
    await db.notification.create({ data: { userId, title, body, type, link } })
  } catch (e) {
    console.error('[notify-fail]', e)
  }
}

/** Parse a date param that may be undefined/null */
export function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return isNaN(d.getTime()) ? undefined : d
}

/** Parse comma separated ids param */
export function parseList(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}
