import { readFile } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { fail, route } from '@/lib/api'
import { getSessionUser } from '@/lib/auth'
import { verifyAssetToken } from '@/lib/comm/whatsapp'

const UPLOAD_DIR = path.join(process.cwd(), 'uploads')

/**
 * GET /api/files/[id]?token= — stream an uploaded file.
 * Access: valid signed token (for provider fetches) OR an authenticated session.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const asset = await db.fileAsset.findUnique({ where: { id } })
    if (!asset) return fail('File not found', 404)

    const token = new URL(req.url).searchParams.get('token') ?? ''
    if (!verifyAssetToken(asset.id, token)) {
      const user = await getSessionUser()
      if (!user) return fail('Not authorized', 401)
    }

    const full = path.join(UPLOAD_DIR, path.basename(asset.path))
    const data = await readFile(full)
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': asset.mime,
        'Content-Length': String(data.length),
        'Content-Disposition': `inline; filename="${encodeURIComponent(asset.filename)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'ENOENT') {
      return fail('File missing on disk', 410)
    }
    console.error('[file-read-fail]', e)
    return fail('Could not read file', 500)
  }
}
