import { createHash } from 'crypto'

/** Deterministic password hash for the CRM (demo-grade, no external deps) */
export function hashPassword(password: string): string {
  return createHash('sha256').update(`ajmera-crm::${password}`).digest('hex')
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash
}
