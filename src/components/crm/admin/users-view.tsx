'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, Loader2, Pencil, Plus, RefreshCw, Star, Users2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { api, qs } from '@/lib/client'
import { cn } from '@/lib/utils'
import {
  DEPARTMENTS,
  DEPT_LABELS,
  DEPT_SHORT,
  ROLES,
  ROLE_COLORS,
  ROLE_LABELS,
} from '@/lib/constants'
import { UserAvatar } from '@/components/crm/shared/avatar'
import { DataTable, type Column } from '@/components/crm/shared/data-table'
import { EmptyState } from '@/components/crm/shared/empty-state'
import { FilterBar } from '@/components/crm/shared/filter-bar'
import { PageHeader } from '@/components/crm/shared/page-header'
import { useAppStore } from '@/store/app-store'

// ---------- types ----------

type UserRow = {
  id: string
  name: string
  email: string
  role: string
  department: string | null
  phone: string | null
  languages: string | null
  teamId: string | null
  team: { id: string; name: string } | null
  isActive: boolean
  dailyCallTarget: number
}

type TeamRow = {
  id: string
  name: string
  department: string
  leader: { id: string; name: string } | null
  members: { id: string; name: string; role: string }[]
}

type ActiveFilter = 'all' | 'active' | 'inactive'

const NONE = '__none__'

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
    <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', dept === 'ONLINE' ? 'border-sky-200 bg-sky-100 text-sky-700' : dept === 'EXPORT' ? 'border-amber-200 bg-amber-100 text-amber-700' : 'border-stone-200 bg-stone-100 text-stone-600')}>
      {DEPT_SHORT[dept] ?? dept}
    </span>
  )
}

// ---------- main view ----------

export default function UsersView() {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const [users, setUsers] = useState<UserRow[]>([])
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [teamsLoading, setTeamsLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [role, setRole] = useState('__all__')
  const [dept, setDept] = useState(user?.department ?? '__all__')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all')

  const [userDialogOpen, setUserDialogOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserRow | null>(null)
  const [resetUser, setResetUser] = useState<UserRow | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [teamDialogOpen, setTeamDialogOpen] = useState(false)
  const [editTeam, setEditTeam] = useState<TeamRow | null>(null)
  const [teamDept, setTeamDept] = useState(user?.department ?? '__all__')

  const deptLocked = !!user?.department

  // debounce search input
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), 400)
    return () => clearTimeout(t)
  }, [qInput])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ users: UserRow[] }>(
        `/api/users${qs({ role: role === '__all__' ? undefined : role, dept: dept === '__all__' ? undefined : dept, q: q || undefined })}`
      )
      setUsers(res.users ?? [])
    } catch (e) {
      toast({ title: 'Failed to load users', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [role, dept, q, toast])

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true)
    try {
      const res = await api<{ teams: TeamRow[] }>(`/api/teams${qs({ dept: teamDept === '__all__' ? undefined : teamDept })}`)
      setTeams(res.teams ?? [])
    } catch (e) {
      toast({ title: 'Failed to load teams', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setTeamsLoading(false)
    }
  }, [teamDept, toast])

  useEffect(() => {
    loadUsers()
  }, [loadUsers, reloadKey])

  useEffect(() => {
    loadTeams()
  }, [loadTeams])

  const visibleUsers = useMemo(() => {
    if (activeFilter === 'active') return users.filter((u) => u.isActive)
    if (activeFilter === 'inactive') return users.filter((u) => !u.isActive)
    return users
  }, [users, activeFilter])

  const toggleActive = async (u: UserRow, next: boolean) => {
    setTogglingId(u.id)
    try {
      await api('/api/users', { method: 'PATCH', body: { id: u.id, isActive: next } })
      toast({ title: next ? 'User activated' : 'User deactivated', description: `${u.name} — ${u.email}` })
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast({ title: 'Update failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setTogglingId(null)
    }
  }

  const columns = useMemo<Column<UserRow>[]>(
    () => [
      {
        key: 'name',
        header: 'User',
        render: (u) => (
          <div className="flex items-center gap-2.5">
            <UserAvatar name={u.name} />
            <div className="min-w-0">
              <p className={cn('truncate text-sm font-medium text-stone-900', !u.isActive && 'opacity-50')}>{u.name}</p>
              <p className="text-xs text-stone-400">{ROLE_LABELS[u.role] ?? u.role}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'email',
        header: 'Email',
        render: (u) => <span className="text-sm text-stone-600">{u.email}</span>,
      },
      {
        key: 'role',
        header: 'Role',
        render: (u) => <RoleChip role={u.role} />,
      },
      {
        key: 'department',
        header: 'Dept',
        render: (u) => <DeptBadge dept={u.department} />,
      },
      {
        key: 'phone',
        header: 'Phone',
        render: (u) => <span className="text-sm text-stone-600">{u.phone || <span className="text-stone-400">—</span>}</span>,
      },
      {
        key: 'languages',
        header: 'Languages',
        render: (u) => <span className="text-xs text-stone-500">{u.languages || '—'}</span>,
      },
      {
        key: 'team',
        header: 'Team',
        render: (u) => <span className="text-sm text-stone-600">{u.team?.name ?? '—'}</span>,
      },
      {
        key: 'dailyCallTarget',
        header: 'Daily Calls',
        className: 'text-center',
        render: (u) => <span className="text-sm font-medium text-stone-700">{u.dailyCallTarget}</span>,
      },
      {
        key: 'isActive',
        header: 'Active',
        render: (u) => (
          <Switch
            checked={u.isActive}
            disabled={togglingId === u.id}
            aria-label={`Toggle active for ${u.name}`}
            onCheckedChange={(v) => toggleActive(u, v)}
          />
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        className: 'text-right',
        render: (u) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Edit user"
              aria-label={`Edit ${u.name}`}
              onClick={() => {
                setEditUser(u)
                setUserDialogOpen(true)
              }}
            >
              <Pencil className="h-4 w-4 text-stone-500" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Reset password"
              aria-label={`Reset password for ${u.name}`}
              onClick={() => setResetUser(u)}
            >
              <KeyRound className="h-4 w-4 text-stone-500" aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    [togglingId]
  )

  return (
    <div>
      <PageHeader title="Users & Teams" subtitle="Manage logins, roles, departments and team structure">
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
        </Button>
        <Button
          size="sm"
          className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => {
            setEditUser(null)
            setUserDialogOpen(true)
          }}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add User
        </Button>
      </PageHeader>

      <Tabs defaultValue="users" className="gap-4">
        <TabsList className="bg-white">
          <TabsTrigger value="users" className="gap-1.5 px-3">
            <Users2 className="h-4 w-4" aria-hidden /> Users
          </TabsTrigger>
          <TabsTrigger value="teams" className="gap-1.5 px-3">
            <Star className="h-4 w-4" aria-hidden /> Teams
          </TabsTrigger>
        </TabsList>

        {/* ---------------- USERS TAB ---------------- */}
        <TabsContent value="users" className="space-y-3">
          <FilterBar>
            <div className="relative">
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search name or email…"
                className="h-9 w-full min-w-[200px] bg-white sm:w-56"
                aria-label="Search users"
              />
            </div>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-9 w-full bg-white sm:w-44" aria-label="Filter by role">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dept} onValueChange={setDept} disabled={deptLocked}>
              <SelectTrigger className="h-9 w-full bg-white sm:w-44" aria-label="Filter by department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All departments</SelectItem>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as ActiveFilter)}>
              <SelectTrigger className="h-9 w-full bg-white sm:w-40" aria-label="Filter by active status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="inactive">Inactive only</SelectItem>
              </SelectContent>
            </Select>
          </FilterBar>

          <DataTable
            columns={columns}
            rows={visibleUsers}
            loading={loading}
            emptyMessage="No users match the current filters"
            maxH="max-h-[620px]"
          />
          <p className="text-xs text-stone-500">
            Showing {visibleUsers.length} of {users.length} user(s)
          </p>
        </TabsContent>

        {/* ---------------- TEAMS TAB ---------------- */}
        <TabsContent value="teams" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select value={teamDept} onValueChange={setTeamDept} disabled={deptLocked}>
              <SelectTrigger className="h-9 w-full bg-white sm:w-48" aria-label="Filter teams by department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All departments</SelectItem>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => {
                setEditTeam(null)
                setTeamDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4" aria-hidden /> Add Team
            </Button>
          </div>

          {teamsLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={`sk-team-${i}`} className="h-44 animate-pulse rounded-xl border border-stone-200 bg-white" />
              ))}
            </div>
          ) : teams.length === 0 ? (
            <EmptyState
              icon={Users2}
              title="No teams yet"
              subtitle="Create teams to group executives and assign team-level targets."
              action={
                <Button
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => {
                    setEditTeam(null)
                    setTeamDialogOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden /> Add Team
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {teams.map((t) => (
                <div key={t.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-stone-900">{t.name}</h3>
                      <div className="mt-1">
                        <DeptBadge dept={t.department} />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title="Edit team"
                      aria-label={`Edit team ${t.name}`}
                      onClick={() => {
                        setEditTeam(t)
                        setTeamDialogOpen(true)
                      }}
                    >
                      <Pencil className="h-4 w-4 text-stone-500" aria-hidden />
                    </Button>
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-stone-100 pt-3">
                    <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" aria-hidden />
                    {t.leader ? (
                      <span className="truncate text-sm text-stone-700">
                        <span className="font-medium">{t.leader.name}</span> <span className="text-xs text-stone-400">— Team Leader</span>
                      </span>
                    ) : (
                      <span className="text-sm text-stone-400">No leader assigned</span>
                    )}
                  </div>
                  <div className="mt-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Members ({t.members.length})</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {t.members.slice(0, 5).map((m) => (
                          <UserAvatar key={m.id} name={m.name} className="h-7 w-7 border-2 border-white text-[10px]" />
                        ))}
                        {t.members.length > 5 ? (
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-stone-100 text-[10px] font-semibold text-stone-600">
                            +{t.members.length - 5}
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-stone-500" title={t.members.map((m) => m.name).join(', ')}>
                        {t.members.map((m) => m.name).join(', ') || 'No members'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* add / edit user dialog */}
      <UserDialog
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
        user={editUser}
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      {/* reset password dialog */}
      <ResetPasswordDialog user={resetUser} onClose={() => setResetUser(null)} />

      {/* add / edit team dialog */}
      <TeamDialog
        open={teamDialogOpen}
        onOpenChange={setTeamDialogOpen}
        team={editTeam}
        defaultDept={deptLocked ? (user?.department ?? 'ONLINE') : teamDept === '__all__' ? 'ONLINE' : teamDept}
        onSaved={() => {
          setReloadKey((k) => k + 1)
          loadTeams()
        }}
      />
    </div>
  )
}

// ---------- user form dialog ----------

function UserDialog({
  open,
  onOpenChange,
  user,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: UserRow | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const isEdit = !!user
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'EXECUTIVE',
    dept: NONE,
    phone: '',
    languages: '',
    teamId: NONE,
    dailyCallTarget: '60',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(
      user
        ? {
            name: user.name,
            email: user.email,
            password: '',
            role: user.role,
            dept: user.department ?? NONE,
            phone: user.phone ?? '',
            languages: user.languages ?? '',
            teamId: user.teamId ?? NONE,
            dailyCallTarget: String(user.dailyCallTarget ?? 60),
          }
        : { name: '', email: '', password: '', role: 'EXECUTIVE', dept: NONE, phone: '', languages: '', teamId: NONE, dailyCallTarget: '60' }
    )
  }, [open, user])

  useEffect(() => {
    if (!open) return
    api<{ teams: TeamRow[] }>('/api/teams')
      .then((res) => setTeams(res.teams ?? []))
      .catch(() => setTeams([]))
  }, [open])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const submit = async () => {
    setError('')
    if (!form.name.trim() || !form.email.trim() || (!isEdit && !form.password) || !form.role) {
      setError('Name, email, role and password (on create) are required.')
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      setError('Please enter a valid email address.')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        department: form.dept === NONE ? null : form.dept,
        phone: form.phone.trim() || null,
        languages: form.languages.trim() || null,
        teamId: form.teamId === NONE ? null : form.teamId,
        dailyCallTarget: Number(form.dailyCallTarget) || 60,
      }
      if (isEdit) {
        if (form.password) body.password = form.password
        await api('/api/users', { method: 'PATCH', body: { id: user.id, ...body } })
        toast({ title: 'User updated', description: `${form.name} saved successfully.` })
      } else {
        body.password = form.password
        await api('/api/users', { method: 'POST', body })
        toast({ title: 'User created', description: `${form.name} can now log in.` })
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
      toast({ title: isEdit ? 'Update failed' : 'Create failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit User — ${user.name}` : 'Add User'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Leave password blank to keep the current password.' : 'Create a login for a team member. Share the password securely.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} disabled={saving} placeholder="Full name" />
          </div>
          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={saving} placeholder="name@ajmera.com" />
          </div>
          <div className="space-y-1.5">
            <Label>{isEdit ? 'New Password (optional)' : 'Password *'}</Label>
            <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} disabled={saving} placeholder={isEdit ? 'Leave blank = unchanged' : 'Min 6 characters'} />
          </div>
          <div className="space-y-1.5">
            <Label>Role *</Label>
            <Select value={form.role} onValueChange={(v) => set('role', v)} disabled={saving}>
              <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={form.dept} onValueChange={(v) => set('dept', v)} disabled={saving}>
              <SelectTrigger aria-label="Department"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Team</Label>
            <Select value={form.teamId} onValueChange={(v) => set('teamId', v)} disabled={saving}>
              <SelectTrigger aria-label="Team"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No team</SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({DEPT_SHORT[t.department] ?? t.department})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} disabled={saving} placeholder="+91…" />
          </div>
          <div className="space-y-1.5">
            <Label>Daily Call Target</Label>
            <Input type="number" min={0} value={form.dailyCallTarget} onChange={(e) => set('dailyCallTarget', e.target.value)} disabled={saving} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Languages</Label>
            <Input value={form.languages} onChange={(e) => set('languages', e.target.value)} disabled={saving} placeholder="English, Hindi, Gujarati" />
            <p className="text-[11px] text-stone-400">Comma separated list of languages the user speaks.</p>
          </div>
        </div>
        {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            {isEdit ? 'Save Changes' : 'Create User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- reset password dialog ----------

function ResetPasswordDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const { toast } = useToast()
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user) {
      setPassword('')
      setError('')
    }
  }, [user])

  const submit = async () => {
    if (!user) return
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setSaving(true)
    try {
      await api('/api/users', { method: 'PATCH', body: { id: user.id, password } })
      toast({ title: 'Password reset', description: `New password set for ${user.name}.` })
      onClose()
    } catch (e) {
      setError((e as Error).message)
      toast({ title: 'Password reset failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!saving && !o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            Set a new password for <span className="font-medium text-stone-700">{user?.name}</span> ({user?.email}).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>New Password *</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={saving}
            placeholder="Min 6 characters"
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving || !password} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Reset Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- team form dialog ----------

function TeamDialog({
  open,
  onOpenChange,
  team,
  defaultDept,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  team: TeamRow | null
  defaultDept: string
  onSaved: () => void
}) {
  const { toast } = useToast()
  const isEdit = !!team
  const [name, setName] = useState('')
  const [dept, setDept] = useState('ONLINE')
  const [leaderId, setLeaderId] = useState(NONE)
  const [leaders, setLeaders] = useState<{ id: string; name: string; role: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setName(team?.name ?? '')
    setDept(team?.department ?? defaultDept ?? 'ONLINE')
    setLeaderId(team?.leader?.id ?? NONE)
  }, [open, team, defaultDept])

  // load candidate leaders (TEAM_LEADER / MANAGER of the chosen department)
  useEffect(() => {
    if (!open || !dept) {
      setLeaders([])
      return
    }
    let cancelled = false
    api<{ users: { id: string; name: string; role: string }[] }>(`/api/users${qs({ dept, active: 1 })}`)
      .then((res) => {
        if (cancelled) return
        const opts = (res.users ?? []).filter((u) => u.role === 'TEAM_LEADER' || u.role === 'MANAGER')
        if (team?.leader && !opts.some((o) => o.id === team.leader?.id)) {
          opts.unshift({ id: team.leader.id, name: team.leader.name, role: 'TEAM_LEADER' })
        }
        setLeaders(opts)
      })
      .catch(() => { if (!cancelled) setLeaders([]) })
    return () => { cancelled = true }
  }, [open, dept, team])

  const submit = async () => {
    setError('')
    if (!name.trim()) {
      setError('Team name is required.')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await api('/api/teams', {
          method: 'PATCH',
          body: { id: team.id, name: name.trim(), leaderId: leaderId === NONE ? null : leaderId },
        })
        toast({ title: 'Team updated', description: `${name} saved.` })
      } else {
        await api('/api/teams', {
          method: 'POST',
          body: { name: name.trim(), department: dept, leaderId: leaderId === NONE ? null : leaderId },
        })
        toast({ title: 'Team created', description: `${name} is ready for members.` })
      }
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
      toast({ title: isEdit ? 'Update failed' : 'Create failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Team — ${team.name}` : 'Add Team'}</DialogTitle>
          <DialogDescription>Teams group executives for assignment, targets and performance views.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Team Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={saving} placeholder="e.g. Export — Team A" />
          </div>
          <div className="space-y-1.5">
            <Label>Department *</Label>
            <Select value={dept} onValueChange={setDept} disabled={saving || isEdit}>
              <SelectTrigger aria-label="Team department"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>{DEPT_LABELS[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit ? <p className="text-[11px] text-stone-400">Department cannot be changed after creation.</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label>Team Leader</Label>
            <Select value={leaderId} onValueChange={setLeaderId} disabled={saving}>
              <SelectTrigger aria-label="Team leader"><SelectValue placeholder="Select leader" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No leader</SelectItem>
                {leaders.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name} ({ROLE_LABELS[l.role] ?? l.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-stone-400">Team Leaders and Managers of the selected department.</p>
          </div>
          {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving || !name.trim()} onClick={submit}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            {isEdit ? 'Save Changes' : 'Create Team'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
