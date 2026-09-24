import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, deptScope } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'
import { sendWhatsappMessage } from '@/lib/comm/whatsapp'

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
      lead: {
        select: {
          id: true,
          leadCode: true,
          customerName: true,
          department: true,
          mobile: true,
          whatsapp: true,
          optInStatus: true,
          waStatus: true,
          lastWaMessage: true,
          lastWaMessageAt: true,
          source: { select: { label: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!conv) throw new ApiError('Conversation not found', 404)
  return conv
}

function originOf(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') || 'http'
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  return `${proto}://${host}`
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

// ---------- POST /api/whatsapp/messages — REAL send via Alendei ----------

const SEND_TYPES = ['TEXT', 'TEMPLATE', 'IMAGE', 'PDF', 'VIDEO']

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{
    conversationId?: string
    type?: string
    body?: string
    mediaAssetId?: string
    templateId?: string
    templateParams?: unknown
  }>(req)
  const conversationId = str(body.conversationId)
  if (!conversationId) throw new ApiError('conversationId is required', 400)
  const conv = await loadConversation(conversationId)
  await ensureConversationAccess(user, conv)

  const type = (str(body.type) || 'TEXT').toUpperCase()
  if (!SEND_TYPES.includes(type)) throw new ApiError(`type must be one of ${SEND_TYPES.join(', ')}`, 400)
  if (type !== 'TEXT' && type !== 'TEMPLATE' && !str(body.mediaAssetId)) {
    throw new ApiError('mediaAssetId is required for media messages (upload via POST /api/files)', 400)
  }
  if (type === 'TEMPLATE' && !str(body.templateId)) {
    throw new ApiError('templateId is required for template messages', 400)
  }

  const templateParams = Array.isArray(body.templateParams)
    ? body.templateParams.map((p) => String(p ?? ''))
    : undefined

  let result
  try {
    result = await sendWhatsappMessage(
      {
        conversationId,
        type: type as 'TEXT' | 'TEMPLATE' | 'IMAGE' | 'PDF' | 'VIDEO',
        body: str(body.body),
        mediaAssetId: str(body.mediaAssetId),
        templateId: str(body.templateId),
        templateParams,
        userId: user.id,
        leadId: conv.leadId,
      },
      originOf(req)
    )
  } catch (e) {
    // Config/Policy guards throw ProviderError with a readable message
    if (e instanceof Error && 'readable' in e) {
      throw new ApiError((e as { readable: string }).readable, 422)
    }
    throw e
  }

  const message = await db.whatsAppMessage.findUnique({
    where: { id: result.messageId },
    include: { user: { select: { id: true, name: true } } },
  })

  if (!result.ok) {
    // Readable, user-safe error (technical detail is in ApiLog)
    throw new ApiError(result.error ?? 'WhatsApp message could not be sent', 422)
  }
  return ok({ message, requestId: result.requestId, providerMessageId: result.providerMessageId }, 201)
})

// ---------- PATCH /api/whatsapp/messages — mark read / assign owner ----------

export const PATCH = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ conversationId?: string; action?: string; ownerId?: string }>(req)
  const conversationId = str(body.conversationId)
  const action = str(body.action)
  if (!conversationId) throw new ApiError('conversationId is required', 400)
  const conv = await loadConversation(conversationId)
  await ensureConversationAccess(user, conv)

  if (action === 'mark_read') {
    await db.whatsAppConversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } })
    return ok({ success: true })
  }

  if (action === 'assign') {
    if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER'].includes(user.role)) {
      throw new ApiError('Only management can reassign conversations', 403)
    }
    const ownerId = str(body.ownerId)
    if (!ownerId) throw new ApiError('ownerId is required', 400)
    const owner = await db.user.findUnique({ where: { id: ownerId }, select: { id: true, isActive: true } })
    if (!owner || !owner.isActive) throw new ApiError('Target agent not found or inactive', 400)
    const updated = await db.whatsAppConversation.update({
      where: { id: conversationId },
      data: { ownerId },
      include: { owner: { select: { id: true, name: true } } },
    })
    return ok({ conversation: updated })
  }

  throw new ApiError("action must be 'mark_read' or 'assign'", 400)
})
