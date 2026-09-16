import { db } from '@/lib/db'
import { redactSecrets } from './crypto'

/**
 * Communication API logger.
 * Every outbound provider call is logged with sanitized details.
 * Secrets are ALWAYS redacted before persisting.
 */

export type ProviderErrorType =
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'SERVER'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UNKNOWN'

export class ProviderError extends Error {
  status?: number
  errorType: ProviderErrorType
  readable: string
  raw?: string

  constructor(errorType: ProviderErrorType, message: string, readable: string, status?: number, raw?: string) {
    super(message)
    this.errorType = errorType
    this.readable = readable
    this.status = status
    this.raw = raw
  }
}

/** Map HTTP status / fetch failure → readable CRM message (never raw API errors). */
export function mapProviderError(status: number | undefined, body: string, provider: string): ProviderError {
  const snippet = redactSecrets(String(body || '')).slice(0, 500)
  if (status === 401 || status === 403) {
    return new ProviderError(
      'AUTH',
      `HTTP ${status}: ${snippet}`,
      `${provider} authentication failed. Please contact the administrator.`,
      status,
      snippet
    )
  }
  if (status === 429) {
    return new ProviderError(
      'RATE_LIMIT',
      `HTTP 429: ${snippet}`,
      `${provider} rate limit reached. Please retry in a few minutes.`,
      status,
      snippet
    )
  }
  if (status === 400 || status === 422) {
    return new ProviderError(
      'VALIDATION',
      `HTTP ${status}: ${snippet}`,
      `${provider} rejected the request. Please verify campaign/template settings.`,
      status,
      snippet
    )
  }
  if (status === 404) {
    return new ProviderError(
      'NOT_FOUND',
      `HTTP 404: ${snippet}`,
      `${provider} endpoint not found. Please verify the API base URL configuration.`,
      status,
      snippet
    )
  }
  if (status !== undefined && status >= 500) {
    return new ProviderError(
      'SERVER',
      `HTTP ${status}: ${snippet}`,
      `${provider} is temporarily unavailable. The message will be retried automatically.`,
      status,
      snippet
    )
  }
  return new ProviderError(
    'UNKNOWN',
    snippet ? `HTTP ${status ?? 'n/a'}: ${snippet}` : 'Unknown provider error',
    `Could not reach ${provider}. Please check the communication settings.`,
    status,
    snippet
  )
}

export function networkError(e: unknown, provider: string): ProviderError {
  const msg = e instanceof Error ? e.message : String(e)
  const isTimeout = /timeout|abort/i.test(msg)
  return new ProviderError(
    isTimeout ? 'TIMEOUT' : 'NETWORK',
    msg,
    isTimeout
      ? `${provider} did not respond in time. Please try again.`
      : `Could not connect to ${provider}. Please check the network / API base URL.`,
    undefined,
    redactSecrets(msg).slice(0, 500)
  )
}

export async function logApiCall(entry: {
  provider: string
  endpoint: string
  method: string
  requestId?: string
  responseCode?: number
  durationMs?: number
  success: boolean
  error?: ProviderError | Error | null
  leadId?: string | null
  userId?: string | null
  attempt?: number
}) {
  try {
    const err = entry.error
    const errorType = err instanceof ProviderError ? err.errorType : err ? 'UNKNOWN' : null
    const errorMessage = err ? redactSecrets(String(err.message)).slice(0, 800) : null
    const readableError = err instanceof ProviderError ? err.readable : err ? 'Communication provider error. Please contact the administrator.' : null
    await db.apiLog.create({
      data: {
        provider: entry.provider,
        endpoint: entry.endpoint,
        method: entry.method,
        requestId: entry.requestId,
        responseCode: entry.responseCode,
        durationMs: entry.durationMs,
        success: entry.success,
        errorType: errorType ?? undefined,
        errorMessage: errorMessage ?? undefined,
        readableError: readableError ?? undefined,
        leadId: entry.leadId ?? undefined,
        userId: entry.userId ?? undefined,
        attempt: entry.attempt ?? 1,
      },
    })
  } catch (e) {
    console.error('[api-log-fail]', e)
  }
}
