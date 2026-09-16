'use client'

/**
 * Global incoming-call popup. Mounted once in crm-app for signed-in users.
 * Consumes socket.io events:
 *  - 'call:incoming' → shows the dialog with caller info (or "New Caller")
 *  - 'call:update'   → keeps the shared activeCall store in sync
 *  - 'notification'  → toasts real-time notifications
 */

import { useCallback, useEffect, useState } from 'react'
import { PhoneIncoming, UserPlus, UserX, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { getCrmSocket, useCrmSocket, type CallIncomingEvent, type CallUpdateEvent, type NotificationEvent } from '@/hooks/use-crm-socket'
import LeadFormDialog from '@/components/crm/leads/lead-form-dialog'
import { StatusBadge } from '@/components/crm/shared/status-badge'
import { DEPT_LABELS } from '@/lib/constants'

const DISMISSED_KEY = 'af-crm-dismissed-call'

export default function IncomingCallPopup() {
  // holding this hook keeps the singleton socket alive app-wide while logged in
  useCrmSocket()
  const { toast } = useToast()
  const setView = useAppStore((s) => s.setView)
  const setActiveCall = useAppStore((s) => s.setActiveCall)
  const patchActiveCall = useAppStore((s) => s.patchActiveCall)

  const [incoming, setIncoming] = useState<CallIncomingEvent | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  // ---- socket event subscriptions ----
  useEffect(() => {
    const s = getCrmSocket()

    const onIncoming = (data: CallIncomingEvent) => {
      if (!data?.callId) return
      setIncoming(data)
      setActiveCall({
        callId: data.callId,
        callStatus: 'RINGING',
        customerNumber: data.customerNumber ?? null,
        known: data.known,
        lead: data.lead ?? null,
        agentExtension: data.agentExtension ?? null,
      })
      toast({ title: 'Incoming call', description: data.customerNumber ?? 'Unknown number' })
    }

    const onUpdate = (data: CallUpdateEvent) => {
      patchActiveCall({ callId: data.callId, callStatus: data.callStatus, answerAt: data.answerAt ?? null })
    }

    const onNotification = (data: NotificationEvent) => {
      if (!data?.title) return
      toast({ title: data.title, description: data.body || undefined })
    }

    s.on('call:incoming', onIncoming)
    s.on('call:update', onUpdate)
    s.on('notification', onNotification)
    return () => {
      s.off('call:incoming', onIncoming)
      s.off('call:update', onUpdate)
      s.off('notification', onNotification)
    }
  }, [setActiveCall, patchActiveCall, toast])

  const dismiss = useCallback(() => {
    if (incoming) {
      try {
        window.sessionStorage.setItem(DISMISSED_KEY, incoming.callId)
      } catch {
        // sessionStorage unavailable — ignore
      }
    }
    setIncoming(null)
  }, [incoming])

  // Close the popup automatically once the call is over
  useEffect(() => {
    if (!incoming) return
    const active = useAppStore.getState().activeCall
    if (active && active.callId === incoming.callId && ['COMPLETED', 'FAILED', 'MISSED'].includes(active.callStatus ?? '')) {
      const t = setTimeout(() => dismiss(), 0)
      return () => clearTimeout(t)
    }
  }, [incoming, dismiss])

  const lead = incoming?.lead ?? null

  return (
    <>
      <Dialog open={!!incoming} onOpenChange={(open) => { if (!open) dismiss() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <span className="relative flex h-3 w-3" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              Incoming Call
            </DialogTitle>
            <DialogDescription>
              {incoming?.agentExtension ? `Ringing agent extension ${incoming.agentExtension}` : 'A customer is calling the sales line'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <PhoneIncoming className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-base font-semibold text-stone-900">{incoming?.customerNumber ?? 'Unknown number'}</p>
                {lead ? (
                  <p className="truncate text-xs text-stone-500">
                    {lead.leadCode} · {lead.customerName}
                  </p>
                ) : (
                  <p className="text-xs text-stone-500">No matching lead in the CRM</p>
                )}
              </div>
              <Badge variant="outline" className={lead ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>
                {lead ? 'Known Caller' : 'New Caller'}
              </Badge>
            </div>

            {lead ? (
              <div className="rounded-xl border border-stone-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={lead.department} variant="dept" />
                  {lead.source ? <Badge variant="outline">{lead.source}</Badge> : null}
                  {lead.assignedTo ? <Badge variant="outline" className="border-stone-200 text-stone-600">Owner: {lead.assignedTo}</Badge> : null}
                </div>
                <p className="mt-2 text-xs text-stone-500">
                  {DEPT_LABELS[lead.department] ?? lead.department} department
                  {lead.mobile ? ` · ${lead.mobile}` : ''}
                </p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => { dismiss(); setView('lead-detail', { leadId: lead.id }) }}>
                  Open Lead Record
                </Button>
              </div>
            ) : (
              <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <UserX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                This number is not linked to any lead yet. Create a lead so the conversation history is captured.
              </p>
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={dismiss} aria-label="Dismiss incoming call popup">
              <X className="mr-1 h-4 w-4" aria-hidden /> Dismiss
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => {
                setCreateOpen(true)
              }}
              disabled={!!lead}
              title={lead ? 'A lead already exists for this number' : 'Create a lead for this number'}
            >
              <UserPlus className="mr-1 h-4 w-4" aria-hidden /> Create Lead
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* create-lead dialog prefilled with the caller's number */}
      <LeadFormDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) dismiss()
        }}
        initialMobile={incoming?.customerNumber ?? undefined}
        onSaved={() => {
          toast({ title: 'Lead created', description: 'The caller can now be tracked end-to-end.' })
          dismiss()
          setView('leads')
        }}
      />
    </>
  )
}
