import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * AES-256-GCM encryption for communication credentials (API keys, SIP passwords).
 * - Secrets are NEVER stored in plaintext in the database.
 * - The master key comes from CONFIG_ENCRYPTION_KEY env (falls back to a derived
 *   key from DATABASE_URL — for local/dev only; production MUST set CONFIG_ENCRYPTION_KEY).
 * - Format: v1:<iv_b64>:<tag_b64>:<cipher_b64>
 */

const FALLBACK_SALT = 'af-crm-comm-v1'

function masterKey(): Buffer {
  const secret = process.env.CONFIG_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || ''
  if (secret.length >= 16) {
    return createHash('sha256').update(`${secret}:${FALLBACK_SALT}`).digest()
  }
  // Dev fallback (NOT for production) — derived from database URL so it at least
  // differs per environment and never appears in source code.
  const envSecret = process.env.DATABASE_URL || 'local-dev'
  console.warn('[comm-crypto] CONFIG_ENCRYPTION_KEY not set — using derived dev key. Set it in production!')
  return createHash('sha256').update(`${envSecret}:${FALLBACK_SALT}`).digest()
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return ''
  try {
    const parts = stored.split(':')
    if (parts.length !== 4 || parts[0] !== 'v1') return ''
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const data = Buffer.from(parts[3], 'base64')
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

/** Never expose a full credential: show only a hint like "••••••••ab12" */
export function maskSecret(plaintext: string): string {
  if (!plaintext) return ''
  const tail = plaintext.slice(-4)
  return '••••••••' + tail
}

/** Redact secrets from any object/string before logging */
export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  const envKeys = ['WHATSAPP_API_KEY', 'SIP_PASSWORD', 'CONFIG_ENCRYPTION_KEY']
  for (const k of envKeys) {
    const v = process.env[k]
    if (v && v.length > 3) out = out.split(v).join('[REDACTED]')
  }
  // Redact common JSON credential fields
  out = out
    .replace(/("apiKey"\s*:\s*")([^"]*)(")/gi, '$1[REDACTED]$3')
    .replace(/("api_key"\s*:\s*")([^"]*)(")/gi, '$1[REDACTED]$3')
    .replace(/("password"\s*:\s*")([^"]*)(")/gi, '$1[REDACTED]$3')
    .replace(/("authorization"\s*:\s*")([^"]*)(")/gi, '$1[REDACTED]$3')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/g, '$1[REDACTED]')
  return out
}
