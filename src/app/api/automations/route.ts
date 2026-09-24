import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'

/**
 * Automation rules CRUD — GET/POST/PATCH/DELETE /api/automations
 * Management roles only. actions/conditions are stored as JSON strings.
 */

const TRIGGERS = [
  'LEAD_CREATED',
  'LEAD_ASSIGNED',
  'LEAD_STATUS_CHANGED',
  'FOLLOWUP_DUE',
  'CALL_MISSED',
  'CALL_COMPLETED',
  'INBOUND_WHATSAPP',
  'WHATSAPP_FAILED',
  'MANUAL',
]

const ACTION_TYPES = ['SEND_WHATSAPP_TEMPLATE', 'CREATE_TASK', 'NOTIFY_AGENT', 'UPDATE_LEAD_FIELD']

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

type RuleBody = {
  id?: string
  name?: string
  trigger?: string
  dept?: string | null
  conditions?: unknown
  actions?: unknown
  isActive?: boolean
}

export const GET = route(async (req) => {
  await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const sp = new URL(req.url).searchParams
  const withLogs = sp.get('withLogs') === '1'
  const rules = await db.automationRule.findMany({
    orderBy: { createdAt: 'desc' },
    include: withLogs
      ? { logs: { orderBy: { createdAt: 'desc' }, take: 5 } }
      : undefined,
  })
  return ok({ rules })
})

export const POST = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const body = await readBody<RuleBody>(req)
  const name = str(body.name)
  const trigger = str(body.trigger)?.toUpperCase()
  if (!name) throw new ApiError('Rule name is required', 400)
  if (!trigger || !TRIGGERS.includes(trigger)) throw new ApiError(`trigger must be one of ${TRIGGERS.join(', ')}`, 400)

  let actionsJson: string
  if (Array.isArray(body.actions) && body.actions.length > 0) {
    for (const a of body.actions) {
      const at = (a as Record<string, unknown>)?.type
      if (!at || !ACTION_TYPES.includes(String(at))) {
        throw new ApiError(`action.type must be one of ${ACTION_TYPES.join(', ')}`, 400)
      }
      if (at === 'SEND_WHATSAPP_TEMPLATE' && !(a as Record<string, unknown>).templateId) {
        throw new ApiError('SEND_WHATSAPP_TEMPLATE requires templateId', 400)
      }
    }
    actionsJson = JSON.stringify(body.actions)
  } else {
    throw new ApiError('At least one action is required', 400)
  }

  let conditionsJson: string | undefined
  if (body.conditions !== undefined && body.conditions !== null) {
    if (!Array.isArray(body.conditions)) throw new ApiError('conditions must be an array', 400)
    conditionsJson = body.conditions.length ? JSON.stringify(body.conditions) : undefined
  }

  const dept = str(body.dept)
  if (dept && !['ONLINE', 'EXPORT'].includes(dept)) throw new ApiError('dept must be ONLINE or EXPORT', 400)

  const rule = await db.automationRule.create({
    data: {
      name,
      trigger,
      dept: dept ?? null,
      conditions: conditionsJson ?? null,
      actions: actionsJson,
      isActive: body.isActive === true,
    },
  })
  await audit(user, 'AUTOMATION_CREATE', 'AutomationRule', rule.id, { name, trigger })
  return ok({ rule }, 201)
})

export const PATCH = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const body = await readBody<RuleBody>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.automationRule.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Rule not found', 404)

  const data: Record<string, unknown> = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.trigger !== undefined) {
    const trigger = String(body.trigger).toUpperCase()
    if (!TRIGGERS.includes(trigger)) throw new ApiError(`trigger must be one of ${TRIGGERS.join(', ')}`, 400)
    data.trigger = trigger
  }
  if (body.dept !== undefined) {
    const dept = str(body.dept)
    if (dept && !['ONLINE', 'EXPORT'].includes(dept)) throw new ApiError('dept must be ONLINE or EXPORT', 400)
    data.dept = dept ?? null
  }
  if (body.conditions !== undefined) {
    if (body.conditions === null || (Array.isArray(body.conditions) && body.conditions.length === 0)) {
      data.conditions = null
    } else if (Array.isArray(body.conditions)) {
      data.conditions = JSON.stringify(body.conditions)
    } else throw new ApiError('conditions must be an array', 400)
  }
  if (body.actions !== undefined) {
    if (!Array.isArray(body.actions) || body.actions.length === 0) {
      throw new ApiError('actions must be a non-empty array', 400)
    }
    data.actions = JSON.stringify(body.actions)
  }
  if (body.isActive !== undefined) data.isActive = body.isActive === true

  const rule = await db.automationRule.update({ where: { id: body.id }, data })
  await audit(user, 'AUTOMATION_UPDATE', 'AutomationRule', rule.id, { fields: Object.keys(data) })
  return ok({ rule })
})

export const DELETE = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const id = new URL(req.url).searchParams.get('id')
  if (!id) throw new ApiError('id query param is required', 400)
  await db.automationRule.delete({ where: { id } })
  await audit(user, 'AUTOMATION_DELETE', 'AutomationRule', id)
  return ok({ success: true })
})
