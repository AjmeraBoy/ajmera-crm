/** Client-side fetch helper for CRM API. Always relative paths, JSON, credentials included. */
export async function api<T = unknown>(
  path: string,
  opts?: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown }
): Promise<T> {
  const method = opts?.method || 'GET'
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' || opts?.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: 'no-store',
    credentials: 'same-origin',
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const message = (data as { error?: string })?.error || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data as T
}

/** Build a query string from params, skipping null/undefined/empty values */
export function qs(params: Record<string, string | number | boolean | null | undefined | Array<string | number>>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','))
    } else {
      sp.set(k, String(v))
    }
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Download any array of rows as CSV */
export function downloadCSV(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
