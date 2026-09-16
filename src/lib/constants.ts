export const DEPARTMENTS = ['ONLINE', 'EXPORT'] as const
export type Department = (typeof DEPARTMENTS)[number]

export const ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'TEAM_LEADER',
  'EXECUTIVE',
  'ACCOUNTS',
  'DISPATCH',
  'SUPPORT',
  'VIEWER',
] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  TEAM_LEADER: 'Team Leader',
  EXECUTIVE: 'Executive',
  ACCOUNTS: 'Accounts',
  DISPATCH: 'Dispatch Team',
  SUPPORT: 'Customer Support',
  VIEWER: 'Viewer',
}

export const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-violet-100 text-violet-700',
  ADMIN: 'bg-purple-100 text-purple-700',
  MANAGER: 'bg-teal-100 text-teal-700',
  TEAM_LEADER: 'bg-emerald-100 text-emerald-700',
  EXECUTIVE: 'bg-lime-100 text-lime-700',
  ACCOUNTS: 'bg-amber-100 text-amber-700',
  DISPATCH: 'bg-orange-100 text-orange-700',
  SUPPORT: 'bg-rose-100 text-rose-700',
  VIEWER: 'bg-stone-100 text-stone-600',
}

export const DEPT_LABELS: Record<string, string> = {
  ONLINE: 'Online Department',
  EXPORT: 'Export Department',
}

export const DEPT_SHORT: Record<string, string> = {
  ONLINE: 'Online',
  EXPORT: 'Export',
}

export const DEPT_BADGE: Record<string, string> = {
  ONLINE: 'bg-sky-100 text-sky-700 border-sky-200',
  EXPORT: 'bg-amber-100 text-amber-700 border-amber-200',
}

export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const
export const PRIORITY_COLORS: Record<string, string> = {
  HIGH: 'bg-rose-100 text-rose-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-stone-100 text-stone-600',
}

export const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID'] as const
export const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-rose-100 text-rose-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  UNPAID: 'bg-rose-100 text-rose-700',
  OVERDUE: 'bg-red-200 text-red-800',
}

export const ORDER_STATUSES = ['CONFIRMED', 'IN_PROCESS', 'DISPATCHED', 'DELIVERED', 'CANCELLED'] as const
export const SHIPMENT_STAGES = ['PACKING', 'QC', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'] as const
export const SHIPMENT_STAGE_LABELS: Record<string, string> = {
  PACKING: 'Packing',
  QC: 'QC Check',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
}
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ESCALATED'] as const
export const TICKET_STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-rose-100 text-rose-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-stone-100 text-stone-600',
  ESCALATED: 'bg-red-200 text-red-800',
}
export const LEAD_STATUSES = ['ACTIVE', 'CONVERTED', 'LOST'] as const
export const LEAD_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-sky-100 text-sky-700',
  CONVERTED: 'bg-emerald-100 text-emerald-700',
  LOST: 'bg-rose-100 text-rose-700',
}
export const CUSTOMER_TYPES = ['NEW', 'REPEAT'] as const
export const PAYMENT_MODES = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'] as const
export const PAYMENT_MODE_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank Transfer',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  OTHER: 'Other',
}
export const FOLLOWUP_STATUSES = ['PENDING', 'COMPLETED', 'RESCHEDULED', 'NO_RESPONSE', 'ESCALATED'] as const
export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'] as const
export const MEETING_OUTCOMES = ['COMPLETED', 'NO_SHOW', 'RESCHEDULED', 'INTERESTED', 'NOT_INTERESTED'] as const
export const CAMPAIGN_TYPES = ['INCOMING', 'OUTGOING', 'BROADCAST'] as const
export const CAMPAIGN_CHANNELS = ['WHATSAPP', 'CALL', 'SMS', 'EMAIL'] as const

export const MASTER_TYPES = [
  'disposition',
  'sub_disposition',
  'lead_source',
  'pipeline_stage',
  'country',
  'state',
  'business_type',
  'product_category',
  'courier',
  'ticket_type',
  'payment_mode',
  'language',
  'conversation_label',
] as const
export type MasterType = (typeof MASTER_TYPES)[number]

export const MASTER_TYPE_LABELS: Record<string, string> = {
  disposition: 'Dispositions',
  sub_disposition: 'Sub-Dispositions',
  lead_source: 'Lead Sources',
  pipeline_stage: 'Pipeline Stages',
  country: 'Countries',
  state: 'States (India)',
  business_type: 'Business Types',
  product_category: 'Product Categories',
  courier: 'Courier Partners',
  ticket_type: 'Ticket Types',
  payment_mode: 'Payment Modes',
  language: 'Languages',
  conversation_label: 'Conversation Labels',
}

export type ViewId =
  | 'dashboard'
  | 'leads'
  | 'pipeline'
  | 'lead-detail'
  | 'followups'
  | 'dialer'
  | 'whatsapp'
  | 'broadcast'
  | 'meetings'
  | 'comm-health'
  | 'wa-templates'
  | 'automations'
  | 'api-logs'
  | 'products'
  | 'quotations'
  | 'orders'
  | 'payments'
  | 'dispatch'
  | 'tickets'
  | 'campaigns'
  | 'masters'
  | 'users'
  | 'targets'
  | 'audit'
  | 'reports'
  | 'notifications'
  | 'settings'
  | 'comm-whatsapp'
  | 'comm-sip'

export type NavItem = {
  id: ViewId
  label: string
  icon: string
  roles: string[]
  group: string
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE', 'ACCOUNTS', 'DISPATCH', 'SUPPORT', 'VIEWER'], group: 'Overview' },
  { id: 'leads', label: 'Leads', icon: 'Users', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE'], group: 'Pipeline' },
  { id: 'pipeline', label: 'Lead Pipeline', icon: 'KanbanSquare', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE'], group: 'Pipeline' },
  { id: 'followups', label: 'Follow-ups', icon: 'CalendarClock', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE'], group: 'Pipeline' },
  { id: 'dialer', label: 'Telecalling', icon: 'PhoneCall', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE'], group: 'Communication' },
  { id: 'whatsapp', label: 'WhatsApp Chat', icon: 'MessageCircle', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE'], group: 'Communication' },
  { id: 'broadcast', label: 'Broadcast & Campaigns', icon: 'Megaphone', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER'], group: 'Communication' },
  { id: 'meetings', label: 'Video Consultations', icon: 'Video', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE'], group: 'Communication' },
  { id: 'wa-templates', label: 'WhatsApp Templates', icon: 'LayoutTemplate', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], group: 'Communication' },
  { id: 'automations', label: 'Automations', icon: 'Workflow', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], group: 'Communication' },
  { id: 'api-logs', label: 'API Logs', icon: 'FileStack', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], group: 'Communication' },
  { id: 'products', label: 'Products & Catalog', icon: 'Package', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE', 'VIEWER'], group: 'Sales' },
  { id: 'quotations', label: 'Quotations', icon: 'FileText', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE', 'ACCOUNTS', 'VIEWER'], group: 'Sales' },
  { id: 'orders', label: 'Sales Orders', icon: 'ShoppingCart', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'EXECUTIVE', 'ACCOUNTS', 'VIEWER'], group: 'Sales' },
  { id: 'payments', label: 'Payments & Invoices', icon: 'IndianRupee', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTS', 'TEAM_LEADER', 'VIEWER'], group: 'Sales' },
  { id: 'dispatch', label: 'Dispatch & Shipment', icon: 'Truck', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DISPATCH', 'ACCOUNTS', 'VIEWER'], group: 'Operations' },
  { id: 'tickets', label: 'Support Tickets', icon: 'LifeBuoy', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT', 'TEAM_LEADER', 'EXECUTIVE', 'VIEWER'], group: 'Operations' },
  { id: 'reports', label: 'Reports & Analytics', icon: 'BarChart3', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER', 'ACCOUNTS', 'VIEWER'], group: 'Overview' },
  { id: 'comm-health', label: 'Communication Health', icon: 'HeartPulse', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER'], group: 'Overview' },
  { id: 'masters', label: 'Master Data', icon: 'Database', roles: ['SUPER_ADMIN', 'ADMIN'], group: 'Administration' },
  { id: 'users', label: 'Users & Teams', icon: 'UserCog', roles: ['SUPER_ADMIN', 'ADMIN'], group: 'Administration' },
  { id: 'targets', label: 'Targets', icon: 'Target', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEADER'], group: 'Administration' },
  { id: 'audit', label: 'Audit Logs', icon: 'ScrollText', roles: ['SUPER_ADMIN', 'ADMIN'], group: 'Administration' },
  { id: 'settings', label: 'Settings', icon: 'Settings', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], group: 'Administration' },
  { id: 'comm-whatsapp', label: 'WhatsApp API', icon: 'MessageSquareDot', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], group: 'Administration' },
  { id: 'comm-sip', label: 'SIP / Dialer', icon: 'PhoneCall', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'], group: 'Administration' },
]

export function navForRoles(role: string): NavItem[] {
  return NAV_ITEMS.filter((n) => n.roles.includes(role))
}

export const ALL_ROLES = ROLES
