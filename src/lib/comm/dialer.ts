import { db } from '@/lib/db'
import { resolveCommConfig, markSipStatus } from './settings'
import { logApiCall, mapProviderError, networkError } from './api-logger'
import { normalizePhone } from './whatsapp'
import { emitSocketEvent } from './socket'

/**
 * SipService / DialerService — provider-agnostic click-to-call + call control.
 *
 * ARCHITECTURE (per requirements):
 *   CRM → Dialer/SIP service → Agent extension (SIP registration) → Customer number
 *
 * The CRM never places browser-side SIP calls directly. Instead it drives the
 * configured SIP provider's REST/HTTP interface:
 *   - `sip.click_to_call_url` : full URL template with placeholders
 *       {agent} {customer} {caller_id} {server} {extension}
 *     Example (generic SIP REST): https://pbx.example.com/api/click2call?ext={agent}&dst={customer}
 *   - `sip.call_action_url`   : URL template for in-call control
 *       {call_id} {action} {target}
 *     Example: https://pbx.example.com/api/call/{call_id}/{action}
 *
 * The complete call lifecycle (ringing/answered/hold/ended/missed/recording)
 * is received via POST /api/webhooks/voice and written to CallLog + timeline,
 * so ANY SIP provider that can send HTTP call events works without code changes.
 */

const PROVIDER = 'SIP'

export type SipStatusResult = {
  status: 'CONNECTED' | 'ERROR' | 'NOT_CONNECTED'
  detail: string
}

/**
 * TEST SIP — real diagnostics:
 * 1. Config completeness check (server/username/port).
 * 2. If a click-to-call URL is configured: probe reachability (HEAD/GET).
 *    A response of any kind proves the dialer endpoint is reachable.
 * SIP registration itself is verified by the provider hitting our voice
 * webhook during the next real call — the health dashboard shows the last
 * webhook received time for that.
 */
export async function testSipConnection(): Promise<SipStatusResult> {
  const cfg = await resolveCommConfig()
  const missing: string[] = []
  if (!cfg.sip.server) missing.push('SIP Server/Domain')
  if (!cfg.sip.username) missing.push('SIP Username')
  if (!cfg.sip.password && !process.env.SIP_PASSWORD) missing.push('SIP Password')
  if (missing.length > 0) {
    await markSipStatus('NOT_CONNECTED', `Missing: ${missing.join(', ')}`)
    return { status: 'NOT_CONNECTED', detail: `Configuration incomplete — missing: ${missing.join(', ')}.` }
  }

  if (cfg.sip.clickToCallUrl) {
    const url = renderTemplate(cfg.sip.clickToCallUrl, {
      agent: cfg.sip.extension || cfg.sip.username,
      customer: cfg.sip.callerId,
      caller_id: cfg.sip.callerId,
      server: cfg.sip.server,
      extension: cfg.sip.extension || cfg.sip.username,
      call_id: 'healthcheck',
      action: 'status',
      target: '',
    })
    const started = Date.now()
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: sipHeaders(cfg),
        signal: AbortSignal.timeout(15000),
      })
      await res.text().catch(() => '')
      const durationMs = Date.now() - started
      await logApiCall({ provider: PROVIDER, endpoint: redactUrl(url), method: 'GET', responseCode: res.status, durationMs, success: true })
      if (res.status >= 500) {
        await markSipStatus('ERROR', `Dialer endpoint returned HTTP ${res.status}`)
        return { status: 'ERROR', detail: `Dialer endpoint reachable but returned HTTP ${res.status}. Check provider status.` }
      }
      await markSipStatus('CONNECTED', `Dialer endpoint reachable (HTTP ${res.status}). Registration verified on next real call / voice webhook.`)
      return {
        status: 'CONNECTED',
        detail: `Dialer endpoint reachable (HTTP ${res.status}). SIP registration is confirmed by the provider via voice webhook on the next call.`,
      }
    } catch (e) {
      const err = networkError(e, 'SIP provider')
      await logApiCall({ provider: PROVIDER, endpoint: redactUrl(url), method: 'GET', durationMs: Date.now() - started, success: false, error: err })
      await markSipStatus('ERROR', err.readable)
      return { status: 'ERROR', detail: `${err.readable} (${url})` }
    }
  }

  await markSipStatus('NOT_CONNECTED', 'Configured; no dialer endpoint configured for automated test')
  return {
    status: 'NOT_CONNECTED',
    detail:
      'SIP credentials are configured, but no click-to-call endpoint URL is set, so the CRM cannot probe the provider. Configure "Click-to-Call API URL" to enable connection testing and outbound dialing.',
  }
}

function sipHeaders(cfg: Awaited<ReturnType<typeof resolveCommConfig>>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (cfg.sip.username && cfg.sip.password) {
    const basic = Buffer.from(`${cfg.sip.username}:${cfg.sip.password}`).toString('base64')
    headers.Authorization = `Basic ${basic}`
  }
  return headers
}

function redactUrl(url: string): string {
  return url.replace(/([?&](?:password|token|api_key|apikey)=)[^&]*/gi, '$1[REDACTED]')
}

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? vars[k] : `{${k}}`))
}

export type ClickToCallResult = {
  ok: boolean
  callId?: string
  error?: string
  detail?: string
}

/**
 * CLICK-TO-CALL: agent extension first, then the customer number.
 * Creates the CallLog (callStatus QUEUED) BEFORE dialing so the full
 * lifecycle from the voice webhook can be matched via providerCallId.
 */
export async function clickToCall(params: {
  leadId: string
  userId: string
  customerNumber?: string
  agentUserId?: string
}): Promise<ClickToCallResult> {
  const cfg = await resolveCommConfig()
  if (!cfg.sip.server) {
    return { ok: false, error: 'SIP/Dialer is not configured. Configure it in Settings → Communication → SIP / Dialer.' }
  }
  if (!cfg.sip.clickToCallUrl) {
    return { ok: false, error: 'No Click-to-Call API URL configured in Settings → Communication → SIP / Dialer.' }
  }

  const lead = await db.lead.findUnique({ where: { id: params.leadId } })
  if (!lead) return { ok: false, error: 'Lead not found.' }

  const agent = params.agentUserId
    ? await db.user.findUnique({ where: { id: params.agentUserId } })
    : await db.user.findUnique({ where: { id: params.userId } })

  const customer = normalizePhone(params.customerNumber || lead.whatsapp || lead.mobile)
  if (!customer) return { ok: false, error: 'Lead has no phone number.' }
  const agentExt = agent?.sipExtension || cfg.sip.extension || cfg.sip.username
  if (!agentExt) return { ok: false, error: 'No agent SIP extension configured. Set the agent extension in Settings → Users.' }

  const call = await db.callLog.create({
    data: {
      leadId: lead.id,
      userId: params.userId,
      direction: 'OUTGOING',
      status: 'NOT_CONNECTED',
      callStatus: 'QUEUED',
      customerNumber: `+${customer}`,
      agentNumber: agentExt,
      channel: 'SIP',
      startAt: new Date(),
    },
  })

  const url = renderTemplate(cfg.sip.clickToCallUrl, {
    agent: agentExt,
    customer,
    caller_id: normalizePhone(cfg.sip.callerId),
    server: cfg.sip.server,
    extension: agentExt,
    call_id: call.id,
    action: 'dial',
    target: customer,
  })

  const started = Date.now()
  try {
    const method = cfg.sip.clickToCallUrl.includes('{customer}') ? 'POST' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { ...sipHeaders(cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: agentExt,
        customer,
        caller_id: normalizePhone(cfg.sip.callerId),
        crm_call_id: call.id,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    const durationMs = Date.now() - started
    let data: Record<string, unknown> = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { raw: text }
    }
    const providerCallId = (data.call_id ?? data.callId ?? data.CallSid ?? data.uuid ?? data.id) as string | undefined
    if (res.ok) {
      await logApiCall({ provider: PROVIDER, endpoint: redactUrl(url), method, responseCode: res.status, durationMs, success: true, leadId: lead.id, userId: params.userId })
      await db.callLog.update({
        where: { id: call.id },
        data: { callStatus: 'RINGING', providerCallId: providerCallId ?? call.id },
      })
      await db.activity.create({
        data: {
          leadId: lead.id,
          userId: params.userId,
        type: 'CALL',
          title: 'Outbound call started via dialer',
          description: `Agent ext ${agentExt} → +${customer}`,
        },
      })
      await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, callStatus: 'RINGING', leadId: lead.id } })
      return { ok: true, callId: call.id, detail: 'Dialing… (call status updates in real time)' }
    }
    const perr = mapProviderError(res.status, text, 'Dialer')
    await logApiCall({ provider: PROVIDER, endpoint: redactUrl(url), method, responseCode: res.status, durationMs, success: false, error: perr, leadId: lead.id, userId: params.userId })
    await db.callLog.update({ where: { id: call.id }, data: { callStatus: 'FAILED', status: 'FAILED', endAt: new Date() } })
    return { ok: false, callId: call.id, error: perr.readable }
  } catch (e) {
    const err = networkError(e, 'Dialer')
    await logApiCall({ provider: PROVIDER, endpoint: redactUrl(url), method: 'POST', durationMs: Date.now() - started, success: false, error: err, leadId: lead.id, userId: params.userId })
    await db.callLog.update({ where: { id: call.id }, data: { callStatus: 'FAILED', status: 'FAILED', endAt: new Date() } })
    return { ok: false, callId: call.id, error: err.readable }
  }
}

export type CallAction = 'END' | 'MUTE' | 'UNMUTE' | 'HOLD' | 'UNHOLD' | 'TRANSFER'

/** In-call control via the configured call action URL template. */
export async function callCommand(params: {
  callId: string
  action: CallAction
  target?: string
  userId: string
}): Promise<ClickToCallResult> {
  const cfg = await resolveCommConfig()
  const call = await db.callLog.findUnique({ where: { id: params.callId } })
  if (!call) return { ok: false, error: 'Call not found.' }

  // Always update CRM state; provider command is best-effort with real error surfacing.
  const now = new Date()
  const patch: Record<string, unknown> = {}
  switch (params.action) {
    case 'HOLD': patch.callStatus = 'ON_HOLD'; break
    case 'UNHOLD': patch.callStatus = 'IN_PROGRESS'; break
    case 'END': {
      const duration = call.answerAt ? Math.round((now.getTime() - call.answerAt.getTime()) / 1000) : 0
      patch.callStatus = 'COMPLETED'
      patch.endAt = now
      patch.durationSec = duration
      patch.status = duration > 0 ? 'CONNECTED' : 'NOT_CONNECTED'
      break
    }
    case 'TRANSFER': patch.transferedTo = params.target ?? null; break
    default: break
  }

  let providerDetail = ''
  if (cfg.sip.callActionUrl) {
    const url = renderTemplate(cfg.sip.callActionUrl, {
      call_id: call.providerCallId ?? call.id,
      action: params.action.toLowerCase(),
      target: params.target ?? '',
    })
    const started = Date.now()
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...sipHeaders(cfg), 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: call.providerCallId ?? call.id, action: params.action.toLowerCase(), target: params.target }),
        signal: AbortSignal.timeout(15000),
      })
      const text = await res.text()
      await logApiCall({ provider: PROVIDER, endpoint: redactUrl(url), method: 'POST', responseCode: res.status, durationMs: Date.now() - started, success: res.ok, leadId: call.leadId, userId: params.userId })
      if (!res.ok) {
        const perr = mapProviderError(res.status, text, 'Dialer')
        providerDetail = ` (Provider: ${perr.readable})`
      }
    } catch (e) {
      const err = networkError(e, 'Dialer')
      await logApiCall({ provider: PROVIDER, endpoint: redactUrl(url), method: 'POST', durationMs: Date.now() - started, success: false, error: err, leadId: call.leadId, userId: params.userId })
      providerDetail = ` (Provider: ${err.readable})`
    }
  } else if (params.action !== 'END') {
    providerDetail = ' (No call action URL configured — CRM state updated only)'
  }

  const updated = await db.callLog.update({ where: { id: call.id }, data: patch })
  await emitSocketEvent({ room: 'call', event: 'call:update', data: { callId: call.id, callStatus: updated.callStatus, durationSec: updated.durationSec } })

  if (params.action === 'END' && call.leadId) {
    const m = Math.floor(updated.durationSec / 60), s = updated.durationSec % 60
    await db.activity.create({
      data: {
        leadId: call.leadId,
        userId: params.userId,
        type: 'CALL',
        title: `Call ended — ${updated.durationSec > 0 ? `${m > 0 ? `${m}m ${s}s` : `${s}s`}` : 'not connected'}`,
      },
    })
    await db.lead.update({ where: { id: call.leadId }, data: { lastContactAt: now } })
  }
  return { ok: true, callId: call.id, detail: `${params.action} applied${providerDetail}` }
}
