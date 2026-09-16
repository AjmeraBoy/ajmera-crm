import { db } from '@/lib/db'
import { normalizePhone } from './whatsapp'

/**
 * Conversation helpers shared by the send path and the webhook path.
 */

export type ConversationCtx = {
  conversation: {
    id: string
    phone: string
    leadId: string | null
    ownerId: string | null
    dept: string | null
    unreadCount: number
  }
  created: boolean
}

/** Find an existing conversation for a phone number (normalized digits match). */
export async function findConversationByPhone(phone: string) {
  const digits = normalizePhone(phone)
  if (!digits) return null
  // Exact normalized match first, then suffix match (country code differences)
  const all = await db.whatsAppConversation.findMany({
    where: { phone: { endsWith: digits.slice(-10) } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { lead: { select: { id: true } } },
  })
  return all.find((c) => normalizePhone(c.phone) === digits) ?? all[0] ?? null
}

/** Match a CRM lead by mobile/whatsapp number (normalized, last-10-digit aware). */
export async function findLeadByPhone(phone: string) {
  const digits = normalizePhone(phone)
  if (digits.length < 10) return null
  const suffix = digits.slice(-10)
  const leads = await db.lead.findMany({
    where: {
      OR: [{ mobile: { endsWith: suffix } }, { whatsapp: { endsWith: suffix } }],
    },
    include: { assignedTo: { select: { id: true, name: true, teamId: true } } },
    take: 5,
    orderBy: { createdAt: 'desc' },
  })
  return (
    leads.find((l) => normalizePhone(l.mobile) === digits || normalizePhone(l.whatsapp ?? '') === digits) ??
    leads[0] ??
    null
  )
}

/**
 * Ensure a conversation exists for the phone. If no lead is linked,
 * `autoCreateLead` creates a new lead (source: WhatsApp inbound) and assigns
 * it using the CRM's default assignment flow (round-robin inside the
 * WhatsApp team if available, else the first active ONLINE agent).
 */
export async function ensureConversation(
  phone: string,
  opts: { name?: string | null; dept?: string | null; autoCreateLead?: boolean; preferredOwnerId?: string | null } = {}
): Promise<ConversationCtx> {
  const digits = normalizePhone(phone)
  const existing = await findConversationByPhone(digits)
  if (existing) {
    // Keep name fresh
    if (opts.name && !existing.name) {
      await db.whatsAppConversation.update({ where: { id: existing.id }, data: { name: opts.name } })
    }
    return {
      conversation: {
        id: existing.id,
        phone: existing.phone,
        leadId: existing.leadId,
        ownerId: existing.ownerId,
        dept: existing.dept,
        unreadCount: existing.unreadCount,
      },
      created: false,
    }
  }

  // New conversation — find or create a lead
  let lead: { id: string; assignedToId: string | null; department: string } | null = await findLeadByPhone(digits)
  let ownerId = opts.preferredOwnerId ?? lead?.assignedToId ?? null
  let dept = opts.dept ?? lead?.department ?? null

  if (!lead && opts.autoCreateLead) {
    const assigned = await pickDefaultAgent()
    ownerId = ownerId ?? assigned?.id ?? null
    dept = dept ?? assigned?.department ?? 'ONLINE'
    const leadCode = await nextLeadCode()
    const source = await findOrCreateSource()
    const created = await db.lead.create({
      data: {
        leadCode,
        department: dept || 'ONLINE',
        customerName: opts.name || `WhatsApp ${digits.slice(-10)}`,
        mobile: digits.length > 10 ? `+${digits}` : `+91${digits}`,
        whatsapp: digits.length > 10 ? `+${digits}` : `+91${digits}`,
        sourceId: source?.id,
        assignedToId: ownerId,
        optInStatus: 'OPTED_IN',
        optInAt: new Date(),
        optInSource: 'INBOUND_MESSAGE',
        waStatus: 'AVAILABLE',
        requirementNotes: 'Auto-created from inbound WhatsApp message.',
      },
    })
    lead = created
    await db.activity.create({
      data: {
        leadId: created.id,
        type: 'SYSTEM',
        title: 'Lead auto-created from WhatsApp',
        description: `Inbound WhatsApp from +${digits}. Source: WhatsApp.`,
      },
    })
    ownerId = ownerId ?? assigned?.id ?? null
  }

  const conv = await db.whatsAppConversation.create({
    data: {
      phone: digits.length > 10 ? `+${digits}` : `+91${digits}`,
      name: opts.name ?? null,
      leadId: lead?.id ?? null,
      ownerId,
      dept,
    },
  })
  return {
    conversation: { id: conv.id, phone: conv.phone, leadId: conv.leadId, ownerId: conv.ownerId, dept: conv.dept, unreadCount: 0 },
    created: true,
  }
}

async function pickDefaultAgent() {
  const candidates = await db.user.findMany({
    where: { isActive: true, role: { in: ['EXECUTIVE', 'TEAM_LEADER'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, department: true },
  })
  if (candidates.length === 0) return null
  // Round-robin over active agents using a counter in Setting
  const key = 'comm.rr_counter'
  const row = await db.setting.findUnique({ where: { key } })
  const idx = (Number(row?.value ?? 0) + 1) % candidates.length
  await db.setting.upsert({ where: { key }, update: { value: String(idx) }, create: { key, value: String(idx) } })
  return candidates[idx]
}

async function nextLeadCode(): Promise<string> {
  const prefix = 'LEAD'
  const count = await db.lead.count()
  let n = count + 1
  for (let i = 0; i < 50; i++) {
    const code = `${prefix}-${String(n).padStart(6, '0')}`
    const exists = await db.lead.findUnique({ where: { leadCode: code } })
    if (!exists) return code
    n++
  }
  return `${prefix}-${Date.now()}`
}

async function findOrCreateSource() {
  const s = await db.masterItem.findFirst({ where: { type: 'lead_source', label: 'WhatsApp' } })
  if (s) return s
  return db.masterItem.create({ data: { type: 'lead_source', label: 'WhatsApp', dept: 'ALL' } })
}
