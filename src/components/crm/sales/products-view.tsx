'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Loader2, MoreVertical, Package, Pencil, Plus, Power, RefreshCw, X } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/crm/shared/empty-state'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { PageHeader } from '@/components/crm/shared/page-header'
import { useMasters } from '@/components/crm/shared/use-masters'
import { useToast } from '@/hooks/use-toast'
import { api, downloadCSV, qs } from '@/lib/client'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

// ---------- types ----------

type ProductRow = {
  id: string
  code: string
  name: string
  categoryId: string | null
  category: { id: string; label: string } | null
  sku: string | null
  moq: number
  price: number
  description: string | null
  packagingDetails: string | null
  fabricDetails: string | null
  images: string[]
  video: string | null
  isActive: boolean
  createdAt: string
}

type ProductsResponse = { products: ProductRow[]; total: number }

const MANAGEMENT_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MANAGER']
const PAGE_SIZE = 24

// ---------- component ----------

export default function ProductsView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const masters = useMasters()
  const canManage = MANAGEMENT_ROLES.includes(user?.role ?? '')

  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [active, setActive] = useState('') // '' = all, '1' = active, '0' = inactive
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ProductsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<ProductRow | null>(null)
  const [deactivateProduct, setDeactivateProduct] = useState<ProductRow | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const [exporting, setExporting] = useState(false)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(t)
  }, [qInput])

  const buildParams = useCallback(
    (forExport = false) => ({
      q: q || undefined,
      categoryId: categoryId || undefined,
      active: active === '' ? undefined : active,
      ...(forExport ? { pageSize: 200 } : { page, pageSize: PAGE_SIZE }),
    }),
    [q, categoryId, active, page]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<ProductsResponse>(`/api/products${qs(buildParams())}`)
      setData(res)
    } catch (e) {
      toast({ title: 'Failed to load products', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [buildParams, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const categoryOptions = useMemo(
    () => masters.items('product_category').map((m) => ({ id: m.id, label: m.label })),
    [masters]
  )

  const openNew = () => {
    setEditProduct(null)
    setFormOpen(true)
  }

  const activate = async (p: ProductRow) => {
    try {
      await api('/api/products', { method: 'PATCH', body: { id: p.id, isActive: true } })
      toast({ title: 'Product activated', description: `${p.code} — ${p.name} is live again` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const confirmDeactivate = async () => {
    if (!deactivateProduct) return
    setDeactivating(true)
    try {
      await api(`/api/products${qs({ id: deactivateProduct.id })}`, { method: 'DELETE' })
      toast({ title: 'Product deactivated', description: `${deactivateProduct.code} removed from the active catalog` })
      setDeactivateProduct(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Deactivate failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setDeactivating(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await api<ProductsResponse>(`/api/products${qs(buildParams(true))}`)
      const rows = (res.products ?? []).map((p) => ({
        code: p.code,
        name: p.name,
        category: p.category?.label ?? '',
        sku: p.sku ?? '',
        price: p.price,
        moq: p.moq,
        active: p.isActive ? 'Yes' : 'No',
        description: p.description ?? '',
        packaging: p.packagingDetails ?? '',
        fabric: p.fabricDetails ?? '',
      }))
      downloadCSV(`products-${new Date().toISOString().slice(0, 10)}.csv`, rows)
      toast({ title: 'Export ready', description: `${rows.length} products exported to CSV` })
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  const products = data?.products ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const fromIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const toIdx = Math.min(total, page * PAGE_SIZE)

  return (
    <div>
      <PageHeader title="Products & Catalog" subtitle="Master catalog with pricing, MOQ, packaging and fabric details">
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} aria-label="Refresh products">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden />
          <span className="ml-1 hidden sm:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting} aria-label="Export products as CSV">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          <span className="ml-1">Export CSV</span>
        </Button>
        {canManage ? (
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={openNew}>
            <Plus className="h-4 w-4" aria-hidden />
            <span className="ml-1">Add Product</span>
          </Button>
        ) : null}
      </PageHeader>

      <FilterBar>
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search name, code, SKU…"
          className="h-9 w-full sm:w-56"
          aria-label="Search products"
        />
        <Select
          value={categoryId || 'all'}
          onValueChange={(v) => {
            setCategoryId(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[180px]" aria-label="Category filter">
            <SelectValue placeholder="Category: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Category: All</SelectItem>
            {categoryOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={active || 'all'}
          onValueChange={(v) => {
            setActive(v === 'all' ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-9 w-[150px]" aria-label="Catalog status filter">
            <SelectValue placeholder="Status: All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Active & Inactive</SelectItem>
            <SelectItem value="1">Active only</SelectItem>
            <SelectItem value="0">Inactive only</SelectItem>
          </SelectContent>
        </Select>
        {q || categoryId || active ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQInput('')
              setQ('')
              setCategoryId('')
              setActive('')
              setPage(1)
            }}
            aria-label="Reset filters"
          >
            <X className="h-4 w-4" aria-hidden /> Reset
          </Button>
        ) : null}
      </FilterBar>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
              <Skeleton className="h-36 w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products found"
          subtitle={q || categoryId || active ? 'Try changing the search or filters.' : 'Add your first product to start quoting and ordering.'}
          action={
            canManage ? (
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={openNew}>
                <Plus className="mr-1 h-4 w-4" aria-hidden /> Add Product
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              canManage={canManage}
              onEdit={() => {
                setEditProduct(p)
                setFormOpen(true)
              }}
              onDeactivate={() => setDeactivateProduct(p)}
              onActivate={() => activate(p)}
            />
          ))}
        </div>
      )}

      {/* pagination */}
      <div className="mt-4 flex flex-col items-center justify-between gap-2 sm:flex-row">
        <p className="text-xs text-stone-500">
          Showing {fromIdx}–{toIdx} of {total} products
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            Previous
          </Button>
          <span className="text-xs text-stone-600">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            Next
          </Button>
        </div>
      </div>

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editProduct} onSaved={() => setReloadKey((k) => k + 1)} />

      {/* deactivate confirmation */}
      <AlertDialog open={Boolean(deactivateProduct)} onOpenChange={(o) => { if (!o) setDeactivateProduct(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateProduct?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateProduct?.name} will be hidden from the active catalog and removed from quotation pickers. Existing quotations and orders keep their records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              disabled={deactivating}
              onClick={(e) => {
                e.preventDefault()
                confirmDeactivate()
              }}
            >
              {deactivating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- product card ----------

function ProductCard({
  product,
  canManage,
  onEdit,
  onDeactivate,
  onActivate,
}: {
  product: ProductRow
  canManage: boolean
  onEdit: () => void
  onDeactivate: () => void
  onActivate: () => void
}) {
  const image = product.images[0] ?? ''
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="relative h-36 w-full shrink-0 bg-stone-100">
        {image ? (
          <img
            src={image}
            alt={product.name}
            className="h-36 w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="flex h-36 w-full items-center justify-center" aria-hidden>
            <Package className="h-10 w-10 text-stone-300" />
          </div>
        )}
        <Badge className={cn('absolute left-2 top-2 border', product.isActive ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-stone-200 bg-stone-100 text-stone-500')}>
          {product.isActive ? 'Active' : 'Inactive'}
        </Badge>
        {canManage ? (
          <div className="absolute right-2 top-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-white/80 backdrop-blur" aria-label={`Actions for ${product.code}`}>
                  <MoreVertical className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" aria-hidden /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {product.isActive ? (
                  <DropdownMenuItem className="text-rose-600 focus:text-rose-700" onClick={onDeactivate}>
                    <Power className="mr-2 h-4 w-4" aria-hidden /> Deactivate
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={onActivate}>
                    <Power className="mr-2 h-4 w-4" aria-hidden /> Activate
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="line-clamp-1 text-sm font-semibold text-stone-800" title={product.name}>{product.name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-bold text-stone-500">{product.code}</span>
          {product.category ? (
            <Badge variant="outline" className="border-stone-200 text-[11px] font-medium text-stone-600">{product.category.label}</Badge>
          ) : null}
        </div>
        {product.sku ? <p className="text-xs text-stone-400">SKU: {product.sku}</p> : null}
        <div className="mt-auto flex items-end justify-between pt-2">
          <p className="text-base font-bold text-emerald-700">{formatINR(product.price)}</p>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[11px] font-medium text-amber-700">MOQ {product.moq}</Badge>
        </div>
      </div>
    </div>
  )
}

// ---------- create / edit dialog ----------

type ProductFormState = {
  name: string
  categoryId: string
  price: string
  moq: string
  sku: string
  description: string
  packagingDetails: string
  fabricDetails: string
  images: string
  video: string
}

const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: '',
  categoryId: '',
  price: '',
  moq: '1',
  sku: '',
  description: '',
  packagingDetails: '',
  fabricDetails: '',
  images: '',
  video: '',
}

function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  product: ProductRow | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const masters = useMasters()
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM)
  const [saving, setSaving] = useState(false)

  // (Re)initialise the form when the dialog opens (render-time state adjustment)
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setForm(
        product
          ? {
              name: product.name,
              categoryId: product.categoryId ?? '',
              price: String(product.price ?? ''),
              moq: String(product.moq ?? 1),
              sku: product.sku ?? '',
              description: product.description ?? '',
              packagingDetails: product.packagingDetails ?? '',
              fabricDetails: product.fabricDetails ?? '',
              images: product.images.join(', '),
              video: product.video ?? '',
            }
          : EMPTY_PRODUCT_FORM
      )
    }
  }

  const categoryOptions = useMemo(
    () => masters.items('product_category').map((m) => ({ id: m.id, label: m.label })),
    [masters]
  )

  const imageUrls = form.images.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)

  const setField = (name: keyof ProductFormState, value: string) => setForm((f) => ({ ...f, [name]: value }))

  const submit = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Product name is required', variant: 'destructive' })
      return
    }
    const price = Math.floor(Number(form.price))
    if (!form.price || Number.isNaN(price) || price <= 0) {
      toast({ title: 'Enter a valid price', description: 'Price must be a positive amount in ₹', variant: 'destructive' })
      return
    }
    const moq = Math.floor(Number(form.moq) || 0)
    if (moq < 1) {
      toast({ title: 'MOQ must be at least 1', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        categoryId: form.categoryId || undefined,
        price,
        moq,
        sku: form.sku.trim() || undefined,
        description: form.description.trim() || undefined,
        packagingDetails: form.packagingDetails.trim() || undefined,
        fabricDetails: form.fabricDetails.trim() || undefined,
        images: imageUrls,
        video: form.video.trim() || undefined,
      }
      if (product) {
        await api('/api/products', { method: 'PATCH', body: { id: product.id, ...body } })
        toast({ title: 'Product updated', description: `${product.code} — ${body.name} saved` })
      } else {
        const res = await api<{ product: ProductRow }>('/api/products', { method: 'POST', body })
        toast({ title: 'Product created', description: `${res.product.code} — ${body.name} added to catalog` })
      }
      setSaving(false)
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setSaving(false)
      toast({ title: product ? 'Update failed' : 'Create failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{product ? `Edit Product — ${product.code}` : 'Add Product'}</DialogTitle>
          <DialogDescription>
            Catalog items power quotations and orders. Fields marked * are required.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="prd-name">Product Name *</Label>
            <Input id="prd-name" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Bridal Lehenga — Royal Ruby" disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.categoryId || 'none'} onValueChange={(v) => setField('categoryId', v === 'none' ? '' : v)} disabled={saving}>
              <SelectTrigger aria-label="Product category"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No category —</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prd-price">Price (₹) *</Label>
            <Input id="prd-price" type="number" min={0} value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="e.g. 4500" disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prd-moq">Minimum Order Qty (MOQ) *</Label>
            <Input id="prd-moq" type="number" min={1} value={form.moq} onChange={(e) => setField('moq', e.target.value)} placeholder="e.g. 10" disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prd-sku">SKU</Label>
            <Input id="prd-sku" value={form.sku} onChange={(e) => setField('sku', e.target.value)} placeholder="Optional stock code" disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prd-video">Video URL</Label>
            <Input id="prd-video" value={form.video} onChange={(e) => setField('video', e.target.value)} placeholder="https://…" disabled={saving} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prd-images">Image URLs (comma separated)</Label>
            <Input
              id="prd-images"
              value={form.images}
              onChange={(e) => setField('images', e.target.value)}
              placeholder="https://cdn.example.com/img1.jpg, https://cdn.example.com/img2.jpg"
              disabled={saving}
            />
            {imageUrls.length ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {imageUrls.map((url, i) => (
                  <img
                    key={`${url}-${i}`}
                    src={url}
                    alt={`Product preview ${i + 1}`}
                    className="h-12 w-12 rounded-md border border-stone-200 object-cover"
                    onError={(e) => {
                      e.currentTarget.style.opacity = '0.3'
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prd-desc">Description</Label>
            <Textarea id="prd-desc" rows={2} value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="Short selling description" disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prd-pack">Packaging Details</Label>
            <Textarea id="prd-pack" rows={2} value={form.packagingDetails} onChange={(e) => setField('packagingDetails', e.target.value)} placeholder="e.g. 1 pc per polybag, 10 pcs per carton" disabled={saving} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prd-fabric">Fabric Details</Label>
            <Textarea id="prd-fabric" rows={2} value={form.fabricDetails} onChange={(e) => setField('fabricDetails', e.target.value)} placeholder="e.g. Georgette with sequence work" disabled={saving} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={saving} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            {product ? 'Save Changes' : 'Create Product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
