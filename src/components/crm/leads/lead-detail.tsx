'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Circle,
  Edit3,
  File,
  FileText,
  GitBranch,
  IndianRupee,
  LifeBuoy,
  Loader2,
  Megaphone,
  MessageCircle,
  Phone,
  Pin,
  Plus,
  ShoppingCart,
  Sparkles,
  StickyNote,
  Tags,
  Trash2,
  Truck,
  UserCog,
  UserPlus,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { formatDateTime, formatDuration, formatINR, timeAgo, toInputDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PAYMENT_MODES, PAYMENT_MODE_LABELS } from '@/lib/constants'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { masterExtra, useMasters } from '@/components/crm/shared/use-masters'
import { dispositionExtra, useAppStore } from '@/store/app-store'
import type { MasterItemDTO } from '@/types/crm'
import LeadFormDialog, { type LeadEditInput } from '@/components/crm/leads/lead-form-dialog'

// ---------- types ----------

type DetailLead = {
  id: string
  leadCode: string
  department: string
  customerName: string
  companyName: string | null
  mobile: string
  whatsapp: string | null
  email: string | null
  city: string | null
  stateId: string | null
  state: MasterItemDTO | null
  countryId: string | null
  country: MasterItemDTO | null
  businessTypeId: string | null
  businessType: MasterItemDTO | null
  productInterest: string | null
  requirementNotes: string | null
  monthlyVolume: number | null
  budget: number | null
  sourceId: string | null
  source: MasterItemDTO | null
  visitDate: string | null
  visitTime: string | null
  assignedToId: string | null
  assignedTo: { id: string; name: string; role: string; phone: string | null; email: string | null } | null
  createdBy: { id: string; name: string } | null
  stageId: string | null
  stage: MasterItemDTO | null
  dispositionId: string | null
  disposition: MasterItemDTO | null
  subDispositionId: string | null
  subDisposition: MasterItemDTO | null
  priority: string | null
  estimatedValue: number | null
  notes: string | null
  lastFollowUpAt: string | null
  nextFollowUpAt: string | null
  lastContactAt: string | null
  isSticky: boolean
  stickySince: string | null
  status: string
  customerType: string | null
  createdAt: string
  updatedAt: string
}

type ActivityRow = { id: string; type: string; title: string; description: string | null; createdAt: string; user: { id: string; name: string } | null }
type FollowupRow = { id: string; dueAt: string; status: string; note: string | null; outcome: string | null; completedAt: string | null; assignedTo: { id: string; name: string } | null }
type CallRow = { id: string; direction: string; status: string; durationSec: number; notes: string | null; channel: string; isVideo: boolean; createdAt: string; user: { id: string; name: string } | null }
type QuoteRow = { id: string; quoteNo: string; subtotal: number; discount: number; total: number; status: string; createdAt: string }
type ShipmentLite = { id: string; stage: string; courierName: string | null; awbNumber: string | null; trackingUrl: string | null; dispatchedAt: string | null; deliveredAt: string | null }
type OrderRow = { id: string; orderNo: string; total: number; paidAmount: number; paymentStatus: string; status: string; createdAt: string; shipment: ShipmentLite | null; invoices: { id: string; invoiceNo: string; amount: number; paidAmount: number; status: string }[] }
type PaymentRow = { id: string; receiptNo: string; amount: number; mode: string; isAdvance: boolean; paidAt: string; notes: string | null }
type TicketRow = { id: string; ticketNo: string; subject: string; priority: string; status: string; createdAt: string }
type MeetingRow = { id: string; title: string; scheduledAt: string; link: string | null; outcome: string | null; notes: string | null }
type DocumentRow = { id: string; name: string; type: string | null; version: number; expiryDate: string | null; url: string | null; createdAt: string }

type LeadBundle = {
  lead: DetailLead
  activities: ActivityRow[]
  followups: FollowupRow[]
  callLogs: CallRow[]
  quotations: QuoteRow[]
  orders: OrderRow[]
  payments: PaymentRow[]
  tickets: TicketRow[]
  meetings: MeetingRow[]
  documents: DocumentRow[]
  conversations: { id: string; phone: string; unreadCount: number; lastMessageAt: string | null }[]
}

type ExecUser = { id: string; name: string; role: string; isActive: boolean }
type ProductLite = { id: string; name: string; price: number; code: string | null }

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  CALL: Phone,
  WHATSAPP: MessageCircle,
  NOTE: StickyNote,
  DISPOSITION: Tags,
  STAGE: GitBranch,
  ASSIGNMENT: UserPlus,
  FOLLOWUP: CalendarClock,
  QUOTATION: FileText,
  ORDER: ShoppingCart,
  PAYMENT: IndianRupee,
  DISPATCH: Truck,
  TICKET: LifeBuoy,
  MEETING: Video,
  DOCUMENT: File,
  LEAD: Sparkles,
  AI_CALL: Bot,
  BROADCAST: Megaphone,
}

const DOCUMENT_TYPES = ['QUOTATION', 'INVOICE', 'PACKING_LIST', 'SHIPPING', 'PRODUCT_PDF', 'AGREEMENT', 'OTHER']
const COMPLETE_OUTCOMES = ['Interested', 'Not Interested', 'Callback Booked', 'No Response']
const MANAGEMENT_ROLES = ['TEAM_LEADER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']

// ---------- component ----------

export default function LeadDetail({ leadId }: { leadId?: string }) {
  const storeLeadId = useAppStore((s) => (s.params as { leadId?: string }).leadId)
  const setView = useAppStore((s) => s.setView)
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const masters = useMasters()

  const id = leadId || storeLeadId || ''
  const isManagement = MANAGEMENT_ROLES.includes(user?.role ?? '')
  const canRecordPayment = isManagement || user?.role === 'ACCOUNTS' || user?.role === 'EXECUTIVE'

  const [bundle, setBundle] = useState<LeadBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string | null>(null)
  const [tab, setTab] = useState('timeline')
  const [reloadKey, setReloadKey] = useState(0)

  // note dialog
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  // reassign dialog
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassignTarget, setReassignTarget] = useState('')
  const [execs, setExecs] = useState<ExecUser[]>([])
  // edit form
  const [formOpen, setFormOpen] = useState(false)
  // stage backward-move confirmation
  const [backStage, setBackStage] = useState<MasterItemDTO | null>(null)

  // disposition form
  const [dispId, setDispId] = useState('')
  const [subId, setSubId] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [estValue, setEstValue] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMode, setPayMode] = useState('UPI')
  const [dispNote, setDispNote] = useState('')

  // follow-up schedule (inline) + reschedule dialog
  const [fuDue, setFuDue] = useState('')
  const [fuNote, setFuNote] = useState('')
  const [reschedFollowup, setReschedFollowup] = useState<FollowupRow | null>(null)
  const [reschedTo, setReschedTo] = useState('')

  // quotation quick create
  const [products, setProducts] = useState<ProductLite[]>([])
  const [productsLoaded, setProductsLoaded] = useState(false)
  const [quoteRows, setQuoteRows] = useState<{ productId: string; qty: string }[]>([{ productId: '', qty: '1' }])
  const [quoteDiscount, setQuoteDiscount] = useState('')

  // payment dialog
  const [payOpen, setPayOpen] = useState(false)
  const [payInput, setPayInput] = useState('')
  const [payModeInput, setPayModeInput] = useState('BANK_TRANSFER')
  const [payAdvance, setPayAdvance] = useState(false)
  const [payNotes, setPayNotes] = useState('')

  // ticket dialog
  const [ticketOpen, setTicketOpen] = useState(false)
  const [ticketType, setTicketType] = useState('')
  const [ticketPriority, setTicketPriority] = useState('MEDIUM')
  const [ticketSubject, setTicketSubject] = useState('')
  const [ticketDesc, setTicketDesc] = useState('')

  // meeting dialog
  const [meetOpen, setMeetOpen] = useState(false)
  const [meetTitle, setMeetTitle] = useState('')
  const [meetAt, setMeetAt] = useState('')
  const [meetLink, setMeetLink] = useState('')

  // document dialog
  const [docOpen, setDocOpen] = useState(false)
  const [docName, setDocName] = useState('')
  const [docType, setDocType] = useState('OTHER')
  const [docUrl, setDocUrl] = useState('')

  const lead = bundle?.lead

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await api<LeadBundle>(`/api/leads/detail${qs({ id })}`)
      setBundle(res)
    } catch (e) {
      toast({ title: 'Failed to load lead', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  // executives for reassign
  useEffect(() => {
    if (!isManagement) return
    api<{ users: ExecUser[] }>(`/api/users${qs({ role: 'EXECUTIVE', active: 1, dept: lead?.department || undefined })}`)
      .then((res) => setExecs(res.users ?? []))
      .catch(() => setExecs([]))
  }, [isManagement, lead?.department])

  // prefill disposition form whenever lead changes
  useEffect(() => {
    if (!lead) return
    setDispId(lead.dispositionId ?? '')
    setSubId(lead.subDispositionId ?? '')
    setCallbackAt('')
    setFollowUpAt('')
    setEstValue('')
    setPayAmount('')
    setPayMode('UPI')
    setDispNote('')
  }, [lead?.id, lead?.dispositionId, lead?.subDispositionId, lead])

  // lazy-load products when quotations tab opens
  useEffect(() => {
    if (tab !== 'quotations' || productsLoaded || !id) return
    setProductsLoaded(true)
    api<{ products: ProductLite[] }>(`/api/products${qs({ active: 1, pageSize: 100 })}`)
      .then((res) => setProducts(res.products ?? []))
      .catch(() => toast({ title: 'Failed to load products', variant: 'destructive' }))
  }, [tab, productsLoaded, id, toast])

  const dept = lead?.department ?? ''
  const stages = useMemo(() => masters.items('pipeline_stage', dept || undefined), [masters, dept])
  const dispositionOptions = useMemo(() => masters.items('disposition', dept || undefined), [masters, dept])
  const subOptions = useMemo(() => (dispId ? masters.subItems(dispId, dept || undefined) : []), [masters, dispId, dept])
  const dispExtra = useMemo(() => dispositionExtra(masters.byId(dispId)?.extra), [masters, dispId])
  const ticketTypeOptions = useMemo(() => masters.items('ticket_type').map((m) => ({ id: m.id, label: m.label })), [masters])

  const isOverdue = (d: string | null) => Boolean(d && new Date(d).getTime() < Date.now())

  // ---------- mutations ----------

  const runMutation = async (key: string, fn: () => Promise<LeadBundle | void>, success: string) => {
    setPending(key)
    try {
      const res = await fn()
      if (res && typeof res === 'object' && 'lead' in res) setBundle(res as LeadBundle)
      else setReloadKey((k) => k + 1)
      toast({ title: success })
      return true
    } catch (e) {
      toast({ title: 'Action failed', description: (e as Error).message, variant: 'destructive' })
      return false
    } finally {
      setPending(null)
    }
  }

  const moveStage = async (stage: MasterItemDTO) => {
    if (!lead || stage.id === lead.stageId) return
    const currentIdx = stages.findIndex((s) => s.id === lead.stageId)
    const nextIdx = stages.findIndex((s) => s.id === stage.id)
    if (currentIdx >= 0 && nextIdx >= 0 && nextIdx < currentIdx) {
      setBackStage(stage)
      return
    }
    await doStageMove(stage)
  }

  const doStageMove = async (stage: MasterItemDTO) => {
    if (!lead) return
    await runMutation(
      'stage',
      () => api<LeadBundle>('/api/leads', { method: 'PATCH', body: { id: lead.id, stageId: stage.id } }),
      `Stage updated — ${stage.label}`
    )
  }

  const submitDisposition = async () => {
    if (!lead) return
    if (!dispId) {
      toast({ title: 'Select a disposition first', variant: 'destructive' })
      return
    }
    if (dispExtra.showCallback && !callbackAt) {
      toast({ title: 'Next Callback Date & Time is required', variant: 'destructive' })
      return
    }
    if (dispExtra.showFollowUp && !followUpAt) {
      toast({ title: 'Follow-up Date & Time is required', variant: 'destructive' })
      return
    }
    await runMutation(
      'disposition',
      () =>
        api<LeadBundle>('/api/leads', {
          method: 'PATCH',
          body: {
            id: lead.id,
            dispositionUpdate: {
              dispositionId: dispId,
              subDispositionId: subId || undefined,
              callbackAt: dispExtra.showCallback ? callbackAt : undefined,
              followUpAt: dispExtra.showFollowUp ? followUpAt : undefined,
              estimatedValue: dispExtra.showEstimated && estValue ? Number(estValue) : undefined,
              paymentAmount: dispExtra.showPayment && payAmount ? Number(payAmount) : undefined,
              mode: dispExtra.showPayment ? payMode : undefined,
              note: dispNote || undefined,
            },
          },
        }),
      'Disposition updated'
    )
  }

  const addNote = async () => {
    if (!lead || !noteText.trim()) {
      toast({ title: 'Note cannot be empty', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'note',
      () => api('/api/leads/note', { method: 'POST', body: { leadId: lead.id, note: noteText.trim() } }),
      'Note added'
    )
    if (okDone) {
      setNoteText('')
      setNoteOpen(false)
    }
  }

  const submitReassign = async () => {
    if (!lead || !reassignTarget) {
      toast({ title: 'Select an executive', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'reassign',
      () => api('/api/leads/assign', { method: 'POST', body: { leadIds: [lead.id], assignedToId: reassignTarget } }),
      'Lead reassigned'
    )
    if (okDone) setReassignOpen(false)
  }

  const scheduleFollowup = async () => {
    if (!lead) return
    if (!fuDue) {
      toast({ title: 'Pick a date & time', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'followup',
      () => api('/api/followups', { method: 'POST', body: { leadId: lead.id, dueAt: new Date(fuDue).toISOString(), note: fuNote || undefined } }),
      'Follow-up scheduled'
    )
    if (okDone) {
      setFuDue('')
      setFuNote('')
    }
  }

  const completeFollowup = async (fu: FollowupRow, outcome?: string) => {
    await runMutation(
      'complete',
      () => api('/api/followups', { method: 'PATCH', body: { id: fu.id, status: 'COMPLETED', outcome: outcome ?? fu.outcome ?? undefined } }),
      'Follow-up completed'
    )
  }

  const submitReschedule = async () => {
    if (!reschedFollowup || !reschedTo) {
      toast({ title: 'Pick a new date & time', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'resched',
      () =>
        api('/api/followups', {
          method: 'PATCH',
          body: { id: reschedFollowup.id, status: 'RESCHEDULED', rescheduleTo: new Date(reschedTo).toISOString() },
        }),
      'Follow-up rescheduled'
    )
    if (okDone) setReschedFollowup(null)
  }

  const logIncomingCall = async () => {
    if (!lead) return
    await runMutation(
      'call',
      () => api('/api/calls', { method: 'POST', body: { leadId: lead.id, direction: 'INCOMING', status: 'CONNECTED', durationSec: 0 } }),
      'Incoming call logged'
    )
  }

  const submitQuotation = async () => {
    if (!lead) return
    const items = quoteRows
      .filter((r) => r.productId)
      .map((r) => {
        const p = products.find((x) => x.id === r.productId)
        return { productId: r.productId, name: p?.name ?? 'Item', qty: Math.max(1, Number(r.qty) || 1), price: p?.price ?? 0 }
      })
    if (items.length === 0) {
      toast({ title: 'Add at least one product', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'quote',
      () => api('/api/quotations', { method: 'POST', body: { leadId: lead.id, items, discount: quoteDiscount ? Number(quoteDiscount) : undefined } }),
      'Quotation created'
    )
    if (okDone) {
      setQuoteRows([{ productId: '', qty: '1' }])
      setQuoteDiscount('')
    }
  }

  const submitPayment = async () => {
    if (!lead) return
    if (!payInput || Number(payInput) <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'pay',
      () =>
        api('/api/payments', {
          method: 'POST',
          body: {
            leadId: lead.id,
            amount: Math.round(Number(payInput)),
            mode: payModeInput,
            isAdvance: payAdvance,
            notes: payNotes || undefined,
          },
        }),
      'Payment recorded'
    )
    if (okDone) {
      setPayOpen(false)
      setPayInput('')
      setPayNotes('')
      setPayAdvance(false)
    }
  }

  const submitTicket = async () => {
    if (!lead) return
    if (!ticketSubject.trim()) {
      toast({ title: 'Subject is required', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'ticket',
      () =>
        api('/api/tickets', {
          method: 'POST',
          body: { leadId: lead.id, type: ticketType || 'Other', priority: ticketPriority, subject: ticketSubject.trim(), description: ticketDesc || undefined },
        }),
      'Ticket created'
    )
    if (okDone) {
      setTicketOpen(false)
      setTicketSubject('')
      setTicketDesc('')
    }
  }

  const submitMeeting = async () => {
    if (!lead) return
    if (!meetTitle.trim() || !meetAt) {
      toast({ title: 'Title and date/time are required', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'meet',
      () => api('/api/meetings', { method: 'POST', body: { leadId: lead.id, title: meetTitle.trim(), scheduledAt: new Date(meetAt).toISOString(), link: meetLink || undefined } }),
      'Video meeting scheduled'
    )
    if (okDone) {
      setMeetOpen(false)
      setMeetTitle('')
      setMeetAt('')
      setMeetLink('')
    }
  }

  const submitDocument = async () => {
    if (!lead) return
    if (!docName.trim()) {
      toast({ title: 'Document name is required', variant: 'destructive' })
      return
    }
    const okDone = await runMutation(
      'doc',
      () => api('/api/documents', { method: 'POST', body: { leadId: lead.id, name: docName.trim(), type: docType, url: docUrl || undefined } }),
      'Document added'
    )
    if (okDone) {
      setDocOpen(false)
      setDocName('')
      setDocUrl('')
    }
  }

  const triggerAiReminder = async () => {
    if (!lead) return
    setPending('remind')
    try {
      const res = await api<{ ok: boolean; outcome: string }>('/api/visits/remind', { method: 'POST', body: { leadId: lead.id } })
      toast({ title: 'AI Reminder Call placed', description: `Outcome: ${res.outcome}` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'AI reminder failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setPending(null)
    }
  }

  // ---------- derived ----------
  const leadForForm: LeadEditInput | null = lead
    ? {
        id: lead.id,
        leadCode: lead.leadCode,
        department: lead.department,
        customerName: lead.customerName,
        companyName: lead.companyName,
        mobile: lead.mobile,
        whatsapp: lead.whatsapp,
        email: lead.email,
        city: lead.city,
        stateId: lead.stateId,
        countryId: lead.countryId,
        businessTypeId: lead.businessTypeId,
        productInterest: lead.productInterest,
        requirementNotes: lead.requirementNotes,
        monthlyVolume: lead.monthlyVolume,
        budget: lead.budget,
        sourceId: lead.sourceId,
        visitDate: lead.visitDate,
        visitTime: lead.visitTime,
        priority: lead.priority,
        notes: lead.notes,
        stageId: lead.stageId,
        disposition: lead.disposition ? { id: lead.disposition.id, label: lead.disposition.label } : null,
        subDisposition: lead.subDisposition ? { id: lead.subDisposition.id, label: lead.subDisposition.label } : null,
      }
    : null

  const quoteTotalPreview = quoteRows.reduce((sum, r) => {
    const p = products.find((x) => x.id === r.productId)
    return sum + (p ? p.price * (Number(r.qty) || 0) : 0)
  }, 0) - (Number(quoteDiscount) || 0)

  // ---------- loading skeleton ----------
  if (loading && !bundle) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </div>
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-500 shadow-sm">
        Lead not found or you do not have access to it.
      </div>
    )
  }

  const stageColor = String(masterExtra(lead.stage?.extra).color ?? '')
  const locationLabel =
    lead.department === 'EXPORT'
      ? lead.country?.label ?? '—'
      : [lead.city, lead.state?.label].filter(Boolean).join(', ') || '—'

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => setView('leads')} aria-label="Back to leads list">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to Leads
      </Button>

      {/* header card */}
      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-stone-800">{lead.leadCode}</span>
              <StatusBadge status={lead.department} variant="dept" />
              {lead.stage ? (
                <Badge variant="outline" className="gap-1.5 border-stone-200 font-medium text-stone-700">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stageColor || '#a8a29e' }} aria-hidden />
                  {lead.stage.label}
                </Badge>
              ) : null}
              <StatusBadge status={lead.status} variant="leadStatus" />
              <StatusBadge status={lead.priority} variant="priority" />
              {lead.isSticky ? (
                <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
                  <Pin className="h-3 w-3" aria-hidden /> Sticky Owner: {lead.assignedTo?.name ?? '—'}
                </Badge>
              ) : null}
            </div>
            <h2 className="mt-2 text-lg font-semibold text-stone-900 md:text-xl">
              {lead.customerName}
              {lead.companyName ? <span className="ml-2 text-sm font-normal text-stone-500">{lead.companyName}</span> : null}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {lead.mobile}
              {lead.whatsapp && lead.whatsapp !== lead.mobile ? ` · WA ${lead.whatsapp}` : ''}
              {lead.email ? ` · ${lead.email}` : ''} · Created {timeAgo(lead.createdAt)}
              {lead.createdBy ? ` by ${lead.createdBy.name}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setView('dialer', { leadId: lead.id })}>
              <Phone className="h-4 w-4" aria-hidden /> <span className="ml-1">Call</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setView('whatsapp', { leadId: lead.id })}>
              <MessageCircle className="h-4 w-4" aria-hidden /> <span className="ml-1">WhatsApp</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setFormOpen(true)}>
              <Edit3 className="h-4 w-4" aria-hidden /> <span className="ml-1">Edit</span>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}>
              <StickyNote className="h-4 w-4" aria-hidden /> <span className="ml-1">Add Note</span>
            </Button>
            {isManagement ? (
              <Button size="sm" variant="outline" onClick={() => { setReassignTarget(lead.assignedTo?.id ?? ''); setReassignOpen(true) }}>
                <UserCog className="h-4 w-4" aria-hidden /> <span className="ml-1">Reassign</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* left column */}
        <div className="space-y-4 lg:col-span-2">
          {/* quick stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: 'Estimated Value', value: lead.estimatedValue ? formatINR(lead.estimatedValue) : '—' },
              { label: 'Budget', value: lead.budget ? formatINR(lead.budget) : '—' },
              { label: 'Last Contact', value: lead.lastContactAt ? timeAgo(lead.lastContactAt) : '—' },
              {
                label: 'Next Follow-up',
                value: lead.nextFollowUpAt ? formatDateTime(lead.nextFollowUpAt) : '—',
                danger: isOverdue(lead.nextFollowUpAt),
              },
              { label: 'Source', value: lead.source?.label ?? '—' },
              { label: lead.department === 'EXPORT' ? 'Country' : 'State / City', value: locationLabel },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{s.label}</p>
                <p className={cn('mt-1 truncate text-sm font-semibold', s.danger ? 'text-rose-600' : 'text-stone-900')} title={typeof s.value === 'string' ? s.value : undefined}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          {/* stage stepper */}
          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
              <GitBranch className="h-3.5 w-3.5" aria-hidden /> Pipeline Stage
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {stages.map((s) => {
                const active = s.id === lead.stageId
                const c = String(masterExtra(s.extra).color ?? '')
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={pending === 'stage'}
                    onClick={() => moveStage(s)}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      active ? 'border-transparent text-white' : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-400 hover:text-emerald-700'
                    )}
                    style={active ? { backgroundColor: c || '#059669' } : undefined}
                    aria-pressed={active}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: active ? 'rgba(255,255,255,0.85)' : c || '#a8a29e' }} aria-hidden />
                    {s.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-stone-400">Click a stage to move this lead. Backward moves ask for confirmation.</p>
          </div>

          {/* tabs */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-stone-100">
              {['timeline', 'followups', 'calls', 'whatsapp', 'quotations', 'orders', 'dispatch', 'tickets', 'meetings', 'documents'].map((t) => (
                <TabsTrigger key={t} value={t} className="capitalize">
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* TIMELINE */}
            <TabsContent value="timeline">
              <div className="max-h-[520px] space-y-3 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                {bundle && bundle.activities.length > 0 ? (
                  bundle.activities.map((a) => {
                    const Icon = ACTIVITY_ICONS[a.type] ?? Circle
                    return (
                      <div key={a.id} className="flex gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                          <Icon className="h-4 w-4" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1 border-b border-stone-100 pb-3 last:border-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-1">
                            <p className="text-sm font-medium text-stone-800">{a.title}</p>
                            <p className="text-xs text-stone-400">{timeAgo(a.createdAt)}</p>
                          </div>
                          {a.description ? <p className="mt-0.5 whitespace-pre-line text-xs text-stone-500">{a.description}</p> : null}
                          {a.user ? <p className="mt-0.5 text-xs text-stone-400">— {a.user.name}</p> : null}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <p className="py-6 text-center text-sm text-stone-400">No activity yet — calls, notes and stage moves will appear here.</p>
                )}
              </div>
            </TabsContent>

            {/* FOLLOW-UPS */}
            <TabsContent value="followups">
              <div className="space-y-3">
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Schedule Follow-up
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="fu-due">Date & Time</Label>
                      <Input id="fu-due" type="datetime-local" value={fuDue} onChange={(e) => setFuDue(e.target.value)} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="fu-note">Note</Label>
                      <Input id="fu-note" value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="What to discuss?" />
                    </div>
                    <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'followup'} onClick={scheduleFollowup}>
                      {pending === 'followup' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
                      Schedule
                    </Button>
                  </div>
                </div>
                <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  {bundle && bundle.followups.length > 0 ? (
                    bundle.followups.map((f) => (
                      <div key={f.id} className="flex flex-col gap-2 rounded-lg border border-stone-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className={cn('text-sm font-medium', f.status === 'PENDING' && isOverdue(f.dueAt) ? 'text-rose-600' : 'text-stone-800')}>
                            {formatDateTime(f.dueAt)}
                            <StatusBadge status={f.status} variant="followup" className="ml-2" />
                          </div>
                          {f.note ? <p className="truncate text-xs text-stone-500">{f.note}</p> : null}
                          {f.assignedTo ? <p className="text-xs text-stone-400">Owner: {f.assignedTo.name}</p> : null}
                        </div>
                        {f.status === 'PENDING' ? (
                          <div className="flex shrink-0 gap-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" disabled={pending !== null} aria-label={`Complete follow-up due ${formatDateTime(f.dueAt)}`}>
                                  Complete
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Outcome</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {COMPLETE_OUTCOMES.map((o) => (
                                  <DropdownMenuItem key={o} onClick={() => completeFollowup(f, o)}>
                                    {o}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => completeFollowup(f)}>Mark complete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => { setReschedFollowup(f); setReschedTo(toInputDateTime(f.dueAt)) }}>
                              Reschedule
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-stone-400">No follow-ups scheduled yet.</p>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* CALLS */}
            <TabsContent value="calls">
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" disabled={pending === 'call'} onClick={logIncomingCall}>
                    <Phone className="h-4 w-4" aria-hidden /> <span className="ml-1">Log Incoming Call</span>
                  </Button>
                </div>
                <div className="max-h-[460px] space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  {bundle && bundle.callLogs.length > 0 ? (
                    bundle.callLogs.map((c) => (
                      <div key={c.id} className="flex flex-col gap-2 rounded-lg border border-stone-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={c.direction} variant="direction" />
                            <StatusBadge status={c.status} variant="call" />
                            {c.channel !== 'CRM' ? <Badge variant="outline" className="text-[10px]">{c.channel}</Badge> : null}
                            <span className="text-xs text-stone-500">{formatDuration(c.durationSec)}</span>
                          </div>
                          {c.notes ? <p className="mt-1 text-xs text-stone-500">{c.notes}</p> : null}
                        </div>
                        <div className="shrink-0 text-right text-xs text-stone-400">
                          <p>{formatDateTime(c.createdAt)}</p>
                          {c.user ? <p>by {c.user.name}</p> : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-stone-400">No calls logged yet.</p>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* WHATSAPP */}
            <TabsContent value="whatsapp">
              <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                {bundle && bundle.conversations.length > 0 ? (
                  bundle.conversations.map((c) => (
                    <div key={c.id} className="flex flex-col gap-2 rounded-lg border border-stone-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-stone-800">{c.phone}</p>
                        <p className="text-xs text-stone-400">Last message {c.lastMessageAt ? timeAgo(c.lastMessageAt) : '—'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.unreadCount > 0 ? <Badge className="bg-emerald-600 text-white">{c.unreadCount} unread</Badge> : null}
                        <Button size="sm" variant="outline" onClick={() => setView('whatsapp', { leadId: lead.id })}>
                          <MessageCircle className="h-4 w-4" aria-hidden /> <span className="ml-1">Open Chat</span>
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-4 text-center">
                    <p className="text-sm text-stone-500">No WhatsApp conversation yet for this lead.</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => setView('whatsapp', { leadId: lead.id })}>
                      <MessageCircle className="h-4 w-4" aria-hidden /> <span className="ml-1">Open WhatsApp</span>
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* QUOTATIONS */}
            <TabsContent value="quotations">
              <div className="space-y-3">
                {canRecordPayment ? (
                  <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                        <FileText className="h-3.5 w-3.5" aria-hidden /> Quick Quotation
                      </p>
                      <Button size="sm" variant="ghost" onClick={() => setView('quotations', { leadId: lead.id })}>
                        View All
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {quoteRows.map((row, i) => (
                        <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Select
                            value={row.productId}
                            onValueChange={(v) => setQuoteRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, productId: v } : r)))}
                          >
                            <SelectTrigger className="flex-1" aria-label={`Product for row ${i + 1}`}>
                              <SelectValue placeholder="Select product" />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} — {formatINR(p.price)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            min={1}
                            className="w-full sm:w-24"
                            value={row.qty}
                            aria-label={`Quantity for row ${i + 1}`}
                            onChange={(e) => setQuoteRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, qty: e.target.value } : r)))}
                          />
                          {quoteRows.length > 1 ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove row ${i + 1}`}
                              onClick={() => setQuoteRows((rows) => rows.filter((_, idx) => idx !== i))}
                            >
                              <Trash2 className="h-4 w-4 text-rose-500" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setQuoteRows((rows) => [...rows, { productId: '', qty: '1' }])}>
                          <Plus className="h-4 w-4" aria-hidden /> Add item
                        </Button>
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor="q-disc" className="text-xs text-stone-500">Discount ₹</Label>
                          <Input id="q-disc" type="number" min={0} className="h-8 w-28" value={quoteDiscount} onChange={(e) => setQuoteDiscount(e.target.value)} />
                        </div>
                        <span className="ml-auto text-sm font-semibold text-emerald-700">Total: {formatINR(Math.max(0, quoteTotalPreview))}</span>
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'quote'} onClick={submitQuotation}>
                          {pending === 'quote' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
                          Create Quotation
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="max-h-[380px] space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  {bundle && bundle.quotations.length > 0 ? (
                    bundle.quotations.map((q) => (
                      <div key={q.id} className="flex items-center justify-between rounded-lg border border-stone-100 p-3">
                        <div>
                          <p className="font-mono text-sm font-semibold text-stone-800">{q.quoteNo}</p>
                          <p className="text-xs text-stone-400">{formatDateTime(q.createdAt)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-emerald-700">{formatINR(q.total)}</span>
                          <StatusBadge status={q.status} variant="quotation" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-stone-400">No quotations yet.</p>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ORDERS & PAYMENTS */}
            <TabsContent value="orders">
              <div className="space-y-3">
                <div className="flex flex-wrap justify-end gap-2">
                  {canRecordPayment ? (
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setPayOpen(true)}>
                      <IndianRupee className="h-4 w-4" aria-hidden /> <span className="ml-1">Record Payment</span>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => setView('orders', { leadId: lead.id })}>
                    <ShoppingCart className="h-4 w-4" aria-hidden /> <span className="ml-1">New Order</span>
                  </Button>
                </div>
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Orders</p>
                  {bundle && bundle.orders.length > 0 ? (
                    <div className="space-y-2">
                      {bundle.orders.map((o) => (
                        <div key={o.id} className="flex flex-col gap-2 rounded-lg border border-stone-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-mono text-sm font-semibold text-stone-800">{o.orderNo}</p>
                            <p className="text-xs text-stone-400">
                              {formatDateTime(o.createdAt)} · Paid {formatINR(o.paidAmount)} / {formatINR(o.total)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={o.status} variant="order" />
                            <StatusBadge status={o.paymentStatus} variant="payment" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-stone-400">No orders yet — convert a quotation or create one from the Orders view.</p>
                  )}
                </div>
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Payments</p>
                  {bundle && bundle.payments.length > 0 ? (
                    <div className="space-y-2">
                      {bundle.payments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between rounded-lg border border-stone-100 p-3">
                          <div>
                            <p className="font-mono text-sm font-semibold text-stone-800">{p.receiptNo}</p>
                            <p className="text-xs text-stone-400">
                              {PAYMENT_MODE_LABELS[p.mode] ?? p.mode} · {formatDateTime(p.paidAt)}
                              {p.isAdvance ? ' · Advance' : ''}
                            </p>
                          </div>
                          <span className="text-sm font-semibold text-emerald-700">{formatINR(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-stone-400">No payments recorded.</p>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* DISPATCH */}
            <TabsContent value="dispatch">
              <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                {bundle && bundle.orders.some((o) => o.shipment) ? (
                  bundle.orders
                    .filter((o) => o.shipment)
                    .map((o) => {
                      const s = o.shipment as ShipmentLite
                      return (
                        <div key={s.id} className="rounded-lg border border-stone-100 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-mono text-sm font-semibold text-stone-800">{o.orderNo}</p>
                            <StatusBadge status={s.stage} variant="shipment" />
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-500 sm:grid-cols-4">
                            <div><span className="block text-stone-400">Courier</span>{s.courierName ?? '—'}</div>
                            <div><span className="block text-stone-400">AWB</span>{s.awbNumber ?? '—'}</div>
                            <div><span className="block text-stone-400">Dispatched</span>{s.dispatchedAt ? formatDateTime(s.dispatchedAt) : '—'}</div>
                            <div><span className="block text-stone-400">Delivered</span>{s.deliveredAt ? formatDateTime(s.deliveredAt) : '—'}</div>
                          </div>
                          {s.trackingUrl ? (
                            <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline">
                              Track shipment ↗
                            </a>
                          ) : null}
                        </div>
                      )
                    })
                ) : (
                  <p className="py-6 text-center text-sm text-stone-400">
                    <Truck className="mx-auto mb-2 h-6 w-6 text-stone-300" aria-hidden />
                    No shipments yet — dispatch starts once an order is confirmed.
                  </p>
                )}
              </div>
            </TabsContent>

            {/* TICKETS */}
            <TabsContent value="tickets">
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setTicketOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> <span className="ml-1">Create Ticket</span>
                  </Button>
                </div>
                <div className="max-h-[380px] space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  {bundle && bundle.tickets.length > 0 ? (
                    bundle.tickets.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-100 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-stone-800">
                            <span className="font-mono text-xs text-stone-500">{t.ticketNo}</span> — {t.subject}
                          </p>
                          <p className="text-xs text-stone-400">{formatDateTime(t.createdAt)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={t.priority} variant="priority" />
                          <StatusBadge status={t.status} variant="ticket" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-stone-400">No support tickets for this lead.</p>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* MEETINGS */}
            <TabsContent value="meetings">
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setMeetOpen(true)}>
                    <Video className="h-4 w-4" aria-hidden /> <span className="ml-1">Schedule Video Meeting</span>
                  </Button>
                </div>
                {lead.visitDate ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                        <Bot className="h-4 w-4" aria-hidden /> AI Visit Reminder
                      </p>
                      <p className="text-xs text-amber-700">
                        Visit scheduled {formatDateTime(lead.visitDate)}{lead.visitTime ? ` at ${lead.visitTime}` : ''} — trigger a reminder call in Ajay Sir&apos;s voice.
                      </p>
                    </div>
                    <Button size="sm" className="bg-amber-600 hover:bg-amber-700" disabled={pending === 'remind'} onClick={triggerAiReminder}>
                      {pending === 'remind' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
                      Trigger AI Reminder Call
                    </Button>
                  </div>
                ) : null}
                <div className="max-h-[380px] space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  {bundle && bundle.meetings.length > 0 ? (
                    bundle.meetings.map((m) => (
                      <div key={m.id} className="flex flex-col gap-1 rounded-lg border border-stone-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-stone-800">{m.title}</p>
                          <p className="text-xs text-stone-400">{formatDateTime(m.scheduledAt)}</p>
                          {m.link ? (
                            <a href={m.link} target="_blank" rel="noreferrer" className="text-xs font-medium text-emerald-700 hover:underline">
                              Join meeting ↗
                            </a>
                          ) : null}
                        </div>
                        {m.outcome ? <StatusBadge status={m.outcome} variant="ticket" /> : <Badge variant="outline" className="text-stone-500">Scheduled</Badge>}
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-stone-400">No meetings scheduled.</p>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* DOCUMENTS */}
            <TabsContent value="documents">
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setDocOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> <span className="ml-1">Add Document</span>
                  </Button>
                </div>
                <div className="max-h-[380px] space-y-2 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  {bundle && bundle.documents.length > 0 ? (
                    bundle.documents.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-stone-100 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-stone-800">{d.name}</p>
                          <p className="text-xs text-stone-400">
                            {d.type ?? 'OTHER'} · v{d.version} · added {timeAgo(d.createdAt)}
                            {d.expiryDate ? ` · expires ${formatDateTime(d.expiryDate)}` : ''}
                          </p>
                        </div>
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-emerald-700 hover:underline">
                            Open ↗
                          </a>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-stone-400">No documents uploaded.</p>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* right column — disposition panel (sticky) */}
        <div className="space-y-4 lg:col-span-1">
          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm lg:sticky lg:top-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
              <Tags className="h-3.5 w-3.5" aria-hidden /> Disposition
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {lead.disposition ? (
                <>
                  <Badge className="bg-emerald-600 text-white">{lead.disposition.label}</Badge>
                  {lead.subDisposition ? <Badge variant="outline" className="border-stone-300 text-stone-600">{lead.subDisposition.label}</Badge> : null}
                </>
              ) : (
                <span className="text-sm text-stone-400">No disposition set yet</span>
              )}
            </div>
            {lead.lastContactAt ? <p className="mt-2 text-xs text-stone-400">Last contact {timeAgo(lead.lastContactAt)}</p> : null}

            <div className="mt-4 space-y-3 border-t border-stone-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Update Disposition</p>
              <div className="space-y-1.5">
                <Label>Disposition</Label>
                <Select value={dispId} onValueChange={(v) => { setDispId(v); setSubId('') }} disabled={pending === 'disposition'}>
                  <SelectTrigger aria-label="Disposition"><SelectValue placeholder="Select disposition" /></SelectTrigger>
                  <SelectContent>
                    {dispositionOptions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {dispId ? (
                <div className="space-y-1.5">
                  <Label>Sub-disposition</Label>
                  <Select value={subId} onValueChange={setSubId} disabled={pending === 'disposition' || subOptions.length === 0}>
                    <SelectTrigger aria-label="Sub-disposition"><SelectValue placeholder={subOptions.length ? 'Optional' : 'None available'} /></SelectTrigger>
                    <SelectContent>
                      {subOptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {dispExtra.showCallback ? (
                <div className="space-y-1.5">
                  <Label htmlFor="disp-callback">Next Callback Date & Time *</Label>
                  <Input id="disp-callback" type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} />
                </div>
              ) : null}
              {dispExtra.showFollowUp ? (
                <div className="space-y-1.5">
                  <Label htmlFor="disp-followup">Follow-up Date & Time *</Label>
                  <Input id="disp-followup" type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
                </div>
              ) : null}
              {dispExtra.showEstimated ? (
                <div className="space-y-1.5">
                  <Label htmlFor="disp-est">Estimated Order Value (₹)</Label>
                  <Input id="disp-est" type="number" min={0} value={estValue} onChange={(e) => setEstValue(e.target.value)} placeholder="0" />
                </div>
              ) : null}
              {dispExtra.showPayment ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="disp-pay">Payment Amount (₹)</Label>
                    <Input id="disp-pay" type="number" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Payment Mode</Label>
                    <Select value={payMode} onValueChange={setPayMode}>
                      <SelectTrigger aria-label="Payment mode"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => (
                          <SelectItem key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="disp-note">Note</Label>
                <Textarea id="disp-note" rows={2} value={dispNote} onChange={(e) => setDispNote(e.target.value)} placeholder="Call summary / context" />
              </div>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'disposition' || !dispId} onClick={submitDisposition}>
                {pending === 'disposition' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
                Save Disposition
              </Button>
            </div>
          </div>

          {/* notes card */}
          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
              <StickyNote className="h-3.5 w-3.5" aria-hidden /> Requirement & Notes
            </p>
            <div className="mt-2 space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-stone-400">Requirement</p>
                <p className="whitespace-pre-line text-stone-700">{lead.requirementNotes || <span className="text-stone-400">Not captured</span>}</p>
                {lead.productInterest ? <p className="mt-1 text-xs text-stone-500">Interest: {lead.productInterest}</p> : null}
              </div>
              <div>
                <p className="text-xs font-medium text-stone-400">Internal Notes</p>
                <p className="whitespace-pre-line text-stone-700">{lead.notes || <span className="text-stone-400">No notes yet</span>}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- dialogs ---- */}

      <LeadFormDialog open={formOpen} onOpenChange={setFormOpen} lead={leadForForm} onSaved={() => setReloadKey((k) => k + 1)} />

      {/* add note */}
      <Dialog open={noteOpen} onOpenChange={(o) => { if (pending !== 'note') setNoteOpen(o) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Note — {lead.leadCode}</DialogTitle>
            <DialogDescription>Notes are appended to the lead timeline.</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a note…" aria-label="Note text" />
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending === 'note'} onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'note'} onClick={addNote}>
              {pending === 'note' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* reassign */}
      <Dialog open={reassignOpen} onOpenChange={(o) => { if (pending !== 'reassign') setReassignOpen(o) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reassign Lead</DialogTitle>
            <DialogDescription>The lead and its WhatsApp conversations move to the new owner; sticky is reset.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>New Owner</Label>
            <Select value={reassignTarget} onValueChange={setReassignTarget} disabled={pending === 'reassign'}>
              <SelectTrigger aria-label="Select new owner"><SelectValue placeholder="Select executive" /></SelectTrigger>
              <SelectContent>
                {execs.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending === 'reassign'} onClick={() => setReassignOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'reassign' || !reassignTarget} onClick={submitReassign}>
              {pending === 'reassign' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* backward stage confirmation */}
      <AlertDialog open={Boolean(backStage)} onOpenChange={(o) => { if (!o) setBackStage(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move lead backward?</AlertDialogTitle>
            <AlertDialogDescription>
              This lead will move from &quot;{lead.stage?.label ?? '—'}&quot; back to &quot;{backStage?.label ?? ''}&quot;. Confirm if this is intentional.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={(e) => {
                e.preventDefault()
                const stage = backStage
                setBackStage(null)
                if (stage) doStageMove(stage)
              }}
            >
              Move to {backStage?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* reschedule follow-up */}
      <Dialog open={Boolean(reschedFollowup)} onOpenChange={(o) => { if (!o) setReschedFollowup(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule Follow-up</DialogTitle>
            <DialogDescription>Pick a new date & time — the lead&apos;s next follow-up moves too.</DialogDescription>
          </DialogHeader>
          <Input type="datetime-local" value={reschedTo} onChange={(e) => setReschedTo(e.target.value)} aria-label="New follow-up date and time" />
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending === 'resched'} onClick={() => setReschedFollowup(null)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'resched' || !reschedTo} onClick={submitReschedule}>
              {pending === 'resched' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* record payment */}
      <Dialog open={payOpen} onOpenChange={(o) => { if (pending !== 'pay') setPayOpen(o) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Payment — {lead.leadCode}</DialogTitle>
            <DialogDescription>Receipt number is generated automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amt">Amount (₹) *</Label>
              <Input id="pay-amt" type="number" min={1} value={payInput} onChange={(e) => setPayInput(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={payModeInput} onValueChange={setPayModeInput}>
                <SelectTrigger aria-label="Payment mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>{PAYMENT_MODE_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={payAdvance} onCheckedChange={(v) => setPayAdvance(v === true)} aria-label="Mark as advance payment" />
              Advance payment
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="pay-notes">Notes</Label>
              <Input id="pay-notes" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Optional reference / remark" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending === 'pay'} onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'pay'} onClick={submitPayment}>
              {pending === 'pay' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* create ticket */}
      <Dialog open={ticketOpen} onOpenChange={(o) => { if (pending !== 'ticket') setTicketOpen(o) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Support Ticket</DialogTitle>
            <DialogDescription>SLA is applied automatically based on priority.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={ticketType} onValueChange={setTicketType}>
                  <SelectTrigger aria-label="Ticket type"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {ticketTypeOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={ticketPriority} onValueChange={setTicketPriority}>
                  <SelectTrigger aria-label="Ticket priority"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-subj">Subject *</Label>
              <Input id="t-subj" value={ticketSubject} onChange={(e) => setTicketSubject(e.target.value)} placeholder="Short summary" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-desc">Description</Label>
              <Textarea id="t-desc" rows={3} value={ticketDesc} onChange={(e) => setTicketDesc(e.target.value)} placeholder="Details…" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending === 'ticket'} onClick={() => setTicketOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'ticket'} onClick={submitTicket}>
              {pending === 'ticket' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Create Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* schedule meeting */}
      <Dialog open={meetOpen} onOpenChange={(o) => { if (pending !== 'meet') setMeetOpen(o) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Video Meeting</DialogTitle>
            <DialogDescription>A Google Meet link is generated automatically if left empty.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-title">Title *</Label>
              <Input id="m-title" value={meetTitle} onChange={(e) => setMeetTitle(e.target.value)} placeholder="e.g. Catalog discussion" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-at">Date & Time *</Label>
              <Input id="m-at" type="datetime-local" value={meetAt} onChange={(e) => setMeetAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-link">Meeting Link</Label>
              <Input id="m-link" value={meetLink} onChange={(e) => setMeetLink(e.target.value)} placeholder="Optional — auto-generated" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending === 'meet'} onClick={() => setMeetOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'meet'} onClick={submitMeeting}>
              {pending === 'meet' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* add document */}
      <Dialog open={docOpen} onOpenChange={(o) => { if (pending !== 'doc') setDocOpen(o) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Document</DialogTitle>
            <DialogDescription>Attach a document link to this lead.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-name">Name *</Label>
              <Input id="d-name" value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="e.g. Signed PI" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger aria-label="Document type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replaceAll('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-url">URL</Label>
              <Input id="d-url" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending === 'doc'} onClick={() => setDocOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={pending === 'doc'} onClick={submitDocument}>
              {pending === 'doc' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
              Add Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
