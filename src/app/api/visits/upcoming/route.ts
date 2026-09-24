import { db } from '@/lib/db'
import { assertDeptAccess, ok, requireUser, route } from '@/lib/api'

export const GET = route(async (req) => {
  const user = await requireUser()
  const dept = new URL(req.url).searchParams.get('dept') || 'ONLINE'
  assertDeptAccess(user, dept)
  const startToday = new Date()
  startToday.setHours(0, 0, 0, 0)
  const leads = await db.lead.findMany({
    where: {
      department: dept,
      visitDate: { gte: startToday },
      ...(user.role === 'EXECUTIVE' ? { assignedToId: user.id } : {}),
    },
    select: {
      id: true,
      leadCode: true,
      customerName: true,
      visitDate: true,
      visitTime: true,
      mobile: true,
      assignedTo: { select: { name: true } },
    },
    orderBy: { visitDate: 'asc' },
    take: 100,
  })
  return ok({ leads })
})
