import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { ApiError, ok, requireUser, route } from '@/lib/api'
import { signAssetToken } from '@/lib/comm/whatsapp'

/**
 * POST /api/files — multipart upload for WhatsApp media (image/pdf/video/audio).
 * Stored on disk under uploads/; served via GET /api/files/[id] with a signed
 * token (so Alendei can fetch the media without a CRM login).
 */

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')
const MAX_SIZE = 15 * 1024 * 1024 // 15MB

const ALLOWED = [/^image\//, /^application\/pdf$/, /^video\/mp4$/, /^video\/webm$/, /^audio\//]

function safeExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '')
  return ext && ext.length <= 10 ? ext : ''
}

export const POST = route(async (req) => {
  const user = await requireUser()
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    throw new ApiError('multipart/form-data body required', 400)
  }
  const file = form.get('file')
  if (!(file instanceof File)) throw new ApiError("'file' field is required", 400)
  if (file.size > MAX_SIZE) throw new ApiError('File exceeds the 15MB limit', 413)
  if (!ALLOWED.some((re) => re.test(file.type))) {
    throw new ApiError(`Unsupported media type: ${file.type || 'unknown'}`, 415)
  }

  await mkdir(UPLOAD_DIR, { recursive: true })
  const ext = safeExt(file.name)
  const diskName = `${randomUUID()}${ext}`
  const bytes = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(UPLOAD_DIR, diskName), bytes)

  const asset = await db.fileAsset.create({
    data: {
      filename: file.name.slice(0, 200),
      mime: file.type,
      size: file.size,
      path: diskName,
      kind: 'WHATSAPP_MEDIA',
      createdById: user.id,
    },
  })
  const token = signAssetToken(asset.id)
  const url = `/api/files/${asset.id}?token=${token}`
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  return ok({
    id: asset.id,
    filename: asset.filename,
    mime: asset.mime,
    size: asset.size,
    url,
    absoluteUrl: base ? `${base}${url}` : null,
  }, 201)
})
