'use client'

/**
 * WhatsApp Business chat — LIVE integration.
 * - Sends go through the CRM backend → Alendei/FlexiWaba WhatsApp Business API
 *   (never directly from the browser; the API key stays server-side).
 * - Message types: TEXT (24h session window), TEMPLATE (approved, with dynamic
 *   variable inputs), IMAGE / PDF / VIDEO (uploaded via /api/files).
 * - Real-time via socket.io: live message append, delivery/read ticks,
 *   conversation list updates.
 * - Layout: conversations | thread | lead 360 panel (opt-in, agent, source).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCheck,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Phone,
  Search,
  PhoneOutgoing,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Video,
  X,
} from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { formatTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { PageHeader } from '@/components/crm/shared/page-header'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { useMasters } from '@/components/crm/shared/use-masters'
import {
  getCrmSocket,
  subscribeConversation,
  unsubscribeConversation,
  useCrmSocket,
  type WaConversationEvent,
  type WaMessageEvent,
  type WaStatusEvent,
} from '@/hooks/use-crm-socket'

// ---------- types ----------

type LeadInfo = {
  id: string
  leadCode: string
  customerName: string
  department: string
  mobile?: string | null
  whatsapp?: string | null
  optInStatus?: string | null
  waStatus?: string | null
  lastWaMessage?: string | null
  lastWaMessageAt?: string | null
  source?: { label: string } | null
  assignedTo?: { id: string; name: string } | null
}

type Conversation = {
  id: string
  phone: string
  name: string | null
  label: string | null
  dept: string | null
  unreadCount: number
  lastMessage: string | null
  lastMessageAt: string | null
  lastInboundAt?: string | null
  owner: { id: string; name: string } | null
  lead: LeadInfo | null
}

type Message = {
  id: string
  direction: string
  type: string
  body: string | null
  mediaName: string | null
  mediaUrl?: string | null
  status: string
  templateName?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt: string
  user: { id: string; name: string } | null
}

type Template = {
  id: string
  name: string
  category: string
  status: string
  body: string
  language: string
  headerType: string
  variableCount: number
  variables: string | null
  isActive: boolean
}

/** Session window: free-form text allowed within 24h of the last inbound message */
function sessionOpen(conv: Conversation | null): boolean {
  if (!conv?.lastInboundAt) return false
  return Date.now() - new Date(conv.lastInboundAt).getTime() < 24 * 3600 * 1000
}

function OptInBadge({ status }: { status?: string | null }) {
  if (status === 'OPTED_IN') {
    return (
      <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" variant="outline">
        <ShieldCheck className="h-3 w-3" aria-hidden /> Opted In
      </Badge>
    )
  }
  if (status === 'NOT_OPTED_IN') {
    return (
      <Badge className="gap-1 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50" variant="outline">
        <ShieldAlert className="h-3 w-3" aria-hidden /> Not Opted In
      </Badge>
    )
  }
  return (
    <Badge className="gap-1 border-stone-200 bg-stone-50 text-stone-500 hover:bg-stone-50" variant="outline">
      <ShieldQuestion className="h-3 w-3" aria-hidden /> Opt-in Unknown
    </Badge>
  )
}

/** Delivery status ticks for outgoing bubbles (live provider statuses) */
function Ticks({ status, error }: { status: string; error?: string | null }) {
  if (status === 'READ') return <CheckCheck className="h-3.5 w-3.5 text-sky-200" aria-label="Read" />
  if (status === 'DELIVERED') return <CheckCheck className="h-3.5 w-3.5 text-emerald-100" aria-label="Delivered" />
  if (status === 'SENT') return <CheckCheck className="h-3.5 w-3.5 text-white/60" aria-label="Sent" />
  if (status === 'FAILED') {
    return (
      <span title={error ?? 'Message failed'}>
        <X className="h-3.5 w-3.5 text-rose-200" aria-label="Failed" />
      </span>
    )
  }
  return <Clock className="h-3.5 w-3.5 text-white/60" aria-label="Queued" />
}

// ---------- component ----------

export default function WhatsAppView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()
  useCrmSocket() // keeps the singleton socket alive

  const canPickDept = !user?.department
  const isManagement = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER'].includes(user?.role ?? '')

  const [dept, setDept] = useState(user?.department ?? '')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [label, setLabel] = useState('')

  const [convs, setConvs] = useState<Conversation[]>([])
  const [convLoading, setConvLoading] = useState(true)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [threadLoading, setThreadLoading] = useState(false)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [callPending, setCallPending] = useState(false)

  const [templates, setTemplates] = useState<Template[]>([])

  // template dialog state
  const [tplDialogOpen, setTplDialogOpen] = useState(false)
  const [tplSelected, setTplSelected] = useState<Template | null>(null)
  const [tplParams, setTplParams] = useState<string[]>([])

  // media composer state
  const [mediaUploading, setMediaUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const bottomRef = useRef<HTMLDivElement | null>(null)

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 400)
    return () => clearTimeout(t)
  }, [qInput])

  const loadConvs = useCallback(async () => {
    try {
      const res = await api<{ conversations: Conversation[] }>(
        `/api/whatsapp/conversations${qs({ dept: dept || undefined, q: q || undefined, label: label || undefined })}`
      )
      setConvs(res.conversations ?? [])
    } catch (e) {
      toast({ title: 'Failed to load conversations', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setConvLoading(false)
    }
  }, [dept, q, label, toast])

  const refreshThread = useCallback(
    async (conversationId: string) => {
      try {
        const res = await api<{ messages: Message[]; conversation: Conversation }>(
          `/api/whatsapp/messages${qs({ conversationId })}`
        )
        setMessages(res.messages ?? [])
        setActiveConv(res.conversation)
      } catch (e) {
        toast({ title: 'Failed to load messages', description: (e as Error).message, variant: 'destructive' })
      }
    },
    [toast]
  )

  const openConv = useCallback(
    async (c: Conversation) => {
      setActiveId(c.id)
      setActiveConv(c)
      setMessages([])
      setThreadLoading(true)
      setDraft('')
      await refreshThread(c.id)
      setThreadLoading(false)
    },
    [refreshThread]
  )

  // initial + filter-driven load, then poll conversations every 15s as fallback
  useEffect(() => {
    loadConvs()
    const t = setInterval(loadConvs, 15000)
    return () => clearInterval(t)
  }, [loadConvs])

  // join the live room for the open conversation
  useEffect(() => {
    if (!activeId) return
    subscribeConversation(activeId)
    return () => unsubscribeConversation(activeId)
  }, [activeId])

  // real-time events
  useEffect(() => {
    const s = getCrmSocket()

    const onNewMessage = (data: WaMessageEvent) => {
      if (!data?.message) return
      if (data.conversationId === activeId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev
          return [...prev, data.message as Message]
        })
        // mark read for the viewer
        api('/api/whatsapp/messages', { method: 'PATCH', body: { conversationId: activeId, action: 'mark_read' } }).catch(() => {})
      }
      void loadConvs()
    }

    const onStatus = (data: WaStatusEvent) => {
      if (!data?.messageId) return
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, status: data.status } : m))
      )
    }

    const onConversation = (_data: WaConversationEvent) => {
      void loadConvs()
    }

    s.on('whatsapp:new-message', onNewMessage)
    s.on('whatsapp:status', onStatus)
    s.on('whatsapp:conversation', onConversation)
    return () => {
      s.off('whatsapp:new-message', onNewMessage)
      s.off('whatsapp:status', onStatus)
      s.off('whatsapp:conversation', onConversation)
    }
  }, [activeId, loadConvs])

  // fallback thread refresh every 20s (in case socket is down)
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(() => {
      void refreshThread(activeId)
    }, 20000)
    return () => clearInterval(t)
  }, [activeId, refreshThread])

  // auto-select the first conversation on load
  useEffect(() => {
    if (!activeId && convs.length > 0 && !threadLoading) void openConv(convs[0])
  }, [convs, activeId, threadLoading, openConv])

  // auto-scroll to the newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, threadLoading])

  // approved + active templates for the active department
  const tplDept = activeConv?.dept ?? user?.department ?? undefined
  useEffect(() => {
    api<{ templates: Template[] }>(`/api/whatsapp/templates${qs({ dept: tplDept })}`)
      .then((res) => setTemplates(res.templates ?? []))
      .catch(() => setTemplates([]))
  }, [tplDept])

  const labelOptions = useMemo(() => masters.items('conversation_label'), [masters])
  const activeLead = activeConv?.lead ?? null
  const textAllowed = sessionOpen(activeConv)

  // ---------- actions ----------

  const send = async (payload: Record<string, unknown>) => {
    if (!activeId) return
    setSending(true)
    try {
      await api('/api/whatsapp/messages', { method: 'POST', body: { conversationId: activeId, ...payload } })
      await refreshThread(activeId)
      void loadConvs()
      return true
    } catch (e) {
      // 422 errors carry readable, actionable messages from the backend
      toast({ title: 'Message not sent', description: (e as Error).message, variant: 'destructive' })
      return false
    } finally {
      setSending(false)
    }
  }

  const sendText = async () => {
    const text = draft.trim()
    if (!text || sending) return
    const ok = await send({ body: text, type: 'TEXT' })
    if (ok) setDraft('')
  }

  const openTemplateDialog = () => {
    const approved = templates.filter((t) => t.status === 'APPROVED' && t.isActive)
    if (approved.length === 0) {
      toast({
        title: 'No approved templates',
        description: 'Only APPROVED, active templates can be sent. Create/sync them in WhatsApp Templates.',
        variant: 'destructive',
      })
      return
    }
    setTplSelected(approved[0])
    setTplParams(new Array(approved[0].variableCount).fill(''))
    setTplDialogOpen(true)
  }

  const pickTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id) ?? null
    setTplSelected(t)
    setTplParams(t ? new Array(t.variableCount).fill('') : [])
  }

  const sendTemplateConfirmed = async () => {
    if (!tplSelected || !activeId) return
    if (tplSelected.variableCount > 0 && tplParams.some((p) => !p.trim())) {
      toast({ title: 'Fill all template variables', description: 'Alendei rejects requests where the parameter count/values do not match the template.', variant: 'destructive' })
      return
    }
    const ok = await send({
      type: 'TEMPLATE',
      templateId: tplSelected.id,
      templateParams: tplParams.map((p) => p.trim()),
      body: tplSelected.body.replace(/\{\{\d+\}\}/g, () => '').trim() || undefined,
    })
    if (ok) {
      setTplDialogOpen(false)
      setTplSelected(null)
      setTplParams([])
    }
  }

  const templatePreview = useMemo(() => {
    if (!tplSelected) return ''
    let i = 0
    return tplSelected.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
      void n
      const v = tplParams[i]?.trim()
      i++
      return v ? v : `{{${i}}}`
    })
  }, [tplSelected, tplParams])

  const onMediaPicked = async (file: File | null) => {
    if (!file || !activeId) return
    const mime = file.type
    let type: 'IMAGE' | 'PDF' | 'VIDEO'
    if (mime.startsWith('image/')) type = 'IMAGE'
    else if (mime === 'application/pdf') type = 'PDF'
    else if (mime.startsWith('video/')) type = 'VIDEO'
    else {
      toast({ title: 'Unsupported file', description: 'Only images, PDF and video can be sent on WhatsApp.', variant: 'destructive' })
      return
    }
    setMediaUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const up = await api<{ id: string; filename: string }>('/api/files', { method: 'POST', body: form })
      await send({ type, mediaAssetId: up.id, body: draft.trim() || undefined })
      setDraft('')
    } catch (e) {
      toast({ title: 'Media upload failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setMediaUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const startCall = async () => {
    if (!activeLead || callPending) return
    setCallPending(true)
    try {
      const res = await api<{ ok: boolean; callId: string; detail?: string }>('/api/calls/click-to-call', {
        method: 'POST',
        body: { leadId: activeLead.id },
      })
      toast({ title: 'Dialing…', description: res.detail ?? 'Call started — status updates live' })
    } catch (e) {
      toast({ title: 'Call failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCallPending(false)
    }
  }

  const toggleOptIn = async () => {
    if (!activeLead) return
    const next = activeLead.optInStatus === 'OPTED_IN' ? 'NOT_OPTED_IN' : 'OPTED_IN'
    try {
      await api('/api/leads/optin', { method: 'PATCH', body: { leadId: activeLead.id, optInStatus: next } })
      toast({ title: `Opt-in set to ${next.replace(/_/g, ' ').toLowerCase()}` })
      void refreshThread(activeId!)
    } catch (e) {
      toast({ title: 'Could not update opt-in', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // ---------- render ----------

  return (
    <div>
      <PageHeader
        title="WhatsApp Business"
        subtitle="Live WhatsApp Business API conversations — replies, approved templates and media, all on the lead record"
      />

      <div className="flex h-auto flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:h-[calc(100vh-220px)] lg:flex-row">
        {/* Left: conversation list */}
        <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 lg:max-w-xs lg:border-b-0 lg:border-r">
          <div className="space-y-2 border-b border-stone-100 p-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
                aria-hidden
              />
              <Input
                className="pl-8"
                placeholder="Search name or number..."
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                aria-label="Search conversations"
              />
            </div>
            <div className="flex gap-2">
              <Select value={label} onValueChange={setLabel}>
                <SelectTrigger className="h-9 flex-1" aria-label="Filter by label">
                  <SelectValue placeholder="All labels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All labels</SelectItem>
                  {labelOptions.map((l) => (
                    <SelectItem key={l.id} value={l.label}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canPickDept ? (
                <Select value={dept} onValueChange={setDept}>
                  <SelectTrigger className="h-9 w-28" aria-label="Department">
                    <SelectValue placeholder="All depts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All depts</SelectItem>
                    <SelectItem value="ONLINE">Online</SelectItem>
                    <SelectItem value="EXPORT">Export</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>

          <div className="max-h-72 flex-1 overflow-y-auto lg:max-h-none">
            {convLoading && convs.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-stone-100 p-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))
            ) : convs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                <MessageSquare className="h-6 w-6 text-stone-300" aria-hidden />
                <p className="text-sm font-medium text-stone-600">No conversations</p>
                <p className="text-xs text-stone-400">
                  Chats appear automatically when a customer messages your WhatsApp Business number.
                </p>
              </div>
            ) : (
              convs.map((c) => {
                const active = c.id === activeId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void openConv(c)}
                    className={cn(
                      'flex w-full items-center gap-3 border-b border-stone-100 p-3 text-left transition-colors hover:bg-stone-50',
                      active && 'bg-emerald-50 hover:bg-emerald-50'
                    )}
                    aria-current={active ? 'true' : undefined}
                  >
                    <UserAvatar name={c.name ?? c.phone} className="h-10 w-10" online={c.unreadCount > 0} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold text-stone-800">{c.name ?? c.phone}</p>
                        <span className="ml-auto shrink-0 text-[10px] text-stone-400">{timeAgo(c.lastMessageAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <p className={cn('truncate text-xs', c.unreadCount > 0 ? 'font-medium text-stone-700' : 'text-stone-500')}>
                          {c.lastMessage ?? 'No messages yet'}
                        </p>
                        {c.unreadCount > 0 ? (
                          <Badge className="ml-auto h-5 shrink-0 rounded-full bg-emerald-600 px-1.5 text-[10px] text-white hover:bg-emerald-600">
                            {c.unreadCount}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1">
                        {c.lead ? (
                          <span className="font-mono text-[10px] text-stone-400">{c.lead.leadCode}</span>
                        ) : (
                          <span className="text-[10px] text-stone-300">no lead linked</span>
                        )}
                        {c.lead?.optInStatus === 'OPTED_IN' ? (
                          <ShieldCheck className="h-3 w-3 text-emerald-500" aria-label="Opted in" />
                        ) : null}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* Center: chat thread */}
        <section className="flex min-h-[480px] min-w-0 flex-1 flex-col lg:min-h-0">
          {!activeConv ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="max-w-sm text-center">
                <MessageSquare className="mx-auto h-8 w-8 text-stone-300" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-stone-700">Select a conversation</p>
                <p className="mt-1 text-xs text-stone-500">
                  Pick a chat on the left to view the live WhatsApp thread and reply.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* thread header */}
              <header className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50/80 p-3">
                <UserAvatar name={activeConv.name ?? activeConv.phone} className="h-9 w-9" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900">{activeConv.name ?? activeConv.phone}</p>
                  <div className="flex items-center gap-1.5 text-xs text-stone-500">
                    <span className="font-mono">{activeConv.phone}</span>
                    {activeConv.owner ? <span>· Owner: {activeConv.owner.name}</span> : null}
                    {activeConv.dept ? <StatusBadge status={activeConv.dept} variant="dept" className="h-4 text-[10px]" /> : null}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  {activeLead ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="hidden md:inline-flex"
                        onClick={() => setView('lead-detail', { leadId: activeLead.id })}
                      >
                        <ExternalLink className="mr-1 h-3.5 w-3.5" /> Lead 360
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="Call via dialer"
                        title="Click-to-call via SIP dialer"
                        disabled={callPending}
                        onClick={() => void startCall()}
                      >
                        <Phone className={cn('h-3.5 w-3.5', callPending && 'animate-pulse')} />
                      </Button>
                    </>
                  ) : null}
                </div>
              </header>

              {/* messages */}
              <div className="flex-1 overflow-y-auto bg-stone-100/70 p-3 md:p-4" style={{ minHeight: 0 }}>
                {threadLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className={cn('h-10 w-2/3', i % 2 ? 'ml-auto' : '')} />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="rounded-full bg-white px-4 py-1.5 text-xs text-stone-500 shadow-sm">
                      No messages in this conversation yet
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {messages.map((m) => {
                      const out = m.direction === 'OUT'
                      return (
                        <div key={m.id} className={cn('flex', out ? 'justify-end' : 'justify-start')}>
                          <div
                            className={cn(
                              'max-w-[78%] rounded-xl px-3 py-2 text-sm shadow-sm md:max-w-[65%]',
                              out ? 'rounded-br-sm bg-emerald-600 text-white' : 'rounded-bl-sm border border-stone-200 bg-white text-stone-800'
                            )}
                          >
                            {m.templateName ? (
                              <p
                                className={cn(
                                  'mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                  out ? 'bg-white/15 text-emerald-50' : 'bg-stone-100 text-stone-500'
                                )}
                              >
                                Template · {m.templateName}
                              </p>
                            ) : m.type !== 'TEXT' ? (
                              <p
                                className={cn(
                                  'mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                  out ? 'bg-white/15 text-emerald-50' : 'bg-stone-100 text-stone-500'
                                )}
                              >
                                {m.type}
                              </p>
                            ) : null}
                            {m.mediaUrl && m.type === 'IMAGE' ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={m.mediaUrl}
                                alt={m.mediaName ?? 'WhatsApp image'}
                                className="mb-1 max-h-64 rounded-lg border border-white/20 object-cover"
                              />
                            ) : null}
                            {m.mediaUrl && (m.type === 'PDF' || m.type === 'VIDEO') ? (
                              <a
                                href={m.mediaUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={cn(
                                  'mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs underline-offset-2',
                                  out ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'
                                )}
                              >
                                {m.type === 'PDF' ? <FileText className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                                <span className="truncate">{m.mediaName ?? m.type}</span>
                              </a>
                            ) : null}
                            {m.body ? (
                              <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>
                            ) : !m.mediaUrl && m.mediaName ? (
                              <p className="break-words underline decoration-dotted">{m.mediaName}</p>
                            ) : null}
                            <p
                              className={cn(
                                'mt-0.5 flex items-center justify-end gap-1 text-[10px]',
                                out ? 'text-emerald-100/80' : 'text-stone-400'
                              )}
                            >
                              <span>{formatTime(m.createdAt)}</span>
                              {out ? <Ticks status={m.status} error={m.errorMessage} /> : null}
                            </p>
                            {m.status === 'FAILED' && m.errorMessage ? (
                              <p className="mt-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-100">
                                {m.errorMessage}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>

              {/* composer */}
              <footer className="border-t border-stone-200 bg-white p-3">
                {!textAllowed ? (
                  <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
                    24-hour session window is closed for this contact — free-form text is disabled. Use an
                    <button type="button" className="mx-1 font-semibold underline" onClick={openTemplateDialog}>
                      approved template
                    </button>
                    instead (requires customer opt-in). This is a WhatsApp Business policy requirement.
                  </p>
                ) : null}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,video/mp4,video/webm"
                    className="hidden"
                    onChange={(e) => void onMediaPicked(e.target.files?.[0] ?? null)}
                    aria-label="Attach media file"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Attach media"
                    className="h-10 w-10 shrink-0 text-stone-500"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending || mediaUploading}
                  >
                    {mediaUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0 text-xs"
                    onClick={openTemplateDialog}
                    disabled={sending}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" /> Template
                  </Button>
                  <Textarea
                    rows={1}
                    className="max-h-32 min-h-10 flex-1 resize-none"
                    placeholder={
                      textAllowed
                        ? 'Type a message... (Enter to send, Shift+Enter for a new line)'
                        : 'Session window closed — use an approved template'
                    }
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void sendText()
                      }
                    }}
                    aria-label="Message"
                  />
                  <Button
                    type="button"
                    size="icon"
                    className="h-10 w-10 shrink-0 bg-emerald-600 hover:bg-emerald-700"
                    aria-label="Send message"
                    onClick={() => void sendText()}
                    disabled={sending || !draft.trim() || !textAllowed}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>

        {/* Right: lead 360 panel */}
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-stone-200 bg-stone-50/60 p-4 xl:flex">
          {activeLead ? (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Lead</p>
                <button
                  type="button"
                  className="mt-1 block text-left text-sm font-semibold text-emerald-700 hover:underline"
                  onClick={() => setView('lead-detail', { leadId: activeLead.id })}
                >
                  {activeLead.customerName}
                </button>
                <p className="font-mono text-[11px] text-stone-400">{activeLead.leadCode}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Contact</p>
                <p className="mt-1 font-mono text-xs text-stone-700">{activeLead.mobile ?? activeLead.whatsapp ?? activeConv?.phone}</p>
                {activeLead.waStatus ? (
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    WhatsApp: {activeLead.waStatus.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                ) : null}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">WhatsApp opt-in</p>
                <div className="mt-1 flex items-center gap-2">
                  <OptInBadge status={activeLead.optInStatus} />
                  {isManagement ? (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => void toggleOptIn()}>
                      toggle
                    </Button>
                  ) : null}
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-stone-400">
                  Business-initiated templates are blocked without opt-in.
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Assignment</p>
                <p className="mt-1 text-xs text-stone-700">{activeLead.assignedTo?.name ?? 'Unassigned'}</p>
                {activeLead.source ? <p className="text-[11px] text-stone-500">Source: {activeLead.source.label}</p> : null}
                {activeLead.department ? <StatusBadge status={activeLead.department} variant="dept" className="mt-1" /> : null}
              </div>
              {activeLead.lastWaMessage ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Last WhatsApp</p>
                  <p className="mt-1 line-clamp-3 rounded-lg border border-stone-200 bg-white p-2 text-[11px] text-stone-600">
                    {activeLead.lastWaMessage}
                  </p>
                  {activeLead.lastWaMessageAt ? (
                    <p className="mt-0.5 text-[10px] text-stone-400">{timeAgo(activeLead.lastWaMessageAt)}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-1.5 border-t border-stone-200 pt-3">
                <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setView('lead-detail', { leadId: activeLead.id })}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Open Customer 360
                </Button>
                <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => void startCall()} disabled={callPending}>
                  <PhoneOutgoing className="mr-2 h-3.5 w-3.5" /> Call this lead
                </Button>
                <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setView('dialer')}>
                  <Phone className="mr-2 h-3.5 w-3.5" /> Open dialer
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-stone-600">No lead linked</p>
              <p className="text-xs text-stone-500">
                This conversation has no CRM lead yet. Open the thread and the lead will be auto-created from the
                customer&apos;s WhatsApp number (source: WhatsApp).
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Template send dialog with dynamic variable inputs */}
      <Dialog open={tplDialogOpen} onOpenChange={setTplDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">Send approved template</DialogTitle>
            <DialogDescription>
              Variables are filled per Alendei&apos;s rule: the parameter count must match the template exactly.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-select">Template (APPROVED only)</Label>
              <Select value={tplSelected?.id ?? ''} onValueChange={pickTemplate}>
                <SelectTrigger id="tpl-select">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates
                    .filter((t) => t.status === 'APPROVED' && t.isActive)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t.language}
                        {t.variableCount > 0 ? ` · ${t.variableCount} vars` : ''})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {tplSelected && tplSelected.variableCount > 0 ? (
              <div className="space-y-2">
                {(tplSelected.variables ? (JSON.parse(tplSelected.variables) as string[]) : []).map((lbl, i) =>
                  i < tplSelected.variableCount ? (
                    <div key={`lbl-${i}`} className="text-[11px] text-stone-400">
                      Variable {i + 1}: {lbl || 'value'}
                    </div>
                  ) : null
                )}
                {Array.from({ length: tplSelected.variableCount }).map((_, i) => (
                  <div key={`param-${i}`} className="space-y-1">
                    <Label htmlFor={`param-${i}`} className="text-xs">
                      Variable {i + 1}
                    </Label>
                    <Input
                      id={`param-${i}`}
                      value={tplParams[i] ?? ''}
                      onChange={(e) =>
                        setTplParams((prev) => {
                          const next = [...prev]
                          next[i] = e.target.value
                          return next
                        })
                      }
                      placeholder={
                        (tplSelected.variables ? (JSON.parse(tplSelected.variables) as string[]) : [])[i] || `Value {{${i + 1}}}`
                      }
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {tplSelected ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Preview</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-emerald-900">{templatePreview || tplSelected.body}</p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTplDialogOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void sendTemplateConfirmed()} disabled={sending || !tplSelected}>
              {sending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Send via WhatsApp API
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
