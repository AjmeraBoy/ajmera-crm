/**
 * AJMERA FASHION CRM — Database Seed
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'

const db = new PrismaClient()
const hash = (pw: string) => createHash('sha256').update(`ajmera-crm::${pw}`).digest('hex')
const PW = hash('password123')

// date helpers
const now = new Date()
const daysAgo = (n: number, h = 10, m = 0) => { const d = new Date(now); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d }
const daysAhead = (n: number, h = 11, m = 30) => { const d = new Date(now); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d }
const monthStart = () => { const d = new Date(now.getFullYear(), now.getMonth(), 1); return d }
const curMonth = () => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

let seq: Record<string, number> = {}
const code = (prefix: string) => { seq[prefix] = (seq[prefix] || 0) + 1; return `${prefix}-${String(seq[prefix]).padStart(4, '0')}` }

async function main() {
  console.log('🌱 Seeding Ajmera Fashion CRM...')
  seq = {}

  // ---- CLEAN (dependency order) ----
  const tables = ['ticketComment', 'supportTicket', 'shipment', 'payment', 'invoice', 'salesOrder', 'quotation', 'whatsAppMessage', 'whatsAppConversation', 'callLog', 'followUp', 'activity', 'meeting', 'document', 'target', 'notification', 'auditLog', 'lead', 'product', 'whatsAppTemplate', 'campaign', 'session', 'user', 'team', 'masterItem', 'setting']
  for (const t of tables) {
    await (db as unknown as Record<string, { deleteMany: () => Promise<unknown> }>)[t].deleteMany()
  }

  // ---- SETTINGS ----
  const settings: Array<[string, string]> = [
    ['COMPANY_NAME', 'Ajmera Fashion Limited'],
    ['CURRENCY', 'INR'],
    ['CURRENCY_SYMBOL', '₹'],
    ['WORKING_DAYS', '26'],
    ['AI_REMINDER_TRIGGER_MINUTES', '60'],
    ['AI_REMINDER_VOICE', 'Ajay Sir (Recorded)'],
    ['AI_REMINDER_ENABLED', 'true'],
    ['AUTO_WELCOME_MESSAGE', 'true'],
    ['REPEAT_REMINDER_DAYS', '30'],
    ['WHATSAPP_API_PROVIDER', 'WABA (Demo Mode)'],
    ['CALLING_API_PROVIDER', 'CRM Dialer (Demo Mode)'],
    ['EXPORT_SLA_HOURS', '48'],
  ]
  for (const [key, value] of settings) await db.setting.create({ data: { key, value } })

  // ---- MASTER: COUNTRIES ----
  const countries = ['United States', 'United Kingdom', 'United Arab Emirates', 'Saudi Arabia', 'Kuwait', 'Qatar', 'Oman', 'Bahrain', 'Singapore', 'Malaysia', 'Australia', 'New Zealand', 'Canada', 'South Africa', 'Nigeria', 'Kenya', 'Ghana', 'Tanzania', 'Uganda', 'Zambia', 'Fiji', 'Mauritius', 'Maldives', 'Bangladesh', 'Sri Lanka', 'Nepal', 'Thailand', 'Indonesia', 'Philippines', 'Vietnam', 'Japan', 'South Korea', 'Israel', 'Turkey', 'Egypt', 'Morocco', 'France', 'Germany', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Switzerland', 'Austria', 'Poland', 'Portugal', 'Greece', 'Russia', 'Ukraine', 'Brazil', 'Mexico', 'Argentina', 'Chile', 'Colombia', 'Panama', 'Trinidad & Tobago', 'Guyana', 'Suriname', 'Ireland', 'Sweden']
  const countryMap: Record<string, string> = {}
  for (let i = 0; i < countries.length; i++) {
    const c = await db.masterItem.create({ data: { type: 'country', label: countries[i], dept: 'EXPORT', order: i, value: countries[i].slice(0, 2).toUpperCase() } })
    countryMap[countries[i]] = c.id
  }

  // ---- MASTER: INDIAN STATES ----
  const states = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh', 'Andaman & Nicobar', 'Dadra & Nagar Haveli', 'Daman & Diu', 'Lakshadweep']
  const stateMap: Record<string, string> = {}
  for (let i = 0; i < states.length; i++) {
    const s = await db.masterItem.create({ data: { type: 'state', label: states[i], dept: 'ONLINE', order: i } })
    stateMap[states[i]] = s.id
  }

  // ---- MASTER: PIPELINE STAGES (with colors) ----
  const stageColors: string[] = ['#94a3b8', '#f59e0b', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#14b8a6', '#ef4444', '#10b981', '#3b82f6', '#059669', '#6366f1', '#64748b']
  const colorList = Object.keys(stageColors)
  const exportStages = ['New Lead', 'Attempted', 'Connected', 'Requirement Understood', 'Catalog Shared', 'Video Call Scheduled', 'Interested', 'Quotation Sent', 'Negotiation', 'Payment Pending', 'Order Confirmed', 'Dispatch Processing', 'Delivered', 'Repeat Follow-up', 'Closed / Lost']
  const onlineStages = ['New Lead', 'Attempted', 'Connected', 'Requirement Understood', 'Catalog Shared', 'Interested', 'Quotation Sent', 'Negotiation', 'Payment Pending', 'Order Confirmed', 'Dispatch Processing', 'Delivered', 'Closed / Lost']
  const stageMap: Record<string, string> = {}
  const mkStage = async (label: string, dept: string, order: number) => {
    const s = await db.masterItem.create({ data: { type: 'pipeline_stage', label, dept, order, extra: JSON.stringify({ color: colorList[order % colorList.length] }) } })
    stageMap[`${dept}:${label}`] = s.id
  }
  for (let i = 0; i < exportStages.length; i++) await mkStage(exportStages[i], 'EXPORT', i)
  for (let i = 0; i < onlineStages.length; i++) await mkStage(onlineStages[i], 'ONLINE', i)

  // ---- MASTER: DISPOSITIONS + SUB-DISPOSITIONS ----
  const dispositions: Array<{ label: string; extra?: Record<string, unknown>; subs: string[] }> = [
    { label: 'New', subs: ['Sample Requested', 'Catalogue Shared', 'Price Shared', 'Quotation Sent', 'Waiting for Customer Response', 'Requirement Under Discussion'] },
    { label: 'Repeat', subs: ['Repeat Order Discussion', 'Product Selection', 'Quotation Shared', 'Payment Pending', 'Dispatch Planning', 'Waiting for Confirmation'] },
    { label: 'Callback', extra: { showCallback: true }, subs: [] },
    { label: 'Not Connected', subs: ['No Answer', 'Busy', 'Wrong Number', 'Invalid Number', 'Switched Off', 'Voicemail', 'Call Dropped', 'Network Issue', 'Service Not Available'] },
    { label: 'Estimated', extra: { showEstimated: true }, subs: [] },
    { label: 'Payment Done', extra: { showPayment: true }, subs: [] },
    { label: 'Support', subs: ['Catalogue Issue', 'Product Information Required', 'Dispatch Issue', 'Quality Issue', 'Payment Issue', 'Technical Support', 'Document Required', 'Other'] },
    { label: 'Collections', extra: { showFollowUp: true }, subs: [] },
    { label: 'Follow-up', extra: { showFollowUp: true }, subs: ['Interested - Needs Time', 'Discussing with Partner', 'Waiting for Stock', 'Price Negotiation'] },
    { label: 'Lost Lead', subs: ['Price Issue', 'Purchased from Competitor', 'MOQ Not Suitable', 'Product Not Available', 'Customer Not Interested', 'Budget Issue', 'Business Closed', 'Duplicate Lead', 'Other'] },
  ]
  const dispMap: Record<string, string> = {}
  const subDispMap: Record<string, Record<string, string>> = {}
  for (let i = 0; i < dispositions.length; i++) {
    const d = dispositions[i]
    const item = await db.masterItem.create({ data: { type: 'disposition', label: d.label, dept: 'ALL', order: i, extra: d.extra ? JSON.stringify(d.extra) : null } })
    dispMap[d.label] = item.id
    subDispMap[d.label] = {}
    for (let j = 0; j < d.subs.length; j++) {
      const sub = await db.masterItem.create({ data: { type: 'sub_disposition', label: d.subs[j], parentId: item.id, dept: 'ALL', order: j } })
      subDispMap[d.label][d.subs[j]] = sub.id
    }
  }

  // ---- MASTER: LEAD SOURCES ----
  const exportSources = ['YouTube', 'Instagram', 'TikTok', 'Alibaba', 'Website Forms', 'WhatsApp', 'Facebook', 'Referral', 'Trade Shows', 'Manual Entry', 'Online', 'Offline', 'Franchise', 'Walk-in Customer']
  const onlineSources = ['Call', 'WhatsApp', 'Website', 'Referral', 'Visit', 'Indiamart', 'Trade Show', 'Exhibition']
  const sourceMap: Record<string, string> = {}
  for (let i = 0; i < exportSources.length; i++) {
    const s = await db.masterItem.create({ data: { type: 'lead_source', label: exportSources[i], dept: 'EXPORT', order: i } })
    sourceMap[exportSources[i]] = s.id
  }
  for (let i = 0; i < onlineSources.length; i++) {
    const s = await db.masterItem.create({ data: { type: 'lead_source', label: onlineSources[i], dept: 'ONLINE', order: i, extra: onlineSources[i] === 'Visit' ? JSON.stringify({ requireVisitDateTime: true }) : null } })
    sourceMap[`ONLINE:${onlineSources[i]}`] = s.id
  }

  // ---- MASTER: business types, categories, couriers, ticket types, payment modes, languages, labels ----
  const businessTypes = ['Retailer', 'Distributor', 'Wholesaler', 'Boutique Owner', 'Export House', 'Online Seller', 'Franchise Owner', 'Garment Shop']
  const businessMap: Record<string, string> = {}
  for (let i = 0; i < businessTypes.length; i++) {
    const b = await db.masterItem.create({ data: { type: 'business_type', label: businessTypes[i], dept: 'ALL', order: i } })
    businessMap[businessTypes[i]] = b.id
  }
  const categories = ['Sarees', 'Lehengas', 'Kurtis', 'Gowns', 'Dress Materials', 'Salwar Suits', 'Dupattas', 'Ethnic Wear']
  const catMap: Record<string, string> = {}
  for (let i = 0; i < categories.length; i++) {
    const c = await db.masterItem.create({ data: { type: 'product_category', label: categories[i], dept: 'ALL', order: i } })
    catMap[categories[i]] = c.id
  }
  const couriers = ['DHL Express', 'FedEx', 'BlueDart', 'DTDC', 'India Post', 'Aramex', 'Delhivery']
  for (let i = 0; i < couriers.length; i++) await db.masterItem.create({ data: { type: 'courier', label: couriers[i], dept: 'ALL', order: i } })
  const ticketTypes = ['Shipment Delay', 'Product Complaint', 'Damage Issue', 'Replacement Request', 'Payment Issue']
  for (let i = 0; i < ticketTypes.length; i++) await db.masterItem.create({ data: { type: 'ticket_type', label: ticketTypes[i], dept: 'ALL', order: i } })
  for (let i = 0; i < couriers.length; i++) { /* noop keep lint happy */ }
  const modes: Array<[string, string]> = [['CASH', 'Cash'], ['UPI', 'UPI'], ['BANK_TRANSFER', 'Bank Transfer'], ['CHEQUE', 'Cheque'], ['CARD', 'Card'], ['OTHER', 'Other']]
  for (let i = 0; i < modes.length; i++) await db.masterItem.create({ data: { type: 'payment_mode', label: modes[i][1], value: modes[i][0], dept: 'ALL', order: i } })
  const langs = ['Hindi', 'English', 'Gujarati', 'Marathi', 'Tamil', 'Telugu', 'Bengali', 'Urdu', 'Arabic', 'French', 'Spanish']
  for (let i = 0; i < langs.length; i++) await db.masterItem.create({ data: { type: 'language', label: langs[i], dept: 'ALL', order: i } })
  const labels = ['New Enquiry', 'Hot Lead', 'Follow-up', 'Payment Pending', 'Support', 'Repeat Customer']
  for (let i = 0; i < labels.length; i++) await db.masterItem.create({ data: { type: 'conversation_label', label: labels[i], dept: 'ALL', order: i } })

  // ---- USERS & TEAMS ----
  const mkUser = (data: { name: string; email: string; role: string; department?: string; phone?: string; languages?: string; teamId?: string }) =>
    db.user.create({ data: { ...data, password: PW } })

  const superAdmin = await mkUser({ name: 'Ajay Ajmera', email: 'superadmin@ajmera.com', role: 'SUPER_ADMIN', phone: '+91 98250 00001' })
  const admin = await mkUser({ name: 'Manoj Sharma', email: 'admin@ajmera.com', role: 'ADMIN', phone: '+91 98250 00002' })
  const mgrOnline = await mkUser({ name: 'Priya Desai', email: 'manager.online@ajmera.com', role: 'MANAGER', department: 'ONLINE', phone: '+91 98250 00003' })
  const mgrExport = await mkUser({ name: 'Rakesh Patel', email: 'manager.export@ajmera.com', role: 'MANAGER', department: 'EXPORT', phone: '+91 98250 00004' })
  const tlOnline = await mkUser({ name: 'Sneha Joshi', email: 'tl.online@ajmera.com', role: 'TEAM_LEADER', department: 'ONLINE', phone: '+91 98250 00005' })
  const tlExport = await mkUser({ name: 'Imran Sheikh', email: 'tl.export@ajmera.com', role: 'TEAM_LEADER', department: 'EXPORT', phone: '+91 98250 00006' })
  const exO1 = await mkUser({ name: 'Kavita Rathi', email: 'exec.online1@ajmera.com', role: 'EXECUTIVE', department: 'ONLINE', phone: '+91 98250 00007', languages: 'Hindi,English,Gujarati' })
  const exO2 = await mkUser({ name: 'Rahul Verma', email: 'exec.online2@ajmera.com', role: 'EXECUTIVE', department: 'ONLINE', phone: '+91 98250 00008', languages: 'Hindi,English' })
  const exO3 = await mkUser({ name: 'Divya Nair', email: 'exec.online3@ajmera.com', role: 'EXECUTIVE', department: 'ONLINE', phone: '+91 98250 00009', languages: 'Hindi,English,Malayalam' })
  const exE1 = await mkUser({ name: 'Amit Chauhan', email: 'exec.export1@ajmera.com', role: 'EXECUTIVE', department: 'EXPORT', phone: '+91 98250 00010', languages: 'English,Hindi,Arabic' })
  const exE2 = await mkUser({ name: 'Farida Merchant', email: 'exec.export2@ajmera.com', role: 'EXECUTIVE', department: 'EXPORT', phone: '+91 98250 00011', languages: 'English,Gujarati,Arabic' })
  const exE3 = await mkUser({ name: 'Joseph D Souza', email: 'exec.export3@ajmera.com', role: 'EXECUTIVE', department: 'EXPORT', phone: '+91 98250 00012', languages: 'English,Hindi,French' })
  const accounts = await mkUser({ name: 'Nilesh Bhatt', email: 'accounts@ajmera.com', role: 'ACCOUNTS', phone: '+91 98250 00013' })
  const dispatch = await mkUser({ name: 'Jignesh Rathod', email: 'dispatch@ajmera.com', role: 'DISPATCH', phone: '+91 98250 00014' })
  const support = await mkUser({ name: 'Pooja Shah', email: 'support@ajmera.com', role: 'SUPPORT', phone: '+91 98250 00015' })

  const teamOnline = await db.team.create({ data: { name: 'Online Team A', department: 'ONLINE', leaderId: tlOnline.id } })
  const teamExport = await db.team.create({ data: { name: 'Export Team A', department: 'EXPORT', leaderId: tlExport.id } })
  await db.user.update({ where: { id: tlOnline.id }, data: { teamId: teamOnline.id } })
  await db.user.update({ where: { id: tlExport.id }, data: { teamId: teamExport.id } })
  for (const u of [exO1, exO2, exO3]) await db.user.update({ where: { id: u.id }, data: { teamId: teamOnline.id } })
  for (const u of [exE1, exE2, exE3]) await db.user.update({ where: { id: u.id }, data: { teamId: teamExport.id } })

  // ---- TARGETS (current month) ----
  const targetData: Array<{ user: { id: string }; amount: number }> = [
    { user: exO1, amount: 900000 }, { user: exO2, amount: 800000 }, { user: exO3, amount: 800000 },
    { user: exE1, amount: 1500000 }, { user: exE2, amount: 1200000 }, { user: exE3, amount: 1200000 },
    { user: tlOnline, amount: 2500000 }, { user: tlExport, amount: 3900000 },
    { user: mgrOnline, amount: 2500000 }, { user: mgrExport, amount: 3900000 },
  ]
  for (const t of targetData) await db.target.create({ data: { userId: t.user.id, month: curMonth(), amount: t.amount } })

  // ---- WHATSAPP TEMPLATES ----
  const templates = await Promise.all([
    db.whatsAppTemplate.create({ data: { name: 'welcome_message', category: 'UTILITY', body: 'Namaste {{customerName}}! 🙏 Welcome to Ajmera Fashion — India\'s trusted B2B clothing house. Explore our latest collection: {{catalogLink}}', dept: null, variables: '["customerName","catalogLink"]' } }),
    db.whatsAppTemplate.create({ data: { name: 'new_collection_2025', category: 'MARKETING', body: '✨ New Festive Collection is Live! {{customerName}} ji, explore 500+ new designs in Sarees, Lehengas & Kurtis. Reply YES for catalogue & wholesale price list.', dept: null, variables: '["customerName"]' } }),
    db.whatsAppTemplate.create({ data: { name: 'payment_reminder', category: 'UTILITY', body: 'Dear {{customerName}}, your payment of ₹{{amount}} for order {{orderNo}} is pending. Kindly clear to avoid dispatch delay. — Ajmera Fashion Accounts', dept: null, variables: '["customerName","amount","orderNo"]' } }),
    db.whatsAppTemplate.create({ data: { name: 'shipment_dispatched', category: 'UTILITY', body: '📦 Good news {{customerName}}! Your order {{orderNo}} has been dispatched via {{courier}}. AWB: {{awb}}. Track here: {{trackingUrl}}', dept: null, variables: '["customerName","orderNo","courier","awb","trackingUrl"]' } }),
    db.whatsAppTemplate.create({ data: { name: 'export_catalog_share', category: 'MARKETING', body: 'Hello {{customerName}}, Greetings from Ajmera Fashion Exports! 🌍 Our international catalogue with MOQ & FOB pricing in ₹ is ready for you: {{catalogLink}}', dept: 'EXPORT', variables: '["customerName","catalogLink"]' } }),
    db.whatsAppTemplate.create({ data: { name: 'visit_reminder', category: 'UTILITY', body: 'Namaste {{customerName}} ji, this is a gentle reminder of your visit to Ajmera Fashion today at {{visitTime}}. Our team is looking forward to hosting you. 🙏', dept: 'ONLINE', variables: '["customerName","visitTime"]' } }),
  ])

  // ---- CAMPAIGNS ----
  const camp1 = await db.campaign.create({ data: { name: 'Diwali Festive Collection Blast', type: 'BROADCAST', channel: 'WHATSAPP', department: 'ONLINE', description: 'Broadcast of new festive catalogue to all active online leads', startDate: daysAgo(7), budget: 25000, status: 'COMPLETED', createdById: mgrOnline.id } })
  const camp2 = await db.campaign.create({ data: { name: 'Export Catalog Q3 Outreach', type: 'OUTGOING', channel: 'WHATSAPP', department: 'EXPORT', description: 'International catalogue sharing campaign across 30+ countries', startDate: daysAgo(3), budget: 60000, status: 'ACTIVE', createdById: mgrExport.id } })
  const camp3 = await db.campaign.create({ data: { name: 'Repeat Customer Winback', type: 'BROADCAST', channel: 'CALL', department: 'ONLINE', description: 'Telecalling winback for customers inactive 30+ days', startDate: daysAgo(1), budget: 15000, status: 'ACTIVE', createdById: tlOnline.id } })

  // ---- PRODUCTS ----
  const productSeed: Array<{ name: string; cat: string; price: number; moq: number; img: string; desc: string }> = [
    { name: 'Banarasi Silk Saree — Royal Heritage', cat: 'Sarees', price: 2450, moq: 10, img: '/products/saree-1.jpg', desc: 'Handwoven Banarasi silk saree with rich zari border. Ideal for festive exports.' },
    { name: 'Kanjivaram Pure Silk Saree', cat: 'Sarees', price: 3850, moq: 5, img: '/products/saree-2.jpg', desc: 'Premium Kanjivaram with temple border, contrast pallu.' },
    { name: 'Georgette Designer Saree Combo', cat: 'Sarees', price: 1250, moq: 20, img: '/products/saree-3.jpg', desc: 'Lightweight georgette with sequin work — fast-moving export SKU.' },
    { name: 'Bridal Lehenga — Maharani Collection', cat: 'Lehengas', price: 8500, moq: 3, img: '/products/lehenga-1.jpg', desc: 'Heavy bridal lehenga with dupatta, intricate embroidery.' },
    { name: 'Party Wear Lehenga — Starry Night', cat: 'Lehengas', price: 4200, moq: 5, img: '/products/lehenga-2.jpg', desc: 'Semi-stitched lehenga with flare 8m, velvet blouse.' },
    { name: 'Rayon Printed Kurti Set', cat: 'Kurtis', price: 480, moq: 50, img: '/products/kurti-1.jpg', desc: 'A-line rayon kurti with palazzo, assorted prints.' },
    { name: 'Chikankari Embroidered Kurti', cat: 'Kurtis', price: 890, moq: 25, img: '/products/kurti-2.jpg', desc: 'Lucknowi chikankari on soft cotton — boutique favourite.' },
    { name: 'Evening Gown — Flora Collection', cat: 'Gowns', price: 3200, moq: 5, img: '/products/gown-1.jpg', desc: 'Floor-length gown with tulle overlay, ideal for western markets.' },
    { name: 'Anarkali Gown Suit', cat: 'Gowns', price: 2650, moq: 10, img: '/products/gown-2.jpg', desc: 'Floor-length Anarkali with dupatta, festive range.' },
    { name: 'Cotton Dress Material (3-Piece)', cat: 'Dress Materials', price: 750, moq: 40, img: '/products/dress-1.jpg', desc: 'Unstitched cotton dress material with bottom & dupatta.' },
    { name: 'Silk Salwar Suit — Ajmera Signature', cat: 'Salwar Suits', price: 1650, moq: 20, img: '/products/suit-1.jpg', desc: 'Silk blend suit with heavy dupatta — premium range.' },
    { name: 'Banarasi Dupatta Assorted', cat: 'Dupattas', price: 420, moq: 50, img: '/products/dupatta-1.jpg', desc: 'Assorted zari dupattas, perfect add-on for retailers.' },
  ]
  const products: { id: string; name: string; price: number; moq: number }[] = []
  for (let i = 0; i < productSeed.length; i++) {
    const p = productSeed[i]
    const rec = await db.product.create({ data: { code: code('PRD'), name: p.name, categoryId: catMap[p.cat], sku: `AFL-${String(i + 1).padStart(3, '0')}`, moq: p.moq, price: p.price, description: p.desc, packagingDetails: 'Poly bag + export carton (as per quantity)', images: JSON.stringify([p.img]), isActive: true } })
    products.push({ id: rec.id, name: rec.name, price: p.price, moq: p.moq })
  }

  // ================= LEADS =================
  type LeadSeed = {
    dept: 'ONLINE' | 'EXPORT'; name: string; company: string; mobile: string; wa?: string; email?: string; city: string; state?: string; country?: string; bt?: string; pi?: string; src: string; stage: string; disp?: string; sub?: string; prio?: string; est?: number; budget?: number; owner: { id: string }; sticky?: boolean; status?: string; ctype?: string; createdDaysAgo: number; nextFU?: { days: number; h: number }; lastFU?: number; notes?: string; req?: string; campaign?: string; visitDate?: Date; visitTime?: string
  }
  const E = 'EXPORT', O = 'ONLINE'
  const leadSeeds: LeadSeed[] = [
    // ---------- EXPORT (International) ----------
    { dept: E, name: 'Abdullah Al Mansoori', company: 'Al Noor Trading LLC', mobile: '+971501234567', email: 'abdullah@alnoortrading.ae', city: 'Dubai', country: 'United Arab Emirates', bt: 'Wholesaler', pi: 'Sarees, Lehengas', src: 'Instagram', stage: 'Interested', disp: 'New', sub: 'Quotation Sent', prio: 'HIGH', est: 850000, budget: 900000, owner: exE1, sticky: true, createdDaysAgo: 12, nextFU: { days: 0, h: 16 }, lastFU: 1, req: 'Needs festive collection for UAE retail chain. Monthly volume ~2000 pcs.', notes: 'Very promising buyer. Prefers WhatsApp communication in Arabic/English.' },
    { dept: E, name: 'Fatima Zahra', company: 'FZ Fashions', mobile: '+212661234567', email: 'fatima@fzfashions.ma', city: 'Casablanca', country: 'Morocco', bt: 'Retailer', pi: 'Kurtis, Dress Materials', src: 'YouTube', stage: 'Quotation Sent', disp: 'Estimated', prio: 'MEDIUM', est: 320000, owner: exE2, sticky: true, createdDaysAgo: 9, nextFU: { days: 1, h: 12 }, lastFU: 2, req: 'Boutique chain, wants chikankari kurtis.', campaign: 'c2' },
    { dept: E, name: 'Sarah Johnson', company: 'Ethnic Edge LLC', mobile: '+12125550123', email: 'sarah@ethnicedge.com', city: 'New York', country: 'United States', bt: 'Distributor', pi: 'Gowns, Sarees', src: 'Alibaba', stage: 'Negotiation', disp: 'Follow-up', sub: 'Price Negotiation', prio: 'HIGH', est: 1200000, owner: exE1, sticky: true, createdDaysAgo: 20, nextFU: { days: 0, h: 18 }, lastFU: 1, req: 'US distributor for Indian ethnic wear. Needs FOB pricing & compliance docs.' },
    { dept: E, name: 'Rajesh Persaud', company: 'Guyana Garments', mobile: '+5926234567', city: 'Georgetown', country: 'Guyana', bt: 'Retailer', pi: 'Sarees', src: 'Facebook', stage: 'Order Confirmed', disp: 'Payment Done', prio: 'HIGH', est: 450000, owner: exE3, sticky: true, status: 'CONVERTED', ctype: 'REPEAT', createdDaysAgo: 30, lastFU: 3 },
    { dept: E, name: 'Chen Wei', company: 'Oriental B2B Imports', mobile: '+8613800138000', email: 'chen@orientalimports.cn', city: 'Guangzhou', country: 'China', bt: 'Export House', pi: 'Dupattas, Dress Materials', src: 'Trade Shows', stage: 'Video Call Scheduled', disp: 'Follow-up', sub: 'Interested - Needs Time', prio: 'MEDIUM', est: 600000, owner: exE2, createdDaysAgo: 6, nextFU: { days: 2, h: 15 }, lastFU: 2, req: 'Met at textile expo. Wants sample kit first.' },
    { dept: E, name: 'Amina Hassan', company: 'Zanzibar Boutique', mobile: '+255754123456', city: 'Zanzibar', country: 'Tanzania', bt: 'Boutique Owner', pi: 'Kurtis', src: 'WhatsApp', stage: 'Connected', disp: 'Callback', prio: 'LOW', owner: exE3, sticky: true, createdDaysAgo: 4, nextFU: { days: 1, h: 10 } },
    { dept: E, name: 'Priya Nair', company: 'Malé Fashions', mobile: '+9607712345', city: 'Malé', country: 'Maldives', bt: 'Retailer', pi: 'Salwar Suits', src: 'Website Forms', stage: 'Delivered', disp: 'Repeat', sub: 'Repeat Order Discussion', prio: 'MEDIUM', owner: exE1, sticky: true, status: 'CONVERTED', ctype: 'REPEAT', createdDaysAgo: 45, lastFU: 5 },
    { dept: E, name: 'Mohammed Yousuf', company: 'Riyadh Textiles', mobile: '+966501234567', email: 'myousuf@riyadhtex.sa', city: 'Riyadh', country: 'Saudi Arabia', bt: 'Wholesaler', pi: 'Sarees, Dupattas', src: 'Referral', stage: 'Payment Pending', disp: 'Collections', prio: 'HIGH', est: 980000, owner: exE2, sticky: true, createdDaysAgo: 25, nextFU: { days: 0, h: 11 }, lastFU: 1, req: 'Bulk order for Eid season.' },
    { dept: E, name: 'Linda Mwangi', company: 'Nairobi Ethnic Store', mobile: '+254712345678', city: 'Nairobi', country: 'Kenya', bt: 'Retailer', pi: 'Kurtis, Sarees', src: 'Instagram', stage: 'Catalog Shared', disp: 'New', sub: 'Catalogue Shared', prio: 'MEDIUM', owner: exE3, createdDaysAgo: 3, nextFU: { days: 1, h: 14 } },
    { dept: E, name: 'Gurpreet Singh', company: 'UK Saree Palace', mobile: '+447700900123', email: 'gurpreet@sareepalace.co.uk', city: 'Birmingham', country: 'United Kingdom', bt: 'Wholesaler', pi: 'Sarees, Lehengas', src: 'YouTube', stage: 'Interested', disp: 'New', sub: 'Sample Requested', prio: 'HIGH', est: 700000, owner: exE1, sticky: true, createdDaysAgo: 8, nextFU: { days: 0, h: 17 }, lastFU: 2 },
    { dept: E, name: 'Maria Santos', company: 'Santos Fashion Hub', mobile: '+639171234567', city: 'Manila', country: 'Philippines', bt: 'Online Seller', pi: 'Gowns', src: 'TikTok', stage: 'Attempted', disp: 'Not Connected', sub: 'No Answer', prio: 'LOW', owner: exE2, createdDaysAgo: 2 },
    { dept: E, name: 'Anwar Ali', company: 'Karachi Cloth House', mobile: '+923001234567', city: 'Karachi', country: 'Pakistan' as string, bt: 'Wholesaler', pi: 'Dress Materials', src: 'Manual Entry', stage: 'New Lead', disp: 'New', sub: 'Waiting for Customer Response', prio: 'LOW', owner: exE1, createdDaysAgo: 1 },
    { dept: E, name: 'Sokun Chan', company: 'Phnom Penh Textiles', mobile: '+85592123456', city: 'Phnom Penh', country: 'Thailand', bt: 'Distributor', pi: 'Sarees', src: 'Online', stage: 'Quotation Sent', disp: 'Estimated', prio: 'MEDIUM', est: 280000, owner: exE3, createdDaysAgo: 11, nextFU: { days: 3, h: 10 }, lastFU: 4 },
    { dept: E, name: 'Deepa Maharaj', company: 'Trini Saree Center', mobile: '+18681234567', city: 'Port of Spain', country: 'Trinidad & Tobago', bt: 'Retailer', pi: 'Sarees, Kurtis', src: 'Walk-in Customer', stage: 'Repeat Follow-up', disp: 'Repeat', sub: 'Product Selection', prio: 'MEDIUM', owner: exE2, sticky: true, status: 'CONVERTED', ctype: 'REPEAT', createdDaysAgo: 60, lastFU: 6 },
    { dept: E, name: 'Ivan Petrov', company: 'Moscow Moda', mobile: '+79161234567', city: 'Moscow', country: 'Russia', bt: 'Boutique Owner', pi: 'Lehengas', src: 'Instagram', stage: 'Closed / Lost', disp: 'Lost Lead', sub: 'MOQ Not Suitable', status: 'LOST', prio: 'LOW', owner: exE1, createdDaysAgo: 18, lastFU: 8 },
    { dept: E, name: 'Ngozi Okafor', company: 'Lagos Glamour', mobile: '+2348012345678', city: 'Lagos', country: 'Nigeria', bt: 'Retailer', pi: 'Gowns, Sarees', src: 'Facebook', stage: 'Connected', disp: 'Follow-up', sub: 'Discussing with Partner', prio: 'MEDIUM', owner: exE3, createdDaysAgo: 5, nextFU: { days: 0, h: 15 }, lastFU: 1 },
    { dept: E, name: 'Simran Kaur', company: 'Maple Ethnic Wear', mobile: '+14165550123', city: 'Toronto', country: 'Canada', bt: 'Distributor', pi: 'Salwar Suits, Kurtis', src: 'Trade Shows', stage: 'Requirement Understood', disp: 'New', sub: 'Requirement Under Discussion', prio: 'HIGH', est: 550000, owner: exE2, sticky: true, createdDaysAgo: 7, nextFU: { days: 1, h: 13 }, req: 'Wants exclusive designs for Canadian Punjabi community.' },
    { dept: E, name: 'Thandiwe Ndlovu', company: 'Joburg Fabrics', mobile: '+27821234567', city: 'Johannesburg', country: 'South Africa', bt: 'Wholesaler', pi: 'Sarees', src: 'Alibaba', stage: 'Attempted', disp: 'Not Connected', sub: 'Switched Off', prio: 'LOW', owner: exE1, createdDaysAgo: 2 },
    { dept: E, name: 'Kamala Devi', company: 'Suva Saree House', mobile: '+6791234567', city: 'Suva', country: 'Fiji', bt: 'Retailer', pi: 'Sarees', src: 'Referral', stage: 'Delivered', disp: 'Payment Done', prio: 'LOW', owner: exE3, status: 'CONVERTED', ctype: 'NEW', createdDaysAgo: 50, lastFU: 10 },
    { dept: E, name: 'Ahmed Khan', company: 'Doha Fashion Traders', mobile: '+97433123456', city: 'Doha', country: 'Qatar', bt: 'Wholesaler', pi: 'Lehengas, Sarees', src: 'WhatsApp', stage: 'Interested', disp: 'New', sub: 'Price Shared', prio: 'HIGH', est: 420000, owner: exE2, createdDaysAgo: 6, nextFU: { days: 0, h: 19 }, lastFU: 1 },
    // ---------- ONLINE (India) ----------
    { dept: O, name: 'Sunita Agarwal', company: 'Agarwal Saree Bhandar', mobile: '+919811122233', email: 'sunita@agarwalsaree.in', city: 'Surat', state: 'Gujarat', bt: 'Wholesaler', pi: 'Sarees', src: 'Call', stage: 'Order Confirmed', disp: 'Payment Done', prio: 'HIGH', est: 380000, owner: exO1, sticky: true, status: 'CONVERTED', ctype: 'REPEAT', createdDaysAgo: 15, lastFU: 2 },
    { dept: O, name: 'Manish Gupta', company: 'Gupta Fashion Point', mobile: '+919822233344', city: 'Jaipur', state: 'Rajasthan', bt: 'Retailer', pi: 'Kurtis, Dress Materials', src: 'WhatsApp', stage: 'Negotiation', disp: 'Follow-up', sub: 'Price Negotiation', prio: 'HIGH', est: 210000, owner: exO2, sticky: true, createdDaysAgo: 10, nextFU: { days: 0, h: 12 }, lastFU: 1 },
    { dept: O, name: 'Shobha Textiles', company: 'Shobha Textiles Pvt Ltd', mobile: '+919833344455', email: 'info@shobhatex.in', city: 'Mumbai', state: 'Maharashtra', bt: 'Distributor', pi: 'Sarees, Salwar Suits', src: 'Website', stage: 'Quotation Sent', disp: 'Estimated', prio: 'MEDIUM', est: 460000, owner: exO3, createdDaysAgo: 8, nextFU: { days: 1, h: 11 }, lastFU: 2, req: 'Wants dealership for Maharashtra region.' },
    { dept: O, name: 'Anita Sharma', company: 'Anita Boutique', mobile: '+919844455566', city: 'Ludhiana', state: 'Punjab', bt: 'Boutique Owner', pi: 'Lehengas', src: 'Indiamart', stage: 'Interested', disp: 'New', sub: 'Catalogue Shared', prio: 'HIGH', est: 180000, owner: exO1, createdDaysAgo: 5, nextFU: { days: 0, h: 14 }, lastFU: 1 },
    { dept: O, name: 'Ramesh Yadav', company: 'Yadav Garments', mobile: '+919855566677', city: 'Varanasi', state: 'Uttar Pradesh', bt: 'Retailer', pi: 'Sarees, Dupattas', src: 'Visit', stage: 'Connected', disp: 'Callback', prio: 'MEDIUM', owner: exO2, sticky: true, createdDaysAgo: 3, visitDate: daysAhead(1, 15), visitTime: '15:30', nextFU: { days: 1, h: 14 } },
    { dept: O, name: 'Kiran Mahajan', company: 'Kiran Sarees', mobile: '+919866677788', city: 'Nashik', state: 'Maharashtra', bt: 'Retailer', pi: 'Sarees', src: 'Referral', stage: 'Attempted', disp: 'Not Connected', sub: 'Busy', prio: 'LOW', owner: exO3, createdDaysAgo: 1 },
    { dept: O, name: 'Lakshmi Textiles', company: 'Lakshmi Textiles', mobile: '+919877788899', email: 'lakshmitex@gmail.com', city: 'Chennai', state: 'Tamil Nadu', bt: 'Wholesaler', pi: 'Kurtis', src: 'WhatsApp', stage: 'Delivered', disp: 'Repeat', sub: 'Repeat Order Discussion', prio: 'MEDIUM', owner: exO1, sticky: true, status: 'CONVERTED', ctype: 'REPEAT', createdDaysAgo: 40, lastFU: 4, nextFU: { days: 0, h: 17 } },
    { dept: O, name: 'Vivek Chowdhury', company: 'Bengal Fashion Mart', mobile: '+919888899900', city: 'Kolkata', state: 'West Bengal', bt: 'Retailer', pi: 'Dress Materials, Sarees', src: 'Call', stage: 'Payment Pending', disp: 'Collections', prio: 'HIGH', est: 290000, owner: exO2, sticky: true, createdDaysAgo: 22, nextFU: { days: 0, h: 10 }, lastFU: 1 },
    { dept: O, name: 'Rekha Patel', company: 'Patel Fashion House', mobile: '+919899900011', city: 'Ahmedabad', state: 'Gujarat', bt: 'Franchise Owner', pi: 'Sarees, Lehengas, Kurtis', src: 'Exhibition', stage: 'Requirement Understood', disp: 'New', sub: 'Requirement Under Discussion', prio: 'HIGH', est: 620000, owner: exO3, sticky: true, createdDaysAgo: 6, nextFU: { days: 2, h: 12 }, req: 'Interested in franchise for Ahmedabad flagship store.' },
    { dept: O, name: 'Suresh Rao', company: 'Hyderabad Sarees', mobile: '+919811100022', city: 'Hyderabad', state: 'Telangana', bt: 'Retailer', pi: 'Sarees', src: 'Call', stage: 'New Lead', disp: 'New', sub: 'Waiting for Customer Response', prio: 'MEDIUM', owner: exO1, createdDaysAgo: 1 },
    { dept: O, name: 'Jyoti Kumari', company: 'Patna Fashion Corner', mobile: '+919822200033', city: 'Patna', state: 'Bihar', bt: 'Retailer', pi: 'Kurtis, Dupattas', src: 'WhatsApp', stage: 'Catalog Shared', disp: 'New', sub: 'Catalogue Shared', prio: 'MEDIUM', owner: exO2, createdDaysAgo: 2, nextFU: { days: 0, h: 18 } },
    { dept: O, name: 'Harpreet Singh', company: 'Amritsar Ethnic Hub', mobile: '+919833300044', city: 'Amritsar', state: 'Punjab', bt: 'Wholesaler', pi: 'Salwar Suits', src: 'Trade Show', stage: 'Quotation Sent', disp: 'Estimated', prio: 'MEDIUM', est: 340000, owner: exO3, createdDaysAgo: 9, nextFU: { days: 1, h: 16 }, lastFU: 3 },
    { dept: O, name: 'Meena Kumari', company: 'Bhopal Saree Ghar', mobile: '+919844400055', city: 'Bhopal', state: 'Madhya Pradesh', bt: 'Retailer', pi: 'Sarees', src: 'Call', stage: 'Connected', disp: 'Follow-up', sub: 'Waiting for Stock', prio: 'LOW', owner: exO1, createdDaysAgo: 4, nextFU: { days: 5, h: 11 }, lastFU: 2 },
    { dept: O, name: 'Deepak Soni', company: 'Raipur Fashion Depot', mobile: '+919855500066', city: 'Raipur', state: 'Chhattisgarh', bt: 'Retailer', pi: 'Dress Materials', src: 'Website', stage: 'Closed / Lost', disp: 'Lost Lead', sub: 'Price Issue', status: 'LOST', prio: 'LOW', owner: exO2, createdDaysAgo: 14, lastFU: 6 },
    { dept: O, name: 'Farhan Qureshi', company: 'Bhopal Trends', mobile: '+919866600077', city: 'Indore', state: 'Madhya Pradesh', bt: 'Online Seller', pi: 'Kurtis, Gowns', src: 'Instagram', stage: 'Interested', disp: 'New', sub: 'Price Shared', prio: 'HIGH', est: 150000, owner: exO3, sticky: true, createdDaysAgo: 3, nextFU: { days: 0, h: 13 }, lastFU: 1 },
    { dept: O, name: 'Sarita Devi', company: 'Dehradun Collection', mobile: '+919877700088', city: 'Dehradun', state: 'Uttarakhand', bt: 'Boutique Owner', pi: 'Salwar Suits', src: 'Referral', stage: 'Order Confirmed', disp: 'Payment Done', prio: 'MEDIUM', est: 165000, owner: exO1, status: 'CONVERTED', ctype: 'NEW', createdDaysAgo: 18, lastFU: 1 },
    { dept: O, name: 'Vijay Malhotra', company: 'Malhotra Garments', mobile: '+919888800099', city: 'Delhi', state: 'Delhi', bt: 'Distributor', pi: 'Sarees, Lehengas, Gowns', src: 'Visit', stage: 'Payment Pending', disp: 'Collections', prio: 'HIGH', est: 540000, owner: exO2, sticky: true, createdDaysAgo: 28, visitDate: daysAgo(20, 14), visitTime: '14:00', nextFU: { days: 0, h: 15 }, lastFU: 2 },
    { dept: O, name: 'Archana Nair', company: 'Kochi Fashion Studio', mobile: '+919899900011', city: 'Kochi', state: 'Kerala', bt: 'Boutique Owner', pi: 'Kurtis, Gowns', src: 'WhatsApp', stage: 'Negotiation', disp: 'Follow-up', sub: 'Interested - Needs Time', prio: 'MEDIUM', est: 120000, owner: exO3, createdDaysAgo: 7, nextFU: { days: 1, h: 12 }, lastFU: 1 },
    { dept: O, name: 'Rakesh Kumar', company: 'Gurgaon Fashion Hub', mobile: '+919811120033', city: 'Gurugram', state: 'Haryana', bt: 'Retailer', pi: 'Sarees, Kurtis', src: 'Call', stage: 'New Lead', disp: 'New', sub: 'Sample Requested', prio: 'HIGH', est: 220000, owner: exO1, createdDaysAgo: 0, nextFU: { days: 0, h: 16 } },
    { dept: O, name: 'Priti Deshmukh', company: 'Pune Fashion Villa', mobile: '+919822230044', city: 'Pune', state: 'Maharashtra', bt: 'Retailer', pi: 'Lehengas', src: 'Indiamart', stage: 'Attempted', disp: 'Not Connected', sub: 'No Answer', prio: 'MEDIUM', owner: exO2, createdDaysAgo: 1 },
    { dept: O, name: 'Mahesh Chandra', company: 'Lucknow Chikan House', mobile: '+919833340055', city: 'Lucknow', state: 'Uttar Pradesh', bt: 'Wholesaler', pi: 'Kurtis', src: 'WhatsApp', stage: 'Delivered', disp: 'Repeat', sub: 'Dispatch Planning', prio: 'MEDIUM', owner: exO3, sticky: true, status: 'CONVERTED', ctype: 'REPEAT', createdDaysAgo: 55, lastFU: 8 },
  ]

  const convDefs: Array<{ mobile: string; name: string; dept: string; owner: { id: string; name: string }; leadIdx: number; msgs: Array<{ dir: 'IN' | 'OUT'; body: string; hoursAgo: number; status?: string }> }> = []
  const leads: Array<{ id: string; seed: LeadSeed; mobile: string; leadCode: string }> = []
  const leadCodeCounter: Record<string, number> = {}

  for (let i = 0; i < leadSeeds.length; i++) {
    const s = leadSeeds[i]
    const deptPrefix = s.dept === 'EXPORT' ? 'EXP' : 'ONL'
    leadCodeCounter[deptPrefix] = (leadCodeCounter[deptPrefix] || 0) + 1
    const leadCode = `${deptPrefix}-${String(leadCodeCounter[deptPrefix]).padStart(4, '0')}`
    const createdAt = daysAgo(s.createdDaysAgo, 9 + (i % 6), (i * 7) % 60)
    const rec = await db.lead.create({
      data: {
        leadCode,
        department: s.dept,
        customerName: s.name,
        companyName: s.company,
        mobile: s.mobile,
        whatsapp: s.dept === 'EXPORT' ? (s.wa ?? s.mobile) : (s.wa ?? null),
        email: s.email,
        city: s.city,
        stateId: s.state ? stateMap[s.state] : null,
        countryId: s.country ? countryMap[s.country] : null,
        businessTypeId: s.bt ? businessMap[s.bt] : null,
        productInterest: s.pi,
        requirementNotes: s.req,
        budget: s.budget,
        estimatedValue: s.est,
        sourceId: s.dept === 'EXPORT' ? sourceMap[s.src] : sourceMap[`ONLINE:${s.src}`],
        visitDate: s.visitDate ?? null,
        visitTime: s.visitTime ?? null,
        assignedToId: s.owner.id,
        createdById: s.owner.id,
        stageId: stageMap[`${s.dept}:${s.stage}`],
        dispositionId: s.disp ? dispMap[s.disp] : null,
        subDispositionId: s.disp && s.sub ? subDispMap[s.disp]?.[s.sub] : null,
        priority: s.prio ?? 'MEDIUM',
        notes: s.notes,
        isSticky: !!s.sticky,
        stickySince: s.sticky ? createdAt : null,
        status: s.status ?? 'ACTIVE',
        customerType: s.ctype ?? 'NEW',
        campaignId: s.campaign === 'c2' ? camp2.id : s.campaign === 'c1' ? camp1.id : null,
        lastFollowUpAt: s.lastFU ? daysAgo(s.lastFU, 12) : null,
        nextFollowUpAt: s.nextFU ? daysAhead(s.nextFU.days, s.nextFU.h) : null,
        lastContactAt: s.lastFU ? daysAgo(s.lastFU, 12) : createdAt,
        createdAt,
      },
    })
    leads.push({ id: rec.id, seed: s, mobile: s.mobile, leadCode })
    await db.activity.create({ data: { leadId: rec.id, userId: s.owner.id, type: 'LEAD', title: `Lead created via ${s.src}`, createdAt } })
  }

  // ---- FOLLOW-UPS ----
  for (const l of leads) {
    const s = l.seed
    if (s.nextFU && s.nextFU.days >= 0) {
      await db.followUp.create({ data: { leadId: l.id, assignedToId: s.owner.id, createdById: s.owner.id, dueAt: daysAhead(s.nextFU.days, s.nextFU.h), status: 'PENDING', note: s.disp === 'Callback' ? 'Customer asked to call back' : 'Follow up on discussion' } })
    }
    if (s.lastFU) {
      await db.followUp.create({ data: { leadId: l.id, assignedToId: s.owner.id, createdById: s.owner.id, dueAt: daysAgo(s.lastFU, 12), status: 'COMPLETED', note: 'Discussed requirement', outcome: 'Positive response', completedAt: daysAgo(s.lastFU, 13) } })
    }
  }
  // a few overdue follow-ups
  for (const l of [leads[2], leads[7], leads[17], leads[30]]) {
    await db.followUp.create({ data: { leadId: l.id, assignedToId: l.seed.owner.id, createdById: l.seed.owner.id, dueAt: daysAgo(2, 11), status: 'PENDING', note: 'Overdue — send revised quotation' } })
  }

  // ---- CALL LOGS ----
  const callSeeders = leads.filter((l) => l.seed.lastFU || l.seed.disp === 'Not Connected')
  for (let i = 0; i < callSeeders.length; i++) {
    const l = callSeeders[i]
    const connected = l.seed.disp !== 'Not Connected'
    await db.callLog.create({
      data: {
        leadId: l.id, userId: l.seed.owner.id,
        direction: i % 4 === 3 ? 'INCOMING' : 'OUTGOING',
        status: l.seed.disp === 'Not Connected' ? 'NOT_CONNECTED' : connected ? 'CONNECTED' : 'MISSED',
        durationSec: connected ? 60 + ((i * 37) % 500) : 0,
        channel: 'CRM',
        notes: connected ? 'Discussed catalogue and pricing' : 'Could not connect',
        createdAt: daysAgo(Math.max(0, (l.seed.lastFU ?? l.seed.createdDaysAgo) - (i % 2)), 11 + (i % 5)),
      },
    })
  }

  // ---- WHATSAPP CONVERSATIONS & MESSAGES ----
  const convLeads = leads.filter((l) => l.seed.sticky).slice(0, 10)
  for (let i = 0; i < convLeads.length; i++) {
    const l = convLeads[i]
    const owner = l.seed.owner
    const conv = await db.whatsAppConversation.create({
      data: {
        leadId: l.id, phone: (l.seed.wa ?? l.seed.mobile).replace(/\s/g, ''), name: l.seed.name, dept: l.seed.dept,
        ownerId: owner.id, unreadCount: i % 3 === 0 ? 2 : 0, label: labels[i % labels.length],
        lastMessageAt: daysAgo(0, 9 + i, 15), lastMessage: 'Theek hai, main catalogue check karta hoon 👍',
      },
    })
    const msgs: Array<{ dir: 'IN' | 'OUT'; body: string; h: number; status: string }> = [
      { dir: 'OUT', body: `Namaste ${l.seed.name} ji! 🙏 Ajmera Fashion se jude hone ke liye dhanyavaad. Yahan hamari latest collection catalogue hai.`, h: 48, status: 'READ' },
      { dir: 'IN', body: 'Hello, catalogue mil gaya. Sarees ki wholesale price list bhej dijiye.', h: 47, status: 'SENT' },
      { dir: 'OUT', body: 'Bilkul! Price list PDF bhej rahe hain. MOQ ke saath rates attach kar diye hain.', h: 46, status: 'READ' },
      { dir: 'IN', body: 'Rates theek lag rahe hain. Sample dekh sakte hain?', h: 30, status: 'SENT' },
      { dir: 'OUT', body: 'Ji haan, sample kit courier kar dete hain. Aapka address confirm kar dijiye.', h: 28, status: 'DELIVERED' },
      { dir: 'IN', body: 'Theek hai, main catalogue check karta hoon 👍', h: 2, status: 'SENT' },
    ]
    for (let m = 0; m < msgs.length; m++) {
      const msg = msgs[m]
      await db.whatsAppMessage.create({
        data: { conversationId: conv.id, userId: msg.dir === 'OUT' ? owner.id : null, direction: msg.dir, type: 'TEXT', body: msg.body, status: msg.status, createdAt: daysAgo(Math.floor(msg.h / 24), (9 + msg.h) % 20, 10 + m * 3) },
      })
    }
  }

  // ================= SALES WORKFLOW =================
  // Converted leads -> quotation -> order -> invoice -> payment -> shipment
  const converted = leads.filter((l) => l.seed.status === 'CONVERTED')
  let qNo = 0, oNo = 0, invNo = 0, payNo = 0

  async function buildSale(l: (typeof leads)[number], totalAmt: number, opts: { payRatio: number; shipStage: string | null; quoteStatus: string; orderAgeDays: number; customerType: string }) {
    qNo += 1
    const quoteNo = `QTN-${String(qNo).padStart(4, '0')}`
    const items = [
      { productId: products[l.seed.createdDaysAgo % products.length].id, name: products[l.seed.createdDaysAgo % products.length].name, qty: Math.max(5, Math.round(totalAmt / 4000)), price: products[l.seed.createdDaysAgo % products.length].price },
      { productId: products[(l.seed.createdDaysAgo + 3) % products.length].id, name: products[(l.seed.createdDaysAgo + 3) % products.length].name, qty: Math.max(5, Math.round(totalAmt / 6000)), price: products[(l.seed.createdDaysAgo + 3) % products.length].price },
    ]
    const subtotal = items.reduce((a, b) => a + b.qty * b.price, 0)
    const discount = Math.max(0, subtotal - totalAmt)
    const quote = await db.quotation.create({
      data: { quoteNo, leadId: l.id, department: l.seed.dept, items: JSON.stringify(items), subtotal, discount, total: totalAmt, status: opts.quoteStatus, validUntil: daysAhead(10), createdById: l.seed.owner.id, sentAt: daysAgo(opts.orderAgeDays + 1, 11), createdAt: daysAgo(opts.orderAgeDays + 2, 10) },
    })
    oNo += 1
    const order = await db.salesOrder.create({
      data: { orderNo: `SO-${String(oNo).padStart(4, '0')}`, leadId: l.id, quotationId: quote.id, department: l.seed.dept, items: JSON.stringify(items), total: totalAmt, customerType: opts.customerType, status: opts.shipStage === 'DELIVERED' ? 'DELIVERED' : opts.shipStage ? 'DISPATCHED' : 'CONFIRMED', createdAt: daysAgo(opts.orderAgeDays, 12), createdById: l.seed.owner.id },
    })
    const paid = Math.round(totalAmt * opts.payRatio)
    invNo += 1
    const invoice = await db.invoice.create({ data: { invoiceNo: `INV-${String(invNo).padStart(4, '0')}`, orderId: order.id, amount: totalAmt, paidAmount: paid, status: paid === 0 ? 'UNPAID' : paid >= totalAmt ? 'PAID' : 'PARTIAL', dueDate: daysAhead(7), createdAt: daysAgo(opts.orderAgeDays, 13) } })
    if (paid > 0) {
      payNo += 1
      await db.payment.create({ data: { receiptNo: `RCP-${String(payNo).padStart(4, '0')}`, leadId: l.id, orderId: order.id, invoiceId: invoice.id, department: l.seed.dept, amount: paid, mode: ['UPI', 'BANK_TRANSFER', 'CHEQUE'][payNo % 3], reference: `TXN${100000 + payNo * 137}`, isAdvance: paid < totalAmt, createdAt: daysAgo(Math.max(0, opts.orderAgeDays - 1), 14), createdById: accounts.id } })
    }
    await db.salesOrder.update({ where: { id: order.id }, data: { paidAmount: paid, paymentStatus: paid === 0 ? 'PENDING' : paid >= totalAmt ? 'PAID' : 'PARTIAL' } })
    if (opts.shipStage) {
      await db.shipment.create({
        data: { orderId: order.id, leadId: l.id, department: l.seed.dept, stage: opts.shipStage, courierName: couriers[payNo % couriers.length], awbNumber: opts.shipStage === 'PACKING' ? null : `AWB${900000000 + oNo * 123}`, trackingUrl: opts.shipStage === 'PACKING' ? null : `https://track.example.com/AWB${900000000 + oNo * 123}`, dispatchedAt: ['PACKING', 'QC'].includes(opts.shipStage) ? null : daysAgo(Math.max(0, opts.orderAgeDays - 2), 16), deliveredAt: opts.shipStage === 'DELIVERED' ? daysAgo(Math.max(0, opts.orderAgeDays - 5), 17) : null, createdAt: daysAgo(Math.max(0, opts.orderAgeDays - 1), 15) },
      })
    }
    await db.lead.update({ where: { id: l.id }, data: { status: 'CONVERTED' } })
    await db.activity.create({ data: { leadId: l.id, userId: l.seed.owner.id, type: 'ORDER', title: `Sales order ${order.orderNo} confirmed`, description: `Order value ${totalAmt}`, createdAt: daysAgo(opts.orderAgeDays, 12) } })
    return { quote, order, invoice }
  }

  // Build sales: vary payment ratio & shipment stage
  const shipStages = ['DELIVERED', 'DELIVERED', 'IN_TRANSIT', 'DELIVERED', 'PACKING', 'QC', 'DISPATCHED', null]
  for (let i = 0; i < converted.length; i++) {
    const l = converted[i]
    const total = 120000 + ((l.seed.est ?? 200000) % 500000)
    await buildSale(l, total, {
      payRatio: i % 3 === 0 ? 1 : i % 3 === 1 ? 0.5 : 1,
      shipStage: shipStages[i % shipStages.length],
      quoteStatus: 'CONVERTED',
      orderAgeDays: 3 + (i % 10),
      customerType: l.seed.ctype ?? 'NEW',
    })
  }

  // Some standalone quotations (sent / viewed / draft)
  const qLeads = [leads[0], leads[1], leads[3], leads[21], leads[23]]
  const qStatuses = ['SENT', 'VIEWED', 'ACCEPTED', 'SENT', 'DRAFT']
  for (let i = 0; i < qLeads.length; i++) {
    const l = qLeads[i]
    const p1 = products[i % products.length]
    const p2 = products[(i + 5) % products.length]
    const items = [{ productId: p1.id, name: p1.name, qty: 25, price: p1.price }, { productId: p2.id, name: p2.name, qty: 40, price: p2.price }]
    const subtotal = items.reduce((a, b) => a + b.qty * b.price, 0)
    qNo += 1
    await db.quotation.create({ data: { quoteNo: `QTN-${String(qNo).padStart(4, '0')}`, leadId: l.id, department: l.seed.dept, items: JSON.stringify(items), subtotal, discount: i === 2 ? 15000 : 0, total: subtotal - (i === 2 ? 15000 : 0), status: qStatuses[i], validUntil: daysAhead(15), createdById: l.seed.owner.id, sentAt: qStatuses[i] !== 'DRAFT' ? daysAgo(2, 10) : null, createdAt: daysAgo(3, 9) } })
    await db.activity.create({ data: { leadId: l.id, userId: l.seed.owner.id, type: 'QUOTATION', title: `Quotation shared`, createdAt: daysAgo(2, 10) } })
  }

  // extra pending-payment orders for accounts view
  const extraPayLeads = [leads[7], leads[17], leads[21]]
  for (let i = 0; i < extraPayLeads.length; i++) {
    const l = extraPayLeads[i]
    oNo += 1
    const total = 80000 + i * 45000
    const order = await db.salesOrder.create({ data: { orderNo: `SO-${String(oNo).padStart(4, '0')}`, leadId: l.id, department: l.seed.dept, items: JSON.stringify([{ productId: products[i].id, name: products[i].name, qty: 30, price: products[i].price }]), total, customerType: 'REPEAT', status: 'CONFIRMED', createdAt: daysAgo(5 + i, 11), createdById: l.seed.owner.id } })
    invNo += 1
    await db.invoice.create({ data: { invoiceNo: `INV-${String(invNo).padStart(4, '0')}`, orderId: order.id, amount: total, paidAmount: 0, status: 'UNPAID', dueDate: daysAgo(1 + i), createdAt: daysAgo(5 + i, 12) } })
    await db.activity.create({ data: { leadId: l.id, userId: accounts.id, type: 'PAYMENT', title: `Payment overdue for ${order.orderNo}`, createdAt: daysAgo(1, 9) } })
  }

  // advance payments received this month (for revenue KPI)
  for (let i = 0; i < 6; i++) {
    const l = leads[(i * 5) % leads.length]
    payNo += 1
    await db.payment.create({ data: { receiptNo: `RCP-${String(payNo).padStart(4, '0')}`, leadId: l.id, department: l.seed.dept, amount: 15000 + i * 8000, mode: 'UPI', isAdvance: true, notes: 'Advance against new order', createdAt: daysAgo(i % 20, 12 + i), createdById: accounts.id } })
  }

  // ---- TICKETS ----
  const ticketSeeds = [
    { l: leads[3], type: 'Shipment Delay', prio: 'HIGH', subj: 'Shipment delayed by 6 days', desc: 'Order SO dispatched but not delivered within promised time.', status: 'IN_PROGRESS' },
    { l: leads[6], type: 'Product Complaint', prio: 'MEDIUM', subj: 'Color variation in last batch', desc: 'Saree batch has slight color difference from approved sample.', status: 'OPEN' },
    { l: leads[16], type: 'Damage Issue', prio: 'URGENT', subj: '2 pieces damaged in transit', desc: 'Carton corner crushed, 2 lehenga pieces damaged.', status: 'ESCALATED' },
    { l: leads[20], type: 'Replacement Request', prio: 'MEDIUM', subj: 'Replace wrong size kurtis', desc: '10 pcs of L size needed instead of XL.', status: 'RESOLVED' },
    { l: leads[17], type: 'Payment Issue', prio: 'HIGH', subj: 'Payment not reflected in ledger', desc: 'UPI payment done but invoice still shows unpaid.', status: 'OPEN' },
  ]
  for (let i = 0; i < ticketSeeds.length; i++) {
    const t = ticketSeeds[i]
    const ticket = await db.supportTicket.create({
      data: { ticketNo: `TKT-${String(i + 1).padStart(4, '0')}`, leadId: t.l.id, department: t.l.seed.dept, type: t.type, priority: t.prio, subject: t.subj, description: t.desc, status: t.status, slaDueAt: daysAhead(i === 2 ? -1 : 2, 18), assignedToId: support.id, createdById: t.l.seed.owner.id, createdAt: daysAgo(i + 1, 10), resolvedAt: t.status === 'RESOLVED' ? daysAgo(i, 16) : null },
    })
    await db.ticketComment.create({ data: { ticketId: ticket.id, userId: support.id, body: 'Team ko check karne bola hai, kal tak update dunga.', isInternal: false, createdAt: daysAgo(i, 12) } })
    if (t.status === 'ESCALATED') {
      await db.ticketComment.create({ data: { ticketId: ticket.id, userId: mgrExport.id, body: 'Escalate to courier partner immediately. Customer is premium.', isInternal: true, createdAt: daysAgo(i, 14) } })
    }
  }

  // ---- MEETINGS ----
  const meetingSeeds = [
    { l: leads[4], title: 'Product demo — Kurti range', at: daysAhead(1, 15), outcome: null, link: 'https://meet.google.com/ajm-ekd-demo1' },
    { l: leads[0], title: 'UAE bulk order discussion', at: daysAhead(2, 17), outcome: null, link: 'https://meet.google.com/ajm-uae-demo2' },
    { l: leads[19], title: 'Qatar wholesale pricing review', at: daysAgo(3, 16), outcome: 'INTERESTED', link: 'https://meet.google.com/ajm-qat-demo3', notes: 'Customer wants exclusive designs for Qatar market. Follow up with quotation.' },
    { l: leads[9], title: 'UK distributor onboarding', at: daysAgo(5, 11), outcome: 'COMPLETED', link: 'https://meet.google.com/ajm-uk-demo4', notes: 'Discussed MOQ, shipping timelines and payment terms.' },
  ]
  for (const m of meetingSeeds) {
    await db.meeting.create({ data: { leadId: m.l.id, title: m.title, scheduledAt: m.at, executiveId: m.l.seed.owner.id, link: m.link, outcome: m.outcome, notes: m.notes ?? null, followUpAction: m.outcome === 'INTERESTED' ? 'Send quotation' : null } })
  }

  // ---- DOCUMENTS ----
  for (const l of [leads[0], leads[3], leads[8], leads[20]]) {
    await db.document.create({ data: { leadId: l.id, name: `Price_List_${l.seed.name.split(' ')[0]}.pdf`, type: 'PRODUCT_PDF', uploadedById: l.seed.owner.id, version: 1, createdAt: daysAgo(2, 10) } })
  }
  for (const l of [leads[2], leads[21]]) {
    await db.document.create({ data: { leadId: l.id, name: `Signed_Agreement_${l.leadCode}.pdf`, type: 'AGREEMENT', uploadedById: l.seed.owner.id, version: 2, expiryDate: daysAhead(300), createdAt: daysAgo(10, 12) } })
  }

  // ---- CAMPAIGN COUNTS ----
  await db.campaign.update({ where: { id: camp2.id }, data: { status: 'ACTIVE' } })

  // ---- NOTIFICATIONS ----
  const notifs: Array<{ u: { id: string }; title: string; body: string; type: string }> = [
    { u: exE1, title: 'New lead assigned: Gurpreet Singh', body: 'Export lead via YouTube assigned to you', type: 'LEAD' },
    { u: exE1, title: 'Follow-up due today', body: 'Sarah Johnson (Ethnic Edge LLC) — negotiation call pending', type: 'ALERT' },
    { u: exO1, title: 'Payment received ₹45,000', body: 'Advance from Sunita Agarwal (ONL-0001)', type: 'PAYMENT' },
    { u: mgrExport, title: 'Ticket escalated', body: 'TKT-0003 — Damage Issue (URGENT) escalated', type: 'TICKET' },
    { u: accounts, title: 'Invoice overdue', body: '2 invoices are past due date', type: 'PAYMENT' },
    { u: dispatch, title: '3 shipments in Packing stage', body: 'Orders waiting for packing confirmation', type: 'SHIPMENT' },
    { u: tlOnline, title: '3 overdue follow-ups in your team', body: 'Executives need to clear pending follow-ups today', type: 'ALERT' },
    { u: superAdmin, title: 'Welcome to Ajmera CRM', body: 'All departments are live. Audit logging enabled.', type: 'INFO' },
  ]
  for (const n of notifs) {
    await db.notification.create({ data: { userId: n.u.id, title: n.title, body: n.body, type: n.type } })
  }

  // ---- AUDIT LOGS ----
  const audits = [
    { u: superAdmin, action: 'SYSTEM_INIT', entity: 'System', details: 'CRM initialized with seed data' },
    { u: admin, action: 'MASTER_UPDATE', entity: 'MasterItem', details: 'Added Walk-in Customer lead source' },
    { u: mgrExport, action: 'TARGET_SET', entity: 'Target', details: 'Export team targets set for ' + curMonth() },
    { u: accounts, action: 'PAYMENT_RECORD', entity: 'Payment', details: 'Recorded advance payments batch' },
    { u: admin, action: 'LOGIN', entity: 'Auth', details: 'IP 192.168.1.10, Chrome/Windows' },
    { u: mgrOnline, action: 'LEAD_REASSIGN', entity: 'Lead', details: 'Reassigned ONL-0005 to Rahul Verma' },
  ]
  for (let i = 0; i < audits.length; i++) {
    await db.auditLog.create({ data: { userId: audits[i].u.id, userName: audits[i].u.name, action: audits[i].action, entity: audits[i].entity, details: audits[i].details, ip: '192.168.1.' + (10 + i), createdAt: daysAgo(i, 9 + i) } })
  }

  console.log('✅ Seed complete!')
  console.log(`   Users: 15 | Leads: ${leads.length} | Products: ${products.length}`)
  console.log(`   Quotations: ${qNo} | Orders: ${oNo} | Invoices: ${invNo} | Payments: ${payNo}`)
  console.log(`   Login: any email @ajmera.com | password: password123`)
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
