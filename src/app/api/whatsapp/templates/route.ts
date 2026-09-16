import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError } from '@/lib/api'

// ---------- local helpers ----------

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION', 'SESSION']
const STATUSES = ['APPROVED', 'PENDING', 'REJECTED', 'DISABLED']
const HEADER_TYPES = ['NONE', 'TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO']

/** Count template variables: highest {{N}} found in the body (0 if none). */
function computeVariableCount(text: string): number {
  let max = 0
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

type TemplateBody = {
  id?: string
  name?: string
  providerTemplateId?: string
  language?: string
  category?: string
  status?: string
  body?: string
  headerType?: string
  headerText?: string | null
  footerText?: string | null
  buttons?: unknown
  variableCount?: number
  variables?: unknown
  dept?: string | null
  isActive?: boolean
}

/** Validate + shape the updatable fields; returns Prisma-ready data. */
function templateData(body: TemplateBody, existing?: { body: string }): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = str(body.name)
    if (!name) throw new ApiError('Template name cannot be empty', 400)
    data.name = name
  }
  if (body.providerTemplateId !== undefined) data.providerTemplateId = str(body.providerTemplateId) ?? null
  if (body.language !== undefined) {
    const language = str(body.language)
    if (!language) throw new ApiError('language cannot be empty', 400)
    data.language = language
  }
  if (body.category !== undefined) {
    const category = str(body.category)?.toUpperCase()
    if (!category || !CATEGORIES.includes(category)) {
      throw new ApiError(`category must be one of ${CATEGORIES.join(', ')}`, 400)
    }
    data.category = category
  }
  if (body.status !== undefined) {
    const status = str(body.status)?.toUpperCase()
    if (!status || !STATUSES.includes(status)) {
      throw new ApiError(`status must be one of ${STATUSES.join(', ')}`, 400)
    }
    data.status = status
  }
  if (body.body !== undefined) {
    const text = str(body.body)
    if (!text) throw new ApiError('Template body cannot be empty', 400)
    data.body = text
  }
  if (body.headerType !== undefined) {
    const headerType = str(body.headerType)?.toUpperCase()
    if (!headerType || !HEADER_TYPES.includes(headerType)) {
      throw new ApiError(`headerType must be one of ${HEADER_TYPES.join(', ')}`, 400)
    }
    data.headerType = headerType
  }
  if (body.headerText !== undefined) data.headerText = str(body.headerText) ?? null
  if (body.footerText !== undefined) data.footerText = str(body.footerText) ?? null
  if (body.buttons !== undefined) {
    if (body.buttons === null) data.buttons = null
    else if (!Array.isArray(body.buttons)) throw new ApiError('buttons must be an array', 400)
    else data.buttons = JSON.stringify(body.buttons)
  }
  if (body.variables !== undefined) {
    if (body.variables === null) data.variables = null
    else if (typeof body.variables === 'string') {
      // Tolerate clients that pre-encode the array as a JSON string
      try {
        const arr: unknown = JSON.parse(body.variables)
        if (!Array.isArray(arr)) throw new Error('not array')
        data.variables = JSON.stringify(arr.map((v) => String(v)))
      } catch {
        data.variables = JSON.stringify([String(body.variables)])
      }
    } else if (!Array.isArray(body.variables)) throw new ApiError('variables must be an array of labels', 400)
    else data.variables = JSON.stringify(body.variables.map((v) => String(v)))
  }
  if (body.dept !== undefined) {
    const dept = str(body.dept)
    if (dept && !['ONLINE', 'EXPORT'].includes(dept)) throw new ApiError('dept must be ONLINE or EXPORT', 400)
    data.dept = dept ?? null
  }
  if (body.isActive !== undefined) data.isActive = body.isActive === true

  // variableCount: explicit value wins; otherwise compute from the (new or
  // existing) template body using the highest {{N}} placeholder.
  if (body.variableCount !== undefined) {
    const n = Number(body.variableCount)
    if (!Number.isFinite(n) || n < 0) throw new ApiError('variableCount must be a non-negative number', 400)
    data.variableCount = Math.round(n)
  } else if (data.body !== undefined) {
    data.variableCount = computeVariableCount(String(data.body))
  } else if (existing) {
    data.variableCount = computeVariableCount(existing.body)
  }

  return data
}

// ---------- GET /api/whatsapp/templates?dept= ----------

export const GET = route(async (req) => {
  await requireUser()
  const dept = new URL(req.url).searchParams.get('dept') || undefined
  const templates = await db.whatsAppTemplate.findMany({
    where: dept ? { OR: [{ dept: null }, { dept }] } : {},
    orderBy: { updatedAt: 'desc' },
  })
  return ok({ templates })
})

// ---------- POST /api/whatsapp/templates (ADMIN+) ----------

export const POST = route(async (req) => {
  await requireUser(['ADMIN', 'SUPER_ADMIN'])
  const body = await readBody<TemplateBody>(req)

  const name = str(body.name)
  const text = str(body.body)
  if (!name) throw new ApiError('Template name is required', 400)
  if (!text) throw new ApiError('Template body is required', 400)

  const data = templateData({ ...body, name, body: text })
  const template = await db.whatsAppTemplate.create({
    data: data as Prisma.WhatsAppTemplateUncheckedCreateInput,
  })
  return ok({ template }, 201)
})

// ---------- PATCH /api/whatsapp/templates (ADMIN+) ----------

export const PATCH = route(async (req) => {
  await requireUser(['ADMIN', 'SUPER_ADMIN'])
  const body = await readBody<TemplateBody>(req)
  if (!body.id) throw new ApiError('id is required', 400)

  const existing = await db.whatsAppTemplate.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Template not found', 404)

  const data = templateData(body, existing)
  if (Object.keys(data).length === 0) throw new ApiError('Nothing to update', 400)

  const template = await db.whatsAppTemplate.update({
    where: { id: body.id },
    data: data as Prisma.WhatsAppTemplateUncheckedUpdateInput,
  })
  return ok({ template })
})
