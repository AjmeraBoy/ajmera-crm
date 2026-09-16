'use client'

import { useState, type FormEvent } from 'react'
import {
  CalendarClock,
  Database,
  IndianRupee,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  PhoneCall,
  Target,
  Workflow,
} from 'lucide-react'
import { api, setAuthToken } from '@/lib/client'
import type { UserInfo } from '@/types/crm'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DEMO_ACCOUNTS: Array<{ label: string; email: string }> = [
  { label: 'Super Admin', email: 'superadmin@ajmera.com' },
  { label: 'Admin', email: 'admin@ajmera.com' },
  { label: 'Manager', email: 'manager.online@ajmera.com' },
  { label: 'Export Manager', email: 'manager.export@ajmera.com' },
  { label: 'Team Leader', email: 'tl.online@ajmera.com' },
  { label: 'Export TL', email: 'tl.export@ajmera.com' },
  { label: 'Executive', email: 'exec.online1@ajmera.com' },
  { label: 'Export Exec', email: 'exec.export1@ajmera.com' },
  { label: 'Accounts', email: 'accounts@ajmera.com' },
  { label: 'Dispatch', email: 'dispatch@ajmera.com' },
  { label: 'Support', email: 'support@ajmera.com' },
]

const FEATURES = [
  { icon: Workflow, title: 'Lead-to-Dispatch Workflow', desc: 'One pipeline from enquiry to delivery door' },
  { icon: PhoneCall, title: 'Sticky Calling + WhatsApp', desc: 'Ownership locking, dialer & chat in one place' },
  { icon: Target, title: 'Targets & Performance', desc: 'Monthly targets with live achievement tracking' },
  { icon: Database, title: 'Dynamic Master Data', desc: 'Stages, dispositions & geo fully configurable' },
]

export default function LoginView() {
  const setUser = useAppStore((s) => s.setUser)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api<{ token?: string; user: UserInfo }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      // Store the Bearer token so the session survives in cookie-blocked
      // contexts (cross-site preview iframe) and re-auths after reload.
      setAuthToken(res.token ?? null)
      setUser(res.user)
    } catch (err) {
      setError((err as Error).message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-700 to-teal-800 p-10 text-white lg:flex xl:p-14">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-lg font-bold backdrop-blur">
              AF
            </div>
            <div>
              <p className="text-lg font-semibold">Ajmera Fashion Limited</p>
              <p className="text-sm text-emerald-100/80">In-House CRM</p>
            </div>
          </div>
          <h1 className="mt-14 max-w-md text-3xl font-bold leading-tight xl:text-4xl">
            Unified CRM for Online &amp; Export Departments
          </h1>
          <p className="mt-3 max-w-md text-sm text-emerald-100/90">
            India B2B + 32 export countries — leads, telecalling, WhatsApp, quotations, dispatch &amp; support in a single workspace.
          </p>
        </div>
        <ul className="space-y-4">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-start gap-3">
              <span className="mt-0.5 rounded-lg bg-white/15 p-2" aria-hidden>
                <f.icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-xs text-emerald-100/80">{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-emerald-100/60">
          {new Date().getFullYear()} © Ajmera Fashion Limited — Surat, Gujarat, India
        </p>
      </div>

      {/* Right login card */}
      <div className="flex w-full items-center justify-center p-4 sm:p-8 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 text-sm font-bold text-white">
              AF
            </div>
            <div>
              <p className="font-semibold text-stone-900">Ajmera Fashion CRM</p>
              <p className="text-xs text-stone-500">Online &amp; Export Departments</p>
            </div>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-xl font-semibold text-stone-900">Sign in</h2>
            <p className="mt-1 text-sm text-stone-500">Use your Ajmera CRM account to continue.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@ajmera.com"
                    className="h-11 pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="••••••••"
                    className="h-11 pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              {error ? (
                <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={loading || !email || !password}
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing in…
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          </div>

          {/* Demo accounts */}
          <div className="mt-6 rounded-xl border border-stone-200 bg-white/60 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-stone-500">
              <IndianRupee className="h-3.5 w-3.5" aria-hidden /> Demo accounts (password: password123):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setEmail(acc.email)
                    setPassword('password123')
                    setError('')
                  }}
                  className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs text-stone-600 transition-colors hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  {acc.label}
                </button>
              ))}
            </div>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-stone-400">
              <MessageCircle className="h-3 w-3" aria-hidden /> WhatsApp &amp; calling run in Demo Mode ·
              <CalendarClock className="ml-1 h-3 w-3" aria-hidden /> AI visit reminders included
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
