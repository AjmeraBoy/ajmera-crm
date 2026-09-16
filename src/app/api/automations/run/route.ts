import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'
import { runRuleManually } from '@/lib/comm/automation'

/** POST /api/automations/run {ruleId, leadId} — test a rule against a real lead. */
export const POST = route(async (req) => {
  const user = await requireUser(['SUPER_ADMIN', 'ADMIN', 'MANAGER'])
  const body = await readBody<{ ruleId?: string; leadId?: string }>(req)
  if (!body.ruleId || !body.leadId) throw new ApiError('ruleId and leadId are required', 400)
  const results = await runRuleManually(body.ruleId, body.leadId, user.id)
  await audit(user, 'AUTOMATION_RUN', 'AutomationRule', body.ruleId, { leadId: body.leadId })
  return ok({ results: results.results })
})
