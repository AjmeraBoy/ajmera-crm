# Ajmera CRM — UI Contract (v1)

Read this FIRST, then `docs/api-contract.md`, then the relevant API route files under `src/app/api/**` (they are all implemented and working — you can read their exact query params & response shapes).

## Design System (MANDATORY)
- Content background: `bg-stone-50`. Cards/panels: `bg-white border border-stone-200 rounded-xl shadow-sm`.
- Primary accent: **emerald-600/700**. Secondary: amber (EXPORT dept), sky (ONLINE dept). Neutral: stone. NO indigo/blue as primary.
- Base font size for data: `text-sm`. Page titles: `text-xl md:text-2xl font-semibold`.
- Money: ALWAYS `formatINR()` from `@/lib/format` (₹ only, Indian grouping).
- Dates: `formatDate/formatDateTime/formatTime/timeAgo` from `@/lib/format`.
- Toasts: `useToast()` from `@/hooks/use-toast` → `toast({ title, description, variant: 'destructive'? })`.
- Icons: lucide-react only.
- Charts: recharts (already installed). Palette: `['#059669','#d97706','#0d9488','#7c3aed','#dc2626','#65a30d','#db2777','#2563eb']`.
- Responsive: mobile-first. Tables inside `overflow-x-auto`. Grids: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`.
- Long lists: wrap in `max-h-[420px] overflow-y-auto` (add class "thin-scrollbar" — global CSS already styles it? NO — do NOT rely on it; plain overflow is fine).
- All KPI cards/charts/summary numbers MUST be clickable → drill into the underlying view with filters (store.setView).
- Touch targets ≥ 44px on mobile for buttons (use size="sm" only on desktop-dense tables).
- Every view starts with `<PageHeader title subtitle>...actions</PageHeader>` from `@/components/crm/shared/page-header`.
- Use `DataTable` from `@/components/crm/shared/data-table` for tabular lists (columns config with render fns). Row click → open detail where sensible.
- Use `KpiCard`, `StatusBadge`, `EmptyState`, `FilterBar`, `UserAvatar` from `@/components/crm/shared/*`.
- Use `useMasters()` from `@/components/crm/shared/use-masters` for ALL dropdown master data (dispositions, sources, stages, countries, states, couriers, categories, ticket types, business types, labels). Never hardcode option lists except fixed enums in `@/lib/constants`.
- States/colors for badges: use `StatusBadge` (variant auto-guessed; pass variant for clarity e.g. <StatusBadge status={r.status} variant="payment" />).

## State & Data Fetching
- Session user: `useAppStore((s) => s.user)` — set by crm-app after login. Contains id, name, email, role, department, teamId.
- Navigation: `const setView = useAppStore((s) => s.setView)`; `setView('lead-detail', { leadId })` etc. Views: see ViewId in `@/lib/constants`.
- Fetch: `api()` from `@/lib/client` (throws Error with server message). Pattern:
```tsx
const [data, setData] = useState<Resp|null>(null)
const [loading, setLoading] = useState(true)
const load = useCallback(async () => { setLoading(true); try { setData(await api('/api/x?...')) } catch (e) { toast({title:'Failed to load', description:(e as Error).message, variant:'destructive'}) } finally { setLoading(false) } }, [deps])
useEffect(() => { load() }, [load])
```
- Query builder: `qs({...})` from `@/lib/client`.
- CSV export: `downloadCSV(filename, rows)` from `@/lib/client`.
- Masters are preloaded globally by crm-app into the store; just call `useMasters()`.
- Dept scoping: current dept filter for SUPER_ADMIN/ADMIN comes from store? Views accept their own dept filter UI — default `user.department ?? ''` (empty = all for SUPER_ADMIN). Respect user.department (managers etc. cannot change it).

## Component Files (exact paths, default exports, already stubbed — OVERWRITE the stub with your real implementation)
Per-agent assignments in the task prompt. Do NOT create files outside your list. Do NOT edit shared libs, api routes, schema, or other agents' view files.

## View behavior requirements
- Every list: search + filters (dept where applicable) + pagination (server-side; page/pageSize) + loading skeletons + empty state + error toast + CSV export button where useful.
- Role restrictions: EXECUTIVE sees only own data (server enforces; UI hides management buttons via user.role checks). Reassign/Unsticky buttons only for TEAM_LEADER/MANAGER/ADMIN/SUPER_ADMIN (helper: `['TEAM_LEADER','MANAGER','ADMIN','SUPER_ADMIN'].includes(user.role)`).
- Money inputs: integer ₹ (Number input).
- Department field: hidden for EXECUTIVE (fixed to their dept); selectable for ADMIN/SUPER_ADMIN on create.
- NEW lead form (LeadFormDialog) must follow doc rules: EXPORT → WhatsApp auto-fills from mobile (editable), country required (searchable Select from masters), no state; ONLINE → state required (searchable), country fixed India (hidden), WhatsApp independent optional; source=Visit → visitDate+visitTime mandatory (ONLINE).
- Disposition update (in LeadDetail + after-call forms): choosing a disposition shows its sub-dispositions (parentId) + dynamic fields based on extra JSON via `masterExtra()` (showCallback → Callback Date&Time datetime-local mandatory; showEstimated → Estimated Order Value ₹; showPayment → Payment Amount ₹ (+ mode select); showFollowUp → Follow-up Date&Time mandatory).
- Pipeline kanban (PipelineView): columns = dept pipeline stages (extra.color for header accent), cards = lead summaries; move via dropdown/journal (Select stage → PATCH /api/leads {id, stageId}) — drag-and-drop optional if simple (dnd-kit available) but NOT required.
- WhatsApp view: WhatsApp-Business-like: left conversation list (unread badge, labels), right chat thread (bubbles OUT=emerald right, IN=white left, status ticks), composer + template picker + simulate-reply button (demo), label change, sticky owner shown. Video/Voice call buttons → create CallLog via POST /api/calls {isVideo:true, channel:'WHATSAPP'}.
- Dialer view: queue of my leads with next follow-up/overdue first, big lead card (old data: last calls/notes/disposition visible BEFORE calling), click-to-call modal: simulated timer (start/stop), end→disposition form (dynamic fields), "Log incoming call" quick action, KPI strip (calls today, connected, avg talk time).
- All mutation forms must disable submit while pending and show success toast + refresh list.
