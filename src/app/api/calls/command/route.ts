import { ApiError, ok, readBody, requireUser, route } from '@/lib/api'
import { callCommand } from '@/lib/comm/dialer'

const ACTIONS = ['END', 'MUTE', 'UNMUTE', 'HOLD', 'UNHOLD', 'TRANSFER'] as const

/**
 * POST /api/calls/command {callId, action, target?}
 * In-call control: END / MUTE / UNMUTE / HOLD / UNHOLD / TRANSFER.
 */
export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ callId?: string; action?: string; target?: string }>(req)
  if (!body.callId) throw new ApiError('callId is required', 400)
  const action = (body.action ?? '').toUpperCase()
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    throw new ApiError(`action must be one of ${ACTIONS.join(', ')}`, 400)
  }
  if (action === 'TRANSFER' && !body.target) {
    throw new ApiError('target (agent extension or number) is required for TRANSFER', 400)
  }
  const result = await callCommand({
    callId: body.callId,
    action: action as 'END' | 'MUTE' | 'UNMUTE' | 'HOLD' | 'UNHOLD' | 'TRANSFER',
    target: body.target,
    userId: user.id,
  })
  if (!result.ok) throw new ApiError(result.error ?? 'Call command failed', 422)
  return ok({ ok: true, callId: result.callId, detail: result.detail })
})
