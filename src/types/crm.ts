export interface UserInfo {
  id: string
  name: string
  email: string
  role: string
  department: string | null
  phone: string | null
  languages: string | null
  teamId: string | null
  dailyCallTarget?: number
  team?: { id: string; name: string; department: string } | null
}

export interface MasterItemDTO {
  id: string
  type: string
  label: string
  value?: string | null
  parentId?: string | null
  dept: string
  extra?: string | null
  order: number
  isActive: boolean
}

export interface UserRef {
  id: string
  name: string
  role?: string
}

export interface LeadDTO {
  id: string
  leadCode: string
  department: string
  customerName: string
  companyName?: string | null
  mobile: string
  whatsapp?: string | null
  email?: string | null
  city?: string | null
  state?: { id: string; label: string } | null
  country?: { id: string; label: string } | null
  businessType?: { id: string; label: string } | null
  productInterest?: string | null
  requirementNotes?: string | null
  monthlyVolume?: number | null
  budget?: number | null
  source?: { id: string; label: string } | null
  visitDate?: string | null
  visitTime?: string | null
  assignedTo?: UserRef | null
  stage?: { id: string; label: string; extra?: string | null } | null
  disposition?: { id: string; label: string; extra?: string | null } | null
  subDisposition?: { id: string; label: string } | null
  priority?: string | null
  estimatedValue?: number | null
  notes?: string | null
  lastFollowUpAt?: string | null
  nextFollowUpAt?: string | null
  lastContactAt?: string | null
  isSticky: boolean
  stickySince?: string | null
  status: string
  customerType?: string | null
  createdAt: string
  updatedAt: string
}

export interface ActivityDTO {
  id: string
  type: string
  title: string
  description?: string | null
  createdAt: string
  user?: UserRef | null
}

export interface FollowUpDTO {
  id: string
  lead: { id: string; leadCode: string; customerName: string; mobile: string; department: string; stage?: { label: string } | null }
  dueAt: string
  status: string
  note?: string | null
  outcome?: string | null
  assignedTo?: UserRef | null
  completedAt?: string | null
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface ConversationDTO {
  id: string
  phone: string
  name?: string | null
  label?: string | null
  dept?: string | null
  unreadCount: number
  lastMessage?: string | null
  lastMessageAt?: string | null
  owner?: UserRef | null
  lead?: { id: string; leadCode: string; customerName: string; department: string } | null
}

export interface MessageDTO {
  id: string
  conversationId: string
  direction: 'IN' | 'OUT'
  type: string
  body?: string | null
  mediaName?: string | null
  status: string
  createdAt: string
  user?: UserRef | null
}
