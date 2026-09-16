import { db } from '@/lib/db'
import { notify } from '@/lib/api'
import { sendWhatsappMessage } from './whatsapp'
import { ensureConversation } from './conversation'
import { emitSocketEvent } from './socket'

/**
 * Communication Automation Engine — WHEN/THEN rules.
 *
 * Triggers: LEAD_CREATED | LEAD_ASSIGNED | LEAD_STATUS_CHANGED | FOLLOWUP_DUE |
 *           CALL_MISSED | CALL_COMPLETED | INBOUND_WHATSAPP | WHATSAPP_FAILED
 *
 * Actions:
 *  - SEND_WHATSAPP_TEMPLATE {templateId, params?: string[], campaign?: string}
 *  - CREATE_TASK {title, dueInHours, assignedTo?: 'owner'}   → FollowUp record
 *  - NOTIFY_AGENT {message}
 *  - UPDATE_LEAD_FIELD {field, value}
 *
 * Conditions: JSON [{field, op: eq|neq|contains|in|gt|lt, value}] evaluated
 * against the lead record (and ctx meta fallback).
 */

export type TriggerName =
  | 'LEAD_CREATED'
  | 'LEAD_ASSIGNED'
  | 'LEAD_STATUS_CHANGED'
  | 'FOLLOWUP_DUE'
  | 'CALL_MISSED'
  | 'CALL_COMPLETED'
  | 'INBOUND_WHATSAPP'
  | 'WHATSAPP_FAILED'
  | 'MANUAL'

type Condition = { field: string; op: 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'lt'; value: unknown }
type Action =
  | { type: 'SEND_WHATSAPP_TEMPLATE'; templateId: string; params?: string[]; campaign?: string }
  | { type: 'CREATE_TASK'; title: string; dueInHours?: number; assignedTo?: string }
  | { type: 'NOTIFY_AGENT'; message: string }
  | { type: 'UPDATE_LEAD_FIELD'; field: string; value: unknown }

export type AutomationCtx = {
  leadId?: string | null
  userId?: string | null
  conversationId?: string | null
  phone?: string
  messageBody?: string
  callId?: string | null
  messageId?: string | null
  connected?: boolean
  meta?: Record<string, unknown>
}

function evalCondition(cond: Condition, data: Record<string, unknown>): boolean {
  const actual = data[cond.field]
  switch (cond.op) {
    case 'eq': return String(actual) === String(cond.value)
    case 'neq': return String(actual) !== String(cond.value)
    case 'contains': return String(actual ?? '').toLowerCase().includes(String(cond.value ?? '').toLowerCase())
    case 'in': return Array.isArray(cond.value) ? cond.value.map(String).includes(String(actual)) : false
    case 'gt': return Number(actual) > Number(cond.value)
    case 'lt': return Number(actual) < Number(cond.value)
    default: return true
  }
}

/**
 * Run all active rules for a trigger. Never throws — automation failures are
 * logged (AutomationLog + ApiLog) and must not break the main CRM flow.
 */
export async function runAutomations(trigger: TriggerName, ctx: AutomationCtx): Promise<void> {
  try {
    const rules = await db.automationRule.findMany({
      where: { trigger, isActive: true },
      orderBy: { createdAt: 'asc' },
    })
    if (rules.length === 0) return

    const lead = ctx.leadId
      ? await db.lead.findUnique({
          where: { id: ctx.leadId },
          include: { source: { select: { label: true } }, assignedTo: { select: { id: true, name: true } } },
        })
      : null

    for (const rule of rules) {
      const detail: Record<string, unknown> = { actions: [] as unknown[] }
      let status: 'SUCCESS' | 'FAILED' | 'SKIPPED' = 'SUCCESS'
      try {
        // dept scope
        if (rule.dept && lead && lead.department !== rule.dept) {
          status = 'SKIPPED'
          detail.reason = `Rule scoped to ${rule.dept}, lead is ${lead.department}`
        } else {
          // conditions
          if (rule.conditions) {
            const conds = JSON.parse(rule.conditions) as Condition[]
            const data: Record<string, unknown> = {
              ...(lead
                ? {
                    department: lead.department,
                    status: lead.status,
                    customerType: lead.customerType,
                    source: lead.source?.label,
                    priority: lead.priority,
                    optInStatus: lead.optInStatus,
                    assignedToId: lead.assignedToId,
                  }
                : {}),
              ...ctx.meta,
              messageBody: ctx.messageBody,
            }
            const failed = conds.find((c) => !evalCondition(c, data))
            if (failed) {
              status = 'SKIPPED'
              detail.reason = `Condition not met: ${failed.field} ${failed.op} ${JSON.stringify(failed.value)} (actual: ${JSON.stringify(data[failed.field])})`
            }
          }
        }

        if (status === 'SUCCESS') {
          const actions = JSON.parse(rule.actions) as Action[]
          const results: string[] = []
          for (const action of actions) {
            results.push(await executeAction(action, rule.id, ctx, lead))
          }
          detail.actions = results
        }
      } catch (e) {
        status = 'FAILED'
        detail.error = e instanceof Error ? e.message : String(e)
      }

      await db.automationLog.create({
        data: {
          ruleId: rule.id,
          leadId: ctx.leadId ?? undefined,
          trigger,
          status,
          detail: JSON.stringify(detail).slice(0, 2000),
        },
      })
      await db.automationRule.update({
        where: { id: rule.id },
        data: { lastRunAt: new Date(), runCount: { increment: 1 } },
      })
    }
  } catch (e) {
    console.error('[automation-engine-fail]', e)
  }
}

type LeadWithRefs = import('@prisma/client').Prisma.LeadGetPayload<{
  include: { source: { select: { label: true } }; assignedTo: { select: { id: true; name: true } } }
}>

async function executeAction(
  action: Action,
  ruleId: string,
  ctx: AutomationCtx,
  lead: LeadWithRefs | null
): Promise<string> {
  const actorId = ctx.userId ?? lead?.assignedToId ?? null

  switch (action.type) {
    case 'SEND_WHATSAPP_TEMPLATE': {
      if (!ctx.leadId && !ctx.conversationId) return 'SEND_WHATSAPP_TEMPLATE skipped: no lead/conversation'
      const tpl = await db.whatsAppTemplate.findUnique({ where: { id: action.templateId } })
      if (!tpl) return `Template ${action.templateId} not found`
      if (tpl.status !== 'APPROVED' || !tpl.isActive) return `Template "${tpl.name}" not approved/active — skipped`
      let conversationId = ctx.conversationId ?? null
      if (!conversationId && ctx.phone) {
        const c = await ensureConversation(ctx.phone, { autoCreateLead: false })
        conversationId = c.conversation.id
      }
      if (!conversationId && ctx.leadId) {
        const conv = await db.whatsAppConversation.findFirst({ where: { leadId: ctx.leadId }, orderBy: { lastMessageAt: 'desc' } })
        conversationId = conv?.id ?? null
      }
      if (!conversationId) return 'No conversation for lead — skipped'
      const result = await sendWhatsappMessage({
        conversationId,
        type: 'TEMPLATE',
        templateId: action.templateId,
        templateParams: action.params ?? [],
        userId: actorId ?? 'system',
        leadId: ctx.leadId ?? null,
      })
      return result.ok ? `Template "${tpl.name}" sent (${result.providerMessageId ?? 'queued'})` : `Template send failed: ${result.error}`
    }
    case 'CREATE_TASK': {
      if (!ctx.leadId) return 'CREATE_TASK skipped: no lead'
      const leadRow = await db.lead.findUnique({ where: { id: ctx.leadId }, select: { assignedToId: true } })
      const due = new Date(Date.now() + (action.dueInHours ?? 2) * 3600 * 1000)
      await db.followUp.create({
        data: {
          leadId: ctx.leadId,
          assignedToId: action.assignedTo ?? leadRow?.assignedToId ?? actorId ?? undefined,
          dueAt: due,
          note: action.title,
          status: 'PENDING',
        },
      })
      return `Task created: ${action.title} (due ${due.toISOString()})`
    }
    case 'NOTIFY_AGENT': {
      if (lead?.assignedToId) {
        await notify(lead.assignedToId, `Automation: ${action.message}`, undefined, 'ALERT')
        await emitSocketEvent({
          room: `user:${lead.assignedToId}`,
          event: 'notification',
          data: { title: 'Automation', body: action.message, type: 'ALERT', ruleId },
        })
        return `Notified agent ${lead.assignedToId}`
      }
      return 'NOTIFY_AGENT skipped: no assigned agent'
    }
    case 'UPDATE_LEAD_FIELD': {
      if (!ctx.leadId) return 'UPDATE_LEAD_FIELD skipped: no lead'
      const allowed = ['priority', 'notes', 'customerType']
      if (!allowed.includes(action.field)) return `Field "${action.field}" not allowed`
      await db.lead.update({ where: { id: ctx.leadId }, data: { [action.field]: String(action.value) } })
      return `Lead ${action.field} updated`
    }
    default:
      return 'Unknown action'
  }
}


/** Manual "run now" for a rule (admin testing with a real lead). */
export async function runRuleManually(ruleId: string, leadId: string, userId: string): Promise<{ results: string[] }> {
  const rule = await db.automationRule.findUnique({ where: { id: ruleId } })
  if (!rule) throw new Error('Rule not found')
  const lead = (await db.lead.findUnique({
    where: { id: leadId },
    include: { source: { select: { label: true } }, assignedTo: { select: { id: true, name: true } } },
  })) as LeadWithRefs | null
  if (!lead) throw new Error('Lead not found')
  const actions = JSON.parse(rule.actions) as Action[]
  const results: string[] = []
  for (const action of actions) {
    results.push(await executeAction(action, rule.id, { leadId, userId }, lead))
  }
  await db.automationLog.create({
    data: { ruleId: rule.id, leadId, trigger: 'MANUAL', status: 'SUCCESS', detail: JSON.stringify({ actions: results }) },
  })
  await db.automationRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date(), runCount: { increment: 1 } } })
  return { results }
}
