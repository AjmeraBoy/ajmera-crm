import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, deptScope } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'

// ---------- local helpers ----------

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

async function teamUserIds(user: SessionUser): Promise<string[]> {
  if (!user.teamId) return [user.id]
  const members = await db.user.findMany({ where: { teamId: user.teamId }, select: { id: true } })
  return [...new Set([user.id, ...members.map((m) => m.id)])]
}

async function ensureConversationAccess(
  user: SessionUser,
  conv: { ownerId: string | null; dept: string | null }
) {
  if (user.role === 'EXECUTIVE') {
    if (conv.ownerId !== user.id) throw new ApiError('You can only view your own conversations', 403)
    return
  }
  if (user.role === 'TEAM_LEADER') {
    const ids = await teamUserIds(user)
    if (!conv.ownerId || !ids.includes(conv.ownerId)) {
      throw new ApiError('This conversation is outside your team', 403)
    }
    return
  }
  const scope = deptScope(user)
  if (scope && conv.dept && !scope.includes(conv.dept)) {
    throw new ApiError('This conversation belongs to another department', 403)
  }
}

async function loadConversation(conversationId: string) {
  const conv = await db.whatsAppConversation.findUnique({
    where: { id: conversationId },
    include: {
      owner: { select: { id: true, name: true } },
      lead: { select: { id: true, leadCode: true, customerName: true, department: true } },
    },
  })
  if (!conv) throw new ApiError('Conversation not found', 404)
  return conv
}

// ---------- GET /api/whatsapp/messages?conversationId=&page= ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const conversationId = sp.get('conversationId')
  if (!conversationId) throw new ApiError('conversationId is required', 400)
  const conv = await loadConversation(conversationId)
  await ensureConversationAccess(user, conv)

  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize')) || 100))
  const messages = await db.whatsAppMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { user: { select: { id: true, name: true } } },
  })

  // Mark as read when the owner views the conversation
  if (conv.ownerId === user.id && conv.unreadCount > 0) {
    await db.whatsAppConversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } })
    conv.unreadCount = 0
  }
  return ok({ messages, conversation: conv })
})

// ---------- POST /api/whatsapp/messages ----------

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ conversationId?: string; body?: string; type?: string; mediaName?: string; templateId?: string }>(req)
  const conversationId = str(body.conversationId)
  if (!conversationId) throw new ApiError('conversationId is required', 400)
  const conv = await loadConversation(conversationId)
  await ensureConversationAccess(user, conv)

  const templateId = str(body.templateId)
  let type = str(body.type) || 'TEXT'
  let text = str(body.body)
  if (templateId) {
    const template = await db.whatsAppTemplate.findUnique({ where: { id: templateId }, select: { id: true, body: true } })
    if (!template) throw new ApiError('Template not found', 400)
    if (!text) text = template.body
    if (!str(body.type)) type = 'TEMPLATE'
  }
  if (!text && !str(body.mediaName)) throw new ApiError('Message body, media or template is required', 400)

  const message = await db.whatsAppMessage.create({
    data: {
      conversationId,
      userId: user.id,
      direction: 'OUT',
      type,
      body: text,
      mediaName: str(body.mediaName),
      templateId,
      status: 'SENT',
    },
    include: { user: { select: { id: true, name: true } } },
  })
  await db.whatsAppConversation.update({
    where: { id: conversationId },
    data: { lastMessage: message.body ?? message.mediaName ?? null, lastMessageAt: new Date() },
  })

  if (conv.leadId) {
    const lead = await db.lead.findUnique({ where: { id: conv.leadId }, select: { id: true, isSticky: true } })
    const now = new Date()
    await db.lead.update({
      where: { id: conv.leadId },
      data: {
        lastContactAt: now,
        ...(user.role === 'EXECUTIVE' && lead && !lead.isSticky ? { isSticky: true, stickySince: now } : {}),
      },
    })
    await db.activity.create({
      data: {
        leadId: conv.leadId,
        userId: user.id,
        type: 'WHATSAPP',
        title: 'WhatsApp message sent',
        description: text ? text.slice(0, 160) : undefined,
      },
    })
  }
  return ok({ message }, 201)
})

// ---------- PATCH /api/whatsapp/messages ----------

export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ conversationId?: string; action?: string; body?: string }>(req)
  const conversationId = str(body.conversationId)
  const action = str(body.action)
  if (!conversationId) throw new ApiError('conversationId is required', 400)
  const conv = await loadConversation(conversationId)
  await ensureConversationAccess(user, conv)

  if (action === 'simulate_reply') {
    const text = str(body.body) || 'Okay, noted 👍'
    const message = await db.whatsAppMessage.create({
      data: { conversationId, direction: 'IN', type: 'TEXT', body: text, status: 'SENT' },
    })
    await db.whatsAppConversation.update({
      where: { id: conversationId },
      data: { unreadCount: { increment: 1 }, lastMessage: text, lastMessageAt: new Date() },
    })
    return ok({ message })
  }

  if (action === 'advance_status') {
    const last = await db.whatsAppMessage.findFirst({
      where: { conversationId, direction: 'OUT', status: { in: ['SENT', 'DELIVERED'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (!last) return ok({ updated: false })
    const nextStatus = last.status === 'SENT' ? 'DELIVERED' : 'READ'
    const message = await db.whatsAppMessage.update({ where: { id: last.id }, data: { status: nextStatus } })
    return ok({ updated: true, message })
  }

  throw new ApiError('action must be simulate_reply or advance_status', 400)
})
