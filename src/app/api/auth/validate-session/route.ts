import { getSessionUser } from '@/lib/auth'
import { fail, ok, route } from '@/lib/api'

/**
 * POST /api/auth/validate-session
 * INTERNAL — used by the socket.io relay service to validate browser sessions
 * (the CRM session cookie is forwarded). Requires the internal shared secret.
 */
export const POST = route(async (req) => {
  const secret = req.headers.get('x-internal-secret')
  if (secret !== (process.env.INTERNAL_EVENT_SECRET || 'dev-internal-secret')) {
    return fail('unauthorized', 401)
  }
  const user = await getSessionUser()
  if (!user) return fail('session invalid', 401)
  return ok({ user: { id: user.id, name: user.name, role: user.role, department: user.department } })
})
