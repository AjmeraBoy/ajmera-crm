import { db } from '@/lib/db'
import { ok, route, requireUser, readBody, ApiError, assertDeptAccess, audit, MANAGEMENT_ROLES } from '@/lib/api'
import { nextCode, leadPrefix, pickExecutiveRoundRobin } from '@/lib/server-utils'

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

/** Same as server-utils.findMaster but without `mode: 'insensitive'` (unsupported by the SQLite connector) */
async function lookupMaster(type: string, label: string, dept?: string): Promise<{ id: string } | null> {
  return db.masterItem.findFirst({
    where: { type, label, isActive: true, ...(dept ? { dept: { in: [dept, 'ALL'] } } : {}) },
    select: { id: true },
  })
}

// ---------- POST /api/leads/bulk ----------

export const POST = route(async (req) => {
  const user = await requireUser([...MANAGEMENT_ROLES])
  const body = await readBody<{ department?: string; rows?: unknown }>(req)
  const department = str(body.department)
  if (!department || !['ONLINE', 'EXPORT'].includes(department)) {
    throw new ApiError('Valid department (ONLINE or EXPORT) is required', 400)
  }
  assertDeptAccess(user, department)
  const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : []
  if (rows.length === 0) throw new ApiError('rows array is required', 400)

  const stageId = (await lookupMaster('pipeline_stage', 'New Lead', department))?.id
  const skipped: { mobile?: string; reason: string }[] = []
  const seen = new Set<string>()
  let created = 0

  for (const row of rows) {
    const customerName = str(row.customerName)
    const mobile = str(row.mobile)
    if (!customerName) {
      skipped.push({ mobile, reason: 'Missing customer name' })
      continue
    }
    if (!mobile) {
      skipped.push({ mobile, reason: 'Missing mobile number' })
      continue
    }
    if (seen.has(mobile)) {
      skipped.push({ mobile, reason: 'Duplicate mobile in file' })
      continue
    }
    seen.add(mobile)
    const exists = await db.lead.findFirst({ where: { mobile, department }, select: { id: true } })
    if (exists) {
      skipped.push({ mobile, reason: 'Mobile already exists in CRM' })
      continue
    }

    const leadCode = await nextCode(leadPrefix(department), 'lead')
    const exec = await pickExecutiveRoundRobin(department)
    const lead = await db.lead.create({
      data: {
        leadCode,
        department,
        customerName,
        mobile,
        whatsapp: str(row.whatsapp) || (department === 'EXPORT' ? mobile : undefined),
        email: str(row.email),
        city: str(row.city),
        stateId: str(row.stateId),
        countryId: str(row.countryId),
        businessTypeId: str(row.businessTypeId),
        productInterest: str(row.productInterest),
        requirementNotes: str(row.requirementNotes),
        monthlyVolume: toInt(row.monthlyVolume),
        budget: toInt(row.budget),
        sourceId: str(row.sourceId),
        priority: str(row.priority),
        notes: str(row.notes),
        assignedToId: exec?.id,
        createdById: user.id,
        stageId,
      },
    })
    await db.activity.create({
      data: {
        leadId: lead.id,
        userId: user.id,
        type: 'LEAD',
        title: `Lead imported — ${lead.customerName}`,
        description: exec ? `Assigned to ${exec.name}` : 'Unassigned',
      },
    })
    created += 1
  }

  await audit(user, 'BULK_IMPORT', 'lead', undefined, { department, created, skippedCount: skipped.length })
  return ok({ created, skipped }, 201)
})
