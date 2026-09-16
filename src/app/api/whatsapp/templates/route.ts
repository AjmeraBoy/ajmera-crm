import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError } from '@/lib/api'

// ---------- local helpers ----------

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

// ---------- GET /api/whatsapp/templates?dept= ----------

export const GET = route(async (req) => {
  await requireUser()
  const dept = new URL(req.url).searchParams.get('dept') || undefined
  const templates = await db.whatsAppTemplate.findMany({
    where: {
      isActive: true,
      ...(dept ? { OR: [{ dept: null }, { dept }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
  return ok({ templates })
})

// ---------- POST /api/whatsapp/templates (ADMIN+) ----------

export const POST = route(async (req) => {
  const user = await requireUser(['ADMIN', 'SUPER_ADMIN'])
  const body = await readBody<{ name?: string; category?: string; body?: string; dept?: string; variables?: string[] }>(req)
  const name = str(body.name)
  const category = str(body.category) || 'MARKETING'
  const text = str(body.body)
  if (!name) throw new ApiError('Template name is required', 400)
  if (!text) throw new ApiError('Template body is required', 400)
  if (!['MARKETING', 'UTILITY', 'SESSION'].includes(category)) {
    throw new ApiError('category must be MARKETING, UTILITY or SESSION', 400)
  }
  const dept = str(body.dept)
  if (dept && !['ONLINE', 'EXPORT'].includes(dept)) {
    throw new ApiError('dept must be ONLINE or EXPORT', 400)
  }
  const template = await db.whatsAppTemplate.create({
    data: {
      name,
      category,
      body: text,
      dept: dept ?? null,
      variables: Array.isArray(body.variables) ? JSON.stringify(body.variables) : undefined,
    },
  })
  return ok({ template }, 201)
})
