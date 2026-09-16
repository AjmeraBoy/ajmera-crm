import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, deptScope } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'

// ---------- local helpers ----------

async function teamUserIds(user: SessionUser): Promise<string[]> {
  if (!user.teamId) return [user.id]
  const members = await db.user.findMany({ where: { teamId: user.teamId }, select: { id: true } })
  return [...new Set([user.id, ...members.map((m) => m.id)])]
}

async function convWhere(user: SessionUser, sp: URLSearchParams): Promise<Prisma.WhatsAppConversationWhereInput> {
  const where: Prisma.WhatsAppConversationWhereInput = {}
  if (user.role === 'EXECUTIVE') where.ownerId = user.id
  else if (user.role === 'TEAM_LEADER') where.ownerId = { in: await teamUserIds(user) }
  const scope = deptScope(user)
  const dept = sp.get('dept') || undefined
  if (scope || dept) {
    const df: Prisma.StringNullableFilter = {}
    if (scope) df.in = scope
    if (dept) df.equals = dept
    where.dept = df
  }
  const q = sp.get('q')
  if (q) {
    where.OR = [
      { phone: { contains: q } },
      { name: { contains: q } },
      { lead: { customerName: { contains: q } } },
    ]
  }
  const label = sp.get('label')
  if (label) where.label = label
  return where
}

// ---------- GET /api/whatsapp/conversations ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const where = await convWhere(user, sp)
  const conversations = await db.whatsAppConversation.findMany({
    where,
    orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    take: 1000,
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
  return ok({ conversations })
})
