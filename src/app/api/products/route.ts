import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { ApiError, audit, ok, readBody, requireUser, route } from '@/lib/api'
import { nextCode } from '@/lib/server-utils'

const PRODUCT_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MANAGER']

type ProductBody = {
  id?: string
  name?: string
  categoryId?: string | null
  sku?: string | null
  moq?: number
  price?: number
  description?: string | null
  packagingDetails?: string | null
  fabricDetails?: string | null
  images?: string[]
  video?: string | null
  isActive?: boolean
}

const PRODUCT_INCLUDE = {
  category: { select: { id: true, label: true } },
} satisfies Prisma.ProductInclude

/** DB stores images as JSON string — expose as string[] */
function parseImages(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : []
  } catch {
    return []
  }
}

async function assertCategory(categoryId: string) {
  const cat = await db.masterItem.findUnique({ where: { id: categoryId }, select: { id: true } })
  if (!cat) throw new ApiError('Invalid categoryId', 400)
}

// GET /api/products?q=&categoryId=&active=&page=&pageSize=
export const GET = route(async (req) => {
  await requireUser()
  const sp = new URL(req.url).searchParams
  const q = sp.get('q')?.trim()
  const categoryId = sp.get('categoryId') || undefined
  const active = sp.get('active')
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1))
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(sp.get('pageSize')) || 50)))
  const where = {
    ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }, { sku: { contains: q } }] } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(active !== null && active !== '' ? { isActive: active === '1' || active.toLowerCase() === 'true' } : {}),
  }
  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      include: PRODUCT_INCLUDE,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.product.count({ where }),
  ])
  return ok({ products: rows.map((p) => ({ ...p, images: parseImages(p.images) })), total })
})

// POST /api/products (ADMIN, SUPER_ADMIN, MANAGER)
export const POST = route(async (req) => {
  const user = await requireUser(PRODUCT_ROLES)
  const body = await readBody<ProductBody>(req)
  if (!body.name || !body.name.trim()) throw new ApiError('Product name is required', 400)
  if (body.categoryId) await assertCategory(body.categoryId)
  const price = Math.max(0, Math.floor(Number(body.price) || 0))
  const moq = Math.max(1, Math.floor(Number(body.moq) || 1))
  const code = await nextCode('PRD', 'product')
  const product = await db.product.create({
    data: {
      code,
      name: body.name.trim(),
      categoryId: body.categoryId || null,
      sku: body.sku ?? null,
      moq,
      price,
      description: body.description ?? null,
      packagingDetails: body.packagingDetails ?? null,
      fabricDetails: body.fabricDetails ?? null,
      images: Array.isArray(body.images) ? JSON.stringify(body.images) : null,
      video: body.video ?? null,
    },
    include: PRODUCT_INCLUDE,
  })
  await audit(user, 'CREATE', 'product', product.id, { code, name: product.name, price })
  return ok({ product: { ...product, images: parseImages(product.images) } }, 201)
})

// PATCH /api/products {id, ...fields}
export const PATCH = route(async (req) => {
  const user = await requireUser(PRODUCT_ROLES)
  const body = await readBody<ProductBody>(req)
  if (!body.id) throw new ApiError('id is required', 400)
  const existing = await db.product.findUnique({ where: { id: body.id } })
  if (!existing) throw new ApiError('Product not found', 404)
  if (body.categoryId) await assertCategory(body.categoryId)
  const data: Prisma.ProductUpdateInput = {}
  if (body.name !== undefined) data.name = body.name.trim()
  if (body.categoryId !== undefined) data.category = body.categoryId ? { connect: { id: body.categoryId } } : { disconnect: true }
  if (body.sku !== undefined) data.sku = body.sku
  if (body.moq !== undefined) data.moq = Math.max(1, Math.floor(Number(body.moq) || 1))
  if (body.price !== undefined) data.price = Math.max(0, Math.floor(Number(body.price) || 0))
  if (body.description !== undefined) data.description = body.description
  if (body.packagingDetails !== undefined) data.packagingDetails = body.packagingDetails
  if (body.fabricDetails !== undefined) data.fabricDetails = body.fabricDetails
  if (body.images !== undefined) data.images = JSON.stringify(Array.isArray(body.images) ? body.images : [])
  if (body.video !== undefined) data.video = body.video
  if (body.isActive !== undefined) data.isActive = !!body.isActive
  const product = await db.product.update({ where: { id: existing.id }, data, include: PRODUCT_INCLUDE })
  await audit(user, 'UPDATE', 'product', product.id, data)
  return ok({ product: { ...product, images: parseImages(product.images) } })
})

// DELETE /api/products?id= (soft delete)
export const DELETE = route(async (req) => {
  const user = await requireUser(PRODUCT_ROLES)
  const id = new URL(req.url).searchParams.get('id')
  if (!id) throw new ApiError('id is required', 400)
  const existing = await db.product.findUnique({ where: { id } })
  if (!existing) throw new ApiError('Product not found', 404)
  await db.product.update({ where: { id }, data: { isActive: false } })
  await audit(user, 'DELETE', 'product', id, { code: existing.code })
  return ok({ success: true })
})
