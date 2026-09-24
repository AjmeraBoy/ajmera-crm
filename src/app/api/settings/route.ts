import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'

async function settingsMap(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export const GET = route(async () => {
  await requireUser()
  return ok({ settings: await settingsMap() })
})

export const PUT = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN'])
  const body = await readBody<{ key?: string; value?: unknown; settings?: Record<string, unknown> }>(req)
  const entries: [string, string][] = []
  if (body.settings && typeof body.settings === 'object') {
    for (const [k, v] of Object.entries(body.settings)) entries.push([k, String(v)])
  } else if (body.key) {
    entries.push([body.key, String(body.value ?? '')])
  }
  if (entries.length === 0) throw new ApiError('key/value or settings object is required', 400)
  await db.$transaction(
    entries.map(([key, value]) =>
      db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  )
  await audit(user, 'SETTINGS_UPDATE', 'Setting', undefined, Object.fromEntries(entries))
  return ok({ settings: await settingsMap() })
})
