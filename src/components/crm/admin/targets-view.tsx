'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Info, Loader2, Save, Target, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { cn } from '@/lib/utils'
import { formatINR } from '@/lib/format'
import { DEPARTMENTS, DEPT_LABELS, DEPT_SHORT, ROLE_COLORS, ROLE_LABELS } from '@/lib/constants'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { KpiCard } from '@/components/crm/shared/kpi-card'
import { PageHeader } from '@/components/crm/shared/page-header'
import { useAppStore } from '@/store/app-store'

// ---------- types ----------

type TargetRow = {
  id: string
  userId: string
  month: string
  amount: number
  user: { id: string; name: string; role: string; department: string | null }
}

type ScopeUser = {
  id: string
  name: string
  role: string
  department: string | null
  teamId: string | null
  team: { id: string; name: string } | null
}

const TARGETED_ROLES = ['MANAGER', 'TEAM_LEADER', 'EXECUTIVE']
const CAN_SET_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER']
const ALL_DEPT = '__all__'

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function RoleChip({ role }: { role: string }) {
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', ROLE_COLORS[role] ?? 'bg-stone-100 text-stone-600')}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

function DeptBadge({ dept }: { dept: string | null }) {
  if (!dept) return <span className="text-stone-400">—</span>
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', dept === 'ONLINE' ? 'border-sky-200 bg-sky-100 text-sky-700' : 'border-amber-200 bg-amber-100 text-amber-700')}>
      {DEPT_SHORT[dept] ?? dept}
    </span>
  )
}

// ---------- main view ----------

export default function TargetsView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const [month, setMonth] = useState(currentMonth)
  const [dept, setDept] = useState(user?.department ?? ALL_DEPT)
  const [users, setUsers] = useState<ScopeUser[]>([])
  const [original, setOriginal] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [workingDays, setWorkingDays] = useState(26)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const isTL = user?.role === 'TEAM_LEADER'
  const canEdit = CAN_SET_ROLES.includes(user?.role ?? '')
  const deptLocked = !!user?.department

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const deptParam = isTL ? undefined : dept === ALL_DEPT ? undefined : dept
      const [tRes, uRes, sRes] = await Promise.all([
        api<{ targets: TargetRow[] }>(`/api/targets${qs({ month, dept: deptParam })}`),
        api<{ users: ScopeUser[] }>(`/api/users${qs({ active: 1, dept: deptParam })}`),
        api<{ settings: Record<string, string> }>('/api/settings').catch(() => ({ settings: {} as Record<string, string> })),
      ])
      setWorkingDays(Number(sRes.settings.WORKING_DAYS) || 26)

      let scope = (uRes.users ?? []).filter((u) => TARGETED_ROLES.includes(u.role))
      if (isTL) {
        // Team leaders may only see & set targets for their own team(s)
        try {
          const teamsRes = await api<{ teams: { id: string; leader: { id: string } | null; members: { id: string }[] }[] }>('/api/teams')
          const myTeamIds = new Set(
            teamsRes.teams
              .filter((t) => t.leader?.id === user?.id || t.members.some((m) => m.id === user?.id))
              .flatMap((t) => t.members.map((m) => m.id))
          )
          myTeamIds.add(user?.id ?? '')
          scope = scope.filter((u) => myTeamIds.has(u.id))
        } catch {
          scope = scope.filter((u) => u.id === user?.id)
        }
      }
      scope.sort((a, b) => a.name.localeCompare(b.name))

      const tMap: Record<string, number> = {}
      for (const t of tRes.targets ?? []) tMap[t.userId] = t.amount
      setUsers(scope)
      setOriginal(tMap)
      setDrafts(Object.fromEntries(scope.map((u) => [u.id, tMap[u.id] !== undefined ? String(tMap[u.id]) : ''])))
    } catch (e) {
      toast({ title: 'Failed to load targets', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [month, dept, isTL, user?.id, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const changedRows = useMemo(
    () =>
      users.filter((u) => {
        const draft = drafts[u.id] ?? ''
        const orig = original[u.id] !== undefined ? String(original[u.id]) : ''
        return draft !== orig
      }),
    [users, drafts, original]
  )

  const total = useMemo(() => users.reduce((sum, u) => sum + (Number(drafts[u.id]) || 0), 0), [users, drafts])
  const setCount = useMemo(() => users.filter((u) => Number(drafts[u.id]) > 0).length, [users, drafts])

  const save = async () => {
    if (changedRows.length === 0) {
      toast({ title: 'No changes to save', description: 'Edit at least one target amount first.' })
      return
    }
    setSaving(true)
    try {
      await api('/api/targets', {
        method: 'POST',
        body: {
          month,
          items: changedRows.map((u) => ({ userId: u.id, amount: Number(drafts[u.id]) || 0 })),
        },
      })
      toast({ title: 'Targets saved', description: `${changedRows.length} target(s) updated for ${month}.` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<Column<ScopeUser>[]>(
    () => [
      {
        key: 'name',
        header: 'User',
        render: (u) => (
          <div className="flex items-center gap-2.5">
            <UserAvatar name={u.name} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-stone-900">{u.name}</p>
              <RoleChip role={u.role} />
            </div>
          </div>
        ),
      },
      { key: 'department', header: 'Dept', render: (u) => <DeptBadge dept={u.department} /> },
      {
        key: 'team',
        header: 'Team',
        render: (u) => <span className="text-sm text-stone-600">{u.team?.name ?? '—'}</span>,
      },
      {
        key: 'amount',
        header: 'Monthly Target (₹)',
        render: (u) =>
          canEdit ? (
            <Input
              type="number"
              min={0}
              step={1000}
              inputMode="numeric"
              className="h-9 w-full max-w-[160px]"
              aria-label={`Monthly target for ${u.name}`}
              value={drafts[u.id] ?? ''}
              disabled={saving || loading}
              onChange={(e) => setDrafts((d) => ({ ...d, [u.id]: e.target.value }))}
            />
          ) : (
            <span className="text-sm font-medium text-stone-800">{formatINR(original[u.id] ?? 0)}</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (u) => {
          const v = Number(drafts[u.id]) || 0
          const isSet = original[u.id] !== undefined || v > 0
          return (
            <span
              className={cn(
                'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
                v > 0 ? 'bg-emerald-100 text-emerald-700' : isSet ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500'
              )}
            >
              {v > 0 ? 'Set' : isSet ? 'Zero' : 'Not set'}
            </span>
          )
        },
      },
    ],
    [canEdit, drafts, original, saving, loading]
  )

  const deptLabel = dept === ALL_DEPT ? 'All Departments' : DEPT_LABELS[dept] ?? dept

  return (
    <div>
      <PageHeader
        title="Monthly Targets"
        subtitle={canEdit ? 'Set monthly sales targets per person — saved instantly to the dashboard' : 'Monthly sales targets for your scope'}
      >
        {canEdit ? (
          <Button
            size="sm"
            className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={saving || loading || changedRows.length === 0}
            onClick={save}
          >
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1 h-4 w-4" aria-hidden />}
            Save Targets{changedRows.length ? ` (${changedRows.length})` : ''}
          </Button>
        ) : null}
      </PageHeader>

      <FilterBar>
        <div className="space-y-1">
          <Label className="sr-only" htmlFor="target-month">Month</Label>
          <Input
            id="target-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonth())}
            className="h-9 w-full bg-white sm:w-44"
          />
        </div>
        <Select value={dept} onValueChange={setDept} disabled={deptLocked || isTL}>
          <SelectTrigger className="h-9 w-full bg-white sm:w-48" aria-label="Department">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            {deptLocked ? null : <SelectItem value={ALL_DEPT}>All departments</SelectItem>}
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isTL ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            Team Leader scope — your team members only
          </span>
        ) : null}
      </FilterBar>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={`Total Monthly Target — ${deptLabel}`}
          value={formatINR(total)}
          sub={`${month} · ${setCount} of ${users.length} people with targets`}
          icon={<Target className="h-5 w-5" aria-hidden />}
          tone="positive"
        />
        <KpiCard
          label="People in Scope"
          value={users.length}
          sub={TARGETED_ROLES.map((r) => ROLE_LABELS[r]).join(' / ')}
          icon={<Users className="h-5 w-5" aria-hidden />}
        />
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 md:col-span-2">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <div className="space-y-1 text-xs text-stone-600">
              <p className="text-sm font-semibold text-stone-800">How targets are used</p>
              <p>
                <span className="font-medium text-stone-800">Today&apos;s Target</span> = Monthly Target ÷ Working Days ({workingDays} days — configurable in Settings)
              </p>
              <p>
                <span className="font-medium text-stone-800">Achievement %</span> = (Achieved ÷ Monthly Target) × 100 — shown on dashboards &amp; reports
              </p>
            </div>
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={users}
        loading={loading}
        emptyMessage={loading ? 'Loading…' : 'No sales staff found for this scope — add executives in Users & Teams'}
        maxH="max-h-[560px]"
      />

      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Department Total ({month})</p>
          <p className="text-lg font-bold text-stone-900">{formatINR(total)}</p>
        </div>
        <p className="text-xs text-stone-500">
          {changedRows.length ? (
            <span className="font-medium text-amber-700">{changedRows.length} unsaved change(s) — click “Save Targets”</span>
          ) : (
            'All changes saved'
          )}
        </p>
      </div>
    </div>
  )
}
