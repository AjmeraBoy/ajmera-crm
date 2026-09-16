import { cookies } from 'next/headers'
import { audit, ok, requireUser, route } from '@/lib/api'
import { SESSION_COOKIE, destroySession } from '@/lib/auth'

export const POST = route(async () => {
  const user = await requireUser().catch(() => null)
  await destroySession()
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  if (user) await audit(user, 'LOGOUT', 'User', user.id)
  return ok({ success: true })
})
