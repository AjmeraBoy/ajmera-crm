import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, deptScope, assertDeptAccess, audit } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'

// ---------- local helpers ----------

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : undefined
}

function toDate(v: unknown): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const d = v instanceof Date ? v : new Date(String(v))
  return isNaN(d.getTime()) ? undefined : d
}

async function teamUserIds(user: SessionUser): Promise<string[]> {
  if (!user.teamId) return [user.id]
  const members = await db.user.findMany({ where: { teamId: user.teamId }, select: { id: true } })
  return [...new Set([user.id, ...members.map((m) => m.id)])]
}

const documentInclude = {
  lead: { select: { id: true, leadCode: true, customerName: true } },
  uploadedBy: { select: { id: true, name: true } },
} satisfies Prisma.DocumentInclude

// ---------- GET /api/documents?leadId=&type=&q= ----------

export const GET = route(async (req) => {
  const user = await requireUser()
  const sp = new URL(req.url).searchParams
  const and: Prisma.DocumentWhereInput[] = []
  if (user.role === 'EXECUTIVE') {
    and.push({ OR: [{ uploadedById: user.id }, { lead: { assignedToId: user.id } }] })
  } else if (user.role === 'TEAM_LEADER') {
    const ids = await teamUserIds(user)
    and.push({ OR: [{ uploadedById: { in: ids } }, { lead: { assignedToId: { in: ids } } }] })
  } else {
    const scope = deptScope(user)
    if (scope) and.push({ lead: { department: { in: scope } } })
  }
  const leadId = sp.get('leadId')
  if (leadId) and.push({ leadId })
  const type = sp.get('type')
  if (type) and.push({ type })
  const q = sp.get('q')
  if (q) and.push({ name: { contains: q } })

  const documents = await db.document.findMany({
    where: and.length ? { AND: and } : {},
    orderBy: { createdAt: 'desc' },
    include: documentInclude,
  })
  return ok({ documents })
})

// ---------- POST /api/documents ----------

export const POST = route(async (req) => {
  const user = await requireUser()
  const body = await readBody<{ leadId?: string; name?: string; type?: string; url?: string; expiryDate?: string; version?: number }>(req)
  const name = str(body.name)
  if (!name) throw new ApiError('Document name is required', 400)
  const leadId = str(body.leadId)
  if (leadId) {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: { id: true, department: true, assignedToId: true },
    })
    if (!lead) throw new ApiError('Lead not found', 404)
    if (user.role === 'EXECUTIVE' && lead.assignedToId !== user.id) {
      throw new ApiError('You can only upload documents on your own leads', 403)
    }
    assertDeptAccess(user, lead.department)
  }

  const document = await db.document.create({
    data: {
      leadId,
      name,
      type: str(body.type) || 'OTHER',
      url: str(body.url),
      expiryDate: toDate(body.expiryDate),
      version: toInt(body.version) ?? 1,
      uploadedById: user.id,
    },
    include: documentInclude,
  })

  if (leadId) {
    await db.activity.create({
      data: { leadId, userId: user.id, type: 'DOCUMENT', title: `Document uploaded — ${name}`, description: str(body.url) },
    })
  }
  await audit(user, 'CREATE', 'document', document.id, { name, leadId })
  return ok({ document }, 201)
})

// ---------- DELETE /api/documents?id= ----------

export const DELETE = route(async (req) => {
  const user = await requireUser()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) throw new ApiError('Document id is required', 400)
  const doc = await db.document.findUnique({
    where: { id },
    include: { lead: { select: { department: true } } },
  })
  if (!doc) throw new ApiError('Document not found', 404)

  const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'
  const isUploader = doc.uploadedById === user.id
  if (!isAdmin && !isUploader) {
    if (!['MANAGER', 'TEAM_LEADER'].includes(user.role)) {
      throw new ApiError('You cannot delete this document', 403)
    }
    assertDeptAccess(user, doc.lead?.department)
  }

  await db.document.delete({ where: { id } })
  await audit(user, 'DELETE', 'document', id, { name: doc.name })
  return ok({ success: true })
})
