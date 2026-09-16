import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'

type MasterBody = {
  id?: string
  type?: string
  label?: string
  value?: string | null
  parentId?: string | null
  dept?: string
  extra?: unknown
  order?: number
  isActive?: boolean
}

function normalizeExtra(extra: unknown): string | undefined {
  if (extra === undefined || extra === null) return undefined
  if (typeof extra === 'string') return extra
  try {
    return JSON.stringify(extra)
  } catch {
    return undefined
  }
}

export const GET = route(async (req) => {
  await requireUser()
  const sp = new URL(req.url).searchParams
  const types = (sp.get('types') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (types.length === 0) throw new ApiError('types query param is required (comma separated)', 400)
  const dept = sp.get('dept') || undefined
  const onlyActive = sp.get('onlyActive') === '1' || sp.get('onlyActive') === 'true'
  const items = await db.masterItem.findMany({
    where: {
      type: { in: types },
      ...(dept ? { dept: { in: [dept, 'ALL'] } } : {}),
      ...(onlyActive ? { isActive: true } : {}),
    },
    orderBy: [{ order: 'asc' }, { label: 'asc' }],
  })
  return ok({ items })
})

export const POST = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const body = await readBody<MasterBody>(req)
  if (!body.type || !body.label) throw new ApiError('type and label are required', 400)
  const item = await db.masterItem.create({
    data: {
      type: body.type,
      label: body.label,
      value: body.value ?? null,
      parentId: body.parentId ?? null,
      dept: body.dept || 'ALL',
      extra: normalizeExtra(body.extra),
      order: typeof body.order === 'number' ? body.order : 0,
    },
  })
  await audit(user, 'MASTER_CREATE', 'MasterItem', item.id, { type: item.type, label: item.label })
  return ok({ item })
})

export const PATCH = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const body = await readBody<MasterBody>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.masterItem.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Master item not found', 404)
  const data: Record<string, unknown> = {}
  if (body.label !== undefined) data.label = body.label
  if (body.value !== undefined) data.value = body.value
  if (body.parentId !== undefined) data.parentId = body.parentId
  if (body.dept !== undefined) data.dept = body.dept
  if (body.extra !== undefined) data.extra = normalizeExtra(body.extra)
  if (body.order !== undefined) data.order = body.order
  if (body.isActive !== undefined) data.isActive = body.isActive
  const item = await db.masterItem.update({ where: { id: body.id }, data })
  await audit(user, 'MASTER_UPDATE', 'MasterItem', item.id, data)
  return ok({ item })
})

export const DELETE = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const id = new URL(req.url).searchParams.get('id')
  if (!id) throw new ApiError('id query param is required', 400)
  const existing = await db.masterItem.findUnique({ where: { id } })
  if (!existing) throw new ApiError('Master item not found', 404)
  await db.masterItem.update({ where: { id }, data: { isActive: false } })
  await audit(user, 'MASTER_DELETE', 'MasterItem', id, { type: existing.type, label: existing.label })
  return ok({ success: true })
})
