'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Loader2, MapPin, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'
import { DEPARTMENTS, DEPT_LABELS, PRIORITIES } from '@/lib/constants'
import { useMasters } from '@/components/crm/shared/use-masters'
import { useAppStore } from '@/store/app-store'

// ---------- shared types & searchable select (reused by followups-view) ----------

export interface MasterOption {
  id: string
  label: string
}

export interface LeadEditInput {
  id: string
  leadCode?: string | null
  department: string
  customerName: string
  companyName: string | null
  mobile: string
  whatsapp: string | null
  email: string | null
  city: string | null
  stateId: string | null
  countryId: string | null
  businessTypeId: string | null
  productInterest: string | null
  requirementNotes: string | null
  monthlyVolume: number | null
  budget: number | null
  sourceId: string | null
  visitDate: string | null
  visitTime: string | null
  priority: string | null
  notes: string | null
  stageId: string | null
  disposition?: { id: string; label: string } | null
  subDisposition?: { id: string; label: string } | null
}

/** Popover + Command based searchable select — scales fine for 60 countries / 37 states */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches found',
  disabled,
  className,
  ariaLabel,
}: {
  value: string
  onChange: (id: string) => void
  options: MasterOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.id === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className={cn('h-9 w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate', !selected && 'text-stone-400')}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandEmpty>{emptyText}</CommandEmpty>
          <CommandGroup className="max-h-56 overflow-y-auto">
            {options.map((o) => (
              <CommandItem
                key={o.id}
                value={o.label}
                onSelect={() => {
                  onChange(o.id)
                  setOpen(false)
                }}
              >
                <Check className={cn('mr-2 h-4 w-4', value === o.id ? 'opacity-100' : 'opacity-0')} aria-hidden />
                {o.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------- form ----------

interface FormState {
  department: string
  customerName: string
  mobile: string
  companyName: string
  email: string
  city: string
  whatsapp: string
  stateId: string
  countryId: string
  businessTypeId: string
  productInterest: string
  requirementNotes: string
  monthlyVolume: string
  budget: string
  sourceId: string
  visitDate: string
  visitTime: string
  priority: string
  notes: string
  stageId: string
  campaignId: string
}

interface DuplicateInfo {
  id: string
  leadCode: string
  customerName: string
}

interface CampaignLite {
  id: string
  name: string
}

function emptyForm(department: string, stageId: string): FormState {
  return {
    department,
    customerName: '',
    mobile: '',
    companyName: '',
    email: '',
    city: '',
    whatsapp: '',
    stateId: '',
    countryId: '',
    businessTypeId: '',
    productInterest: '',
    requirementNotes: '',
    monthlyVolume: '',
    budget: '',
    sourceId: '',
    visitDate: '',
    visitTime: '',
    priority: 'MEDIUM',
    notes: '',
    stageId,
    campaignId: '',
  }
}

export default function LeadFormDialog({ open, onOpenChange, lead, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lead?: LeadEditInput | null
  onSaved: () => void
}) {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()
  const isManagement = ['TEAM_LEADER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(user?.role ?? '')
  const isExecutive = user?.role === 'EXECUTIVE'
  const canPickDepartment = !isExecutive && !lead // locked while editing (API does not move departments)

  const lockedDepartment = lead?.department ?? user?.department ?? ''
  const [form, setForm] = useState<FormState>(() => emptyForm(lockedDepartment || 'ONLINE', ''))
  const [saving, setSaving] = useState(false)
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])

  const department = lead ? lead.department : form.department
  const isExport = department === 'EXPORT'

  const stateOptions = useMemo<MasterOption[]>(
    () => masters.items('state').map((m) => ({ id: m.id, label: m.label })),
    [masters]
  )
  const countryOptions = useMemo<MasterOption[]>(
    () => masters.items('country').map((m) => ({ id: m.id, label: m.label })),
    [masters]
  )
  const sourceOptions = useMemo<MasterOption[]>(
    () => masters.items('lead_source', department || undefined).map((m) => ({ id: m.id, label: m.label })),
    [masters, department]
  )
  const stageOptions = useMemo<MasterOption[]>(
    () => masters.items('pipeline_stage', department || undefined).map((m) => ({ id: m.id, label: m.label })),
    [masters, department]
  )
  const businessOptions = useMemo<MasterOption[]>(
    () => masters.items('business_type').map((m) => ({ id: m.id, label: m.label })),
    [masters]
  )
  const defaultStageId = useMemo(
    () => stageOptions.find((s) => s.label.toLowerCase() === 'new lead')?.id ?? '',
    [stageOptions]
  )

  // (re)initialise form when dialog opens
  useEffect(() => {
    if (!open) return
    setDuplicate(null)
    if (lead) {
      setForm({
        department: lead.department,
        customerName: lead.customerName,
        mobile: lead.mobile,
        companyName: lead.companyName ?? '',
        email: lead.email ?? '',
        city: lead.city ?? '',
        whatsapp: lead.whatsapp ?? '',
        stateId: lead.stateId ?? '',
        countryId: lead.countryId ?? '',
        businessTypeId: lead.businessTypeId ?? '',
        productInterest: lead.productInterest ?? '',
        requirementNotes: lead.requirementNotes ?? '',
        monthlyVolume: lead.monthlyVolume != null ? String(lead.monthlyVolume) : '',
        budget: lead.budget != null ? String(lead.budget) : '',
        sourceId: lead.sourceId ?? '',
        visitDate: lead.visitDate ? String(lead.visitDate).slice(0, 10) : '',
        visitTime: lead.visitTime ?? '',
        priority: lead.priority ?? 'MEDIUM',
        notes: lead.notes ?? '',
        stageId: lead.stageId ?? '',
        campaignId: '',
      })
    } else {
      const dept = lockedDepartment || 'ONLINE'
      setForm(emptyForm(dept, ''))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.id])

  // default the stage once masters are available (create mode)
  useEffect(() => {
    if (!open || lead) return
    setForm((f) => (f.stageId ? f : { ...f, stageId: defaultStageId }))
  }, [open, lead, defaultStageId])

  // campaigns for management create
  useEffect(() => {
    if (!open || !isManagement || lead) return
    let cancelled = false
    api<{ campaigns: CampaignLite[] }>(`/api/campaigns${form.department ? `?dept=${form.department}` : ''}`)
      .then((res) => {
        if (!cancelled) setCampaigns(res.campaigns ?? [])
      })
      .catch(() => {
        /* campaigns are optional */
      })
    return () => {
      cancelled = true
    }
  }, [open, isManagement, lead, form.department])

  const setField = useCallback((name: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [name]: value }))
  }, [])

  const onDepartmentChange = (dept: string) => {
    const newStage = masters
      .items('pipeline_stage', dept)
      .find((s) => s.label.toLowerCase() === 'new lead')?.id
    setForm((f) => ({
      ...f,
      department: dept,
      stateId: '',
      countryId: '',
      sourceId: '',
      stageId: newStage ?? '',
    }))
  }

  const onMobileChange = (value: string) => {
    setForm((f) => ({
      ...f,
      mobile: value,
      // EXPORT rule: auto-fill whatsapp from mobile only while whatsapp is still empty (editable afterwards)
      whatsapp: f.department === 'EXPORT' && !f.whatsapp ? value : f.whatsapp,
    }))
  }

  const selectedSourceLabel = sourceOptions.find((s) => s.id === form.sourceId)?.label ?? ''
  const isVisitSource = selectedSourceLabel.toLowerCase().includes('visit')

  const validate = (): string | null => {
    if (!form.customerName.trim()) return 'Customer name is required'
    if (!form.mobile.trim()) return 'Mobile number is required'
    if (!form.sourceId) return 'Lead source is required'
    if (isExport && !form.countryId) return 'Country is required for Export leads'
    if (!isExport && !form.stateId) return 'State is required for Online leads'
    if (isVisitSource && (!form.visitDate || !form.visitTime)) return 'Visit date & time are required for Visit source'
    return null
  }

  const buildPayload = (allowDuplicate: boolean): Record<string, unknown> => {
    const num = (v: string) => (v.trim() === '' ? undefined : Math.round(Number(v)))
    return {
      department: form.department,
      customerName: form.customerName.trim(),
      mobile: form.mobile.trim(),
      companyName: form.companyName.trim() || undefined,
      // ONLINE: country is fixed to India by the system — never send countryId
      countryId: isExport ? form.countryId || undefined : undefined,
      stateId: isExport ? undefined : form.stateId || undefined,
      whatsapp: isExport
        ? form.whatsapp.trim() || undefined // server defaults whatsapp = mobile for EXPORT
        : form.whatsapp.trim() || undefined,
      email: form.email.trim() || undefined,
      city: form.city.trim() || undefined,
      businessTypeId: form.businessTypeId || undefined,
      productInterest: form.productInterest.trim() || undefined,
      requirementNotes: form.requirementNotes.trim() || undefined,
      monthlyVolume: num(form.monthlyVolume),
      budget: num(form.budget),
      sourceId: form.sourceId,
      visitDate: form.visitDate || undefined,
      visitTime: form.visitTime || undefined,
      priority: form.priority || undefined,
      notes: form.notes.trim() || undefined,
      stageId: form.stageId || undefined,
      campaignId: form.campaignId || undefined,
      ...(allowDuplicate ? { allowDuplicate: true } : {}),
    }
  }

  const submit = async (allowDuplicate = false) => {
    const err = validate()
    if (err) {
      toast({ title: 'Missing information', description: err, variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      if (lead) {
        await api('/api/leads', { method: 'PATCH', body: { id: lead.id, ...buildPayload(false) } })
        toast({ title: 'Lead updated', description: `${lead.customerName} saved successfully` })
      } else {
        // raw fetch so a 409 duplicate body ({existing}) is not swallowed by api()
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(buildPayload(allowDuplicate)),
        })
        const data: unknown = await res.json().catch(() => null)
        if (res.status === 409 && data && typeof data === 'object' && 'existing' in data) {
          const ex = (data as { existing?: DuplicateInfo }).existing
          if (ex) {
            setDuplicate(ex)
            setSaving(false)
            return
          }
        }
        if (!res.ok) {
          const message =
            data && typeof data === 'object' && 'error' in data
              ? String((data as { error?: unknown }).error)
              : `Request failed (${res.status})`
          throw new Error(message)
        }
        toast({ title: 'Lead created', description: `${form.customerName.trim()} added to ${DEPT_LABELS[form.department] ?? form.department}` })
      }
      setSaving(false)
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setSaving(false)
      toast({ title: lead ? 'Update failed' : 'Create failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const openExisting = (dup: DuplicateInfo) => {
    onOpenChange(false)
    setView('lead-detail', { leadId: dup.id })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? `Edit Lead — ${lead.leadCode ?? ''}` : 'New Lead'}</DialogTitle>
          <DialogDescription>
            {lead
              ? 'Update lead information. Disposition is managed from the lead 360° view.'
              : 'Create a new lead. Fields marked * are required.'}
          </DialogDescription>
        </DialogHeader>

        {duplicate ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" role="alert">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-amber-800">Duplicate mobile number in {DEPT_LABELS[form.department] ?? form.department}</p>
                <p className="mt-0.5 text-amber-700">
                  Existing lead: <span className="font-semibold">{duplicate.leadCode}</span> — {duplicate.customerName}. Save anyway to create a duplicate entry.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => openExisting(duplicate)}>
                    Open existing lead
                  </Button>
                  <Button type="button" size="sm" className="bg-amber-600 hover:bg-amber-700" disabled={saving} onClick={() => submit(true)}>
                    {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
                    Save anyway
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDuplicate(null)}>
                    Edit details
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="lf-name">Customer Name *</Label>
            <Input id="lf-name" value={form.customerName} onChange={(e) => setField('customerName', e.target.value)} placeholder="Full name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lf-mobile">Mobile *</Label>
            <Input id="lf-mobile" type="tel" value={form.mobile} onChange={(e) => onMobileChange(e.target.value)} placeholder="9876543210" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lf-company">Company Name</Label>
            <Input id="lf-company" value={form.companyName} onChange={(e) => setField('companyName', e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lf-whatsapp">
              WhatsApp{isExport ? ' (= Mobile if left empty)' : ' (optional)'}
            </Label>
            <Input
              id="lf-whatsapp"
              type="tel"
              value={form.whatsapp}
              onChange={(e) => setField('whatsapp', e.target.value)}
              placeholder={isExport ? '= Mobile' : 'Optional'}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lf-email">Email</Label>
            <Input id="lf-email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lf-city">City</Label>
            <Input id="lf-city" value={form.city} onChange={(e) => setField('city', e.target.value)} placeholder="City" />
          </div>

          <div className="space-y-1.5">
            <Label>Department *</Label>
            {canPickDepartment ? (
              <Select value={form.department} onValueChange={onDepartmentChange}>
                <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={DEPT_LABELS[department] ?? department} disabled aria-label="Department (locked)" />
            )}
          </div>

          {isExport ? (
            <div className="space-y-1.5">
              <Label>Country *</Label>
              <SearchableSelect
                value={form.countryId}
                onChange={(id) => setField('countryId', id)}
                options={countryOptions}
                placeholder="Select country"
                searchPlaceholder="Search 60+ countries…"
                emptyText="Country not found"
                ariaLabel="Country"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>State *</Label>
              <SearchableSelect
                value={form.stateId}
                onChange={(id) => setField('stateId', id)}
                options={stateOptions}
                placeholder="Select state"
                searchPlaceholder="Search states…"
                emptyText="State not found"
                ariaLabel="State"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Source *</Label>
            <Select value={form.sourceId} onValueChange={(v) => setField('sourceId', v)}>
              <SelectTrigger aria-label="Lead source"><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                {sourceOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Stage</Label>
            <Select value={form.stageId} onValueChange={(v) => setField('stageId', v)}>
              <SelectTrigger aria-label="Pipeline stage"><SelectValue placeholder="Select stage" /></SelectTrigger>
              <SelectContent>
                {stageOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isVisitSource ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="lf-visit-date">Visit Date *</Label>
                <Input id="lf-visit-date" type="date" value={form.visitDate} onChange={(e) => setField('visitDate', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lf-visit-time">Visit Time *</Label>
                <Input id="lf-visit-time" type="time" value={form.visitTime} onChange={(e) => setField('visitTime', e.target.value)} />
              </div>
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label>Business Type</Label>
            <Select value={form.businessTypeId} onValueChange={(v) => setField('businessTypeId', v)}>
              <SelectTrigger aria-label="Business type"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {businessOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={form.priority} onValueChange={(v) => setField('priority', v)}>
              <SelectTrigger aria-label="Priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lf-product">Product Interest</Label>
            <Input id="lf-product" value={form.productInterest} onChange={(e) => setField('productInterest', e.target.value)} placeholder="e.g. Bridal lehenga" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lf-volume">Monthly Volume (pcs)</Label>
            <Input id="lf-volume" type="number" min={0} value={form.monthlyVolume} onChange={(e) => setField('monthlyVolume', e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lf-budget">Budget (₹)</Label>
            <Input id="lf-budget" type="number" min={0} value={form.budget} onChange={(e) => setField('budget', e.target.value)} placeholder="Optional" />
          </div>
          {isManagement && !lead ? (
            <div className="space-y-1.5">
              <Label>Campaign</Label>
              <Select value={form.campaignId} onValueChange={(v) => setField('campaignId', v === 'none' ? '' : v)}>
                <SelectTrigger aria-label="Campaign"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lf-req">Requirement Notes</Label>
            <Textarea id="lf-req" rows={2} value={form.requirementNotes} onChange={(e) => setField('requirementNotes', e.target.value)} placeholder="What is the customer looking for?" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lf-notes">Internal Notes</Label>
            <Textarea id="lf-notes" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Internal context for the team" />
          </div>

          {lead ? (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm sm:col-span-2">
              <p className="flex items-center gap-1.5 font-medium text-stone-700">
                <MapPin className="h-4 w-4 text-emerald-600" aria-hidden /> Current Disposition (read-only)
              </p>
              <p className="mt-1 text-stone-600">
                {lead.disposition?.label ?? 'Not set'}
                {lead.subDisposition ? <span className="text-stone-400"> — {lead.subDisposition.label}</span> : null}
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="bg-emerald-600 hover:bg-emerald-700" disabled={saving} onClick={() => submit(false)}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            {lead ? 'Save Changes' : 'Create Lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

