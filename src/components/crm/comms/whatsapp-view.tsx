'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  Loader2,
  MessageSquare,
  MoreVertical,
  Paperclip,
  Phone,
  Search,
  Send,
  Video,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
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

// ---------- types ----------

type Conversation = {
  id: string
  phone: string
  name: string | null
  label: string | null
  dept: string | null
  unreadCount: number
  lastMessage: string | null
  lastMessageAt: string | null
  owner: { id: string; name: string } | null
  lead: { id: string; leadCode: string; customerName: string; department: string } | null
}

type Message = {
  id: string
  direction: string
  type: string
  body: string | null
  mediaName: string | null
  status: string
  createdAt: string
  user: { id: string; name: string } | null
}

type Template = { id: string; name: string; category: string; body: string; dept: string | null }

/** Delivery status ticks for outgoing bubbles */
function Ticks({ status }: { status: string }) {
  if (status === 'READ') return <span className="text-[10px] font-bold tracking-tighter text-emerald-200">✓✓</span>
  if (status === 'DELIVERED') return <span className="text-[10px] tracking-tighter text-stone-200">✓✓</span>
  if (status === 'FAILED') return <span className="text-[10px] text-rose-200">!</span>
  return <span className="text-[10px] text-white/70">✓</span>
}

// ---------- component ----------

export default function WhatsAppView() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const { toast } = useToast()
  const masters = useMasters()

  const canPickDept = !user?.department // SUPER_ADMIN / ADMIN see both departments

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

  // initial + filter-driven load, then poll conversations every 8s
  useEffect(() => {
    loadConvs()
    const t = setInterval(loadConvs, 8000)
    return () => clearInterval(t)
  }, [loadConvs])

  // poll the open thread every 8s (also marks incoming as read for the owner)
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(() => {
      api<{ messages: Message[]; conversation: Conversation }>(`/api/whatsapp/messages${qs({ conversationId: activeId })}`)
        .then((res) => {
          setMessages(res.messages ?? [])
          setActiveConv(res.conversation)
        })
        .catch(() => {})
    }, 8000)
    return () => clearInterval(t)
  }, [activeId])

  // auto-select the first conversation on load
  useEffect(() => {
    if (!activeId && convs.length > 0 && !threadLoading) void openConv(convs[0])
  }, [convs, activeId, threadLoading, openConv])

  // auto-scroll to the newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, threadLoading])

  // templates for the active department
  const tplDept = activeConv?.dept ?? user?.department ?? undefined
  useEffect(() => {
    api<{ templates: Template[] }>(`/api/whatsapp/templates${qs({ dept: tplDept })}`)
      .then((res) => setTemplates(res.templates ?? []))
      .catch(() => setTemplates([]))
  }, [tplDept])

  const labelOptions = useMemo(() => masters.items('conversation_label'), [masters])
  const activeLead = activeConv?.lead ?? null

  // ---------- actions ----------

  const send = async (payload: { body?: string; type?: string; mediaName?: string; templateId?: string }) => {
    if (!activeId) return
    setSending(true)
    try {
      await api('/api/whatsapp/messages', { method: 'POST', body: { conversationId: activeId, ...payload } })
      setDraft('')
      await refreshThread(activeId)
      void loadConvs()
    } catch (e) {
      toast({ title: 'Failed to send message', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  const sendText = () => {
    const text = draft.trim()
    if (!text || sending) return
    void send({ body: text, type: 'TEXT' })
  }

  const attachMedia = () => {
    if (!activeId || sending) return
    const name = window.prompt('Media file name (e.g. catalogue-jan.pdf or saree-photo.png)')
    const trimmed = name?.trim()
    if (!trimmed) return
    const type = trimmed.toLowerCase().endsWith('.pdf') ? 'PDF' : 'IMAGE'
    void send({ type, mediaName: trimmed })
  }

  const sendTemplate = (templateId: string) => {
    if (!activeId || sending || !templateId) return
    void send({ templateId })
  }

  const demoAction = async (action: 'simulate_reply' | 'advance_status') => {
    if (!activeId) return
    try {
      const res = await api<{ message?: Message; updated?: boolean }>('/api/whatsapp/messages', {
        method: 'PATCH',
        body: { conversationId: activeId, action },
      })
      if (action === 'simulate_reply') toast({ title: 'Customer reply simulated (demo)' })
      else toast({ title: res.updated ? 'Delivery status advanced (demo)' : 'No pending message to advance (demo)' })
      await refreshThread(activeId)
      void loadConvs()
    } catch (e) {
      toast({ title: 'Demo action failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const logCall = async (isVideo: boolean) => {
    if (!activeConv?.lead || callPending) return
    setCallPending(true)
    try {
      await api('/api/calls', {
        method: 'POST',
        body: {
          leadId: activeConv.lead.id,
          direction: 'OUTGOING',
          status: 'CONNECTED',
          durationSec: 0,
          isVideo,
          channel: 'WHATSAPP',
        },
      })
      toast({ title: isVideo ? 'Video call logged' : 'Voice call logged', description: 'Call record created via WhatsApp' })
    } catch (e) {
      toast({ title: 'Failed to log call', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCallPending(false)
    }
  }

  // ---------- render ----------

  return (
    <div>
      <PageHeader
        title="WhatsApp Business"
        subtitle="Chat with customers, reply with templates and keep every conversation on the lead record"
      />

      <div className="flex h-auto flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:h-[calc(100vh-220px)] lg:flex-row">
        {/* Left: conversation list */}
        <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 lg:max-w-sm lg:border-b-0 lg:border-r">
          <div className="space-y-2 border-b border-stone-100 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
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
                <p className="text-xs text-stone-400">Chats appear here when customers message you or a broadcast goes out.</p>
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
                        {c.label ? (
                          <Badge variant="outline" className="h-4 border-emerald-200 bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                            {c.label}
                          </Badge>
                        ) : null}
                        {c.lead ? (
                          <span className="font-mono text-[10px] text-stone-400">{c.lead.leadCode}</span>
                        ) : (
                          <span className="text-[10px] text-stone-300">no lead linked</span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* Right: chat thread */}
        <section className="flex min-h-[480px] min-w-0 flex-1 flex-col lg:min-h-0">
          {!activeConv ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="max-w-sm text-center">
                <MessageSquare className="mx-auto h-8 w-8 text-stone-300" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-stone-700">Select a conversation</p>
                <p className="mt-1 text-xs text-stone-500">
                  Pick a chat on the left to view the full WhatsApp thread and reply.
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
                  {activeConv.label ? (
                    <Badge variant="outline" className="hidden border-emerald-200 bg-emerald-50 text-emerald-700 sm:inline-flex">
                      {activeConv.label}
                    </Badge>
                  ) : null}
                  {activeLead ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="hidden md:inline-flex"
                        onClick={() => setView('lead-detail', { leadId: activeLead.id })}
                      >
                        <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open Lead
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="Log voice call"
                        disabled={callPending}
                        onClick={() => void logCall(false)}
                      >
                        <Phone className={cn('h-3.5 w-3.5', callPending && 'animate-pulse')} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="Log video call"
                        disabled={callPending}
                        onClick={() => void logCall(true)}
                      >
                        <Video className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label="More actions">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      {activeLead ? (
                        <DropdownMenuItem onClick={() => setView('lead-detail', { leadId: activeLead.id })}>
                          <ExternalLink className="mr-2 h-3.5 w-3.5" /> Open Lead
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] text-stone-400">Demo tools</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => void demoAction('simulate_reply')}>
                        Simulate Customer Reply (Demo)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void demoAction('advance_status')}>
                        Advance Delivery Status (Demo)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                            {m.type !== 'TEXT' ? (
                              <p
                                className={cn(
                                  'mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                  out ? 'bg-white/15 text-emerald-50' : 'bg-stone-100 text-stone-500'
                                )}
                              >
                                {m.type}
                                {m.mediaName ? <span className="font-normal normal-case">· {m.mediaName}</span> : null}
                              </p>
                            ) : null}
                            {m.body ? (
                              <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>
                            ) : m.mediaName ? (
                              <p className="break-words underline decoration-dotted">{m.mediaName}</p>
                            ) : null}
                            <p
                              className={cn(
                                'mt-0.5 flex items-center justify-end gap-1 text-[10px]',
                                out ? 'text-emerald-100/80' : 'text-stone-400'
                              )}
                            >
                              <span>{formatTime(m.createdAt)}</span>
                              {out ? <Ticks status={m.status} /> : null}
                            </p>
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
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Attach media"
                    className="h-10 w-10 shrink-0 text-stone-500"
                    onClick={attachMedia}
                    disabled={sending}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Select value="" onValueChange={(v) => sendTemplate(v)}>
                    <SelectTrigger className="h-10 w-[130px] shrink-0 text-xs" aria-label="Send a template">
                      <SelectValue placeholder="Template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-stone-500">No templates available</div>
                      ) : (
                        templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Textarea
                    rows={1}
                    className="max-h-32 min-h-10 flex-1 resize-none"
                    placeholder="Type a message... (Enter to send, Shift+Enter for a new line)"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendText()
                      }
                    }}
                    aria-label="Message"
                  />
                  <Button
                    type="button"
                    size="icon"
                    className="h-10 w-10 shrink-0 bg-emerald-600 hover:bg-emerald-700"
                    aria-label="Send message"
                    onClick={sendText}
                    disabled={sending || !draft.trim()}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
