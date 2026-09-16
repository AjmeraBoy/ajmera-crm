# Ajmera CRM — API Contract (v1)

All agents MUST follow this contract exactly. All files are Next.js App Router route handlers under `src/app/api/`.

## Shared Helpers (ALREADY EXIST — do not recreate)

```ts
// @/lib/db          → export const db  (Prisma client)
// @/lib/api         → ok(data, status?), fail(msg, status?), route(handler), requireUser(roles?), readBody<T>(req),
//                       ApiError(msg, status), deptScope(user), assertDeptAccess(user, dept), isManagement(user), audit(user, action, entity, entityId, details),
//                       notify(userId, title, body?, type?, link?), parseDate(str), parseList(str)
// @/lib/auth        → getSessionUser(), createSession(userId), destroySession(), SESSION_COOKIE, type SessionUser
// @/lib/password    → hashPassword(pw), verifyPassword(pw, hash)
// @/lib/server-utils→ nextCode(prefix, counter), leadPrefix(dept), pickExecutiveRoundRobin(dept), findMaster(type, label, dept?)
// @/lib/format      → formatINR, formatDate, formatDateTime, timeAgo (client-safe)
// Prisma client model names: db.whatsAppConversation, db.whatsAppMessage, db.whatsAppTemplate (capital A!), others camelCase (db.lead, db.followUp, db.callLog, db.masterItem, db.salesOrder...)
```

- Every route exports handlers wrapped in `route(...)` from `@/lib/api`.
- Auth: `await requireUser()` or `await requireUser(['ADMIN','SUPER_ADMIN'])`. Throws ApiError → handled.
- Errors: throw `new ApiError('message', 400|401|403|404|409)`.
- Query params via `new URL(req.url).searchParams`.
- Scope by department: `deptScope(user)` returns `null` (all, only SUPER_ADMIN) or `['ONLINE']`/`['EXPORT']` → filter `department: { in: scope }` on department-bearing models.
- EXECUTIVE sees only own records: filter `assignedToId: user.id` (leads, followups), `ownerId: user.id` (conversations), `userId: user.id` (calls).
- All money = integer whole ₹.
- Mutations on leads create `Activity` (type: CALL|WHATSAPP|NOTE|DISPOSITION|STAGE|ASSIGNMENT|FOLLOWUP|QUOTATION|ORDER|PAYMENT|DISPATCH|TICKET|MEETING|DOCUMENT|BROADCAST|SYSTEM|LEAD|AI_CALL) + `audit()` where relevant.

## STICKY OWNERSHIP LOGIC (critical)
- When an EXECUTIVE calls/WhatsApp/logs contact on a lead → if `lead.isSticky === false` set `isSticky: true, stickySince: now`.
- Only TEAM_LEADER / MANAGER / ADMIN / SUPER_ADMIN can reassign (change assignedToId) or unstick.
- On reassignment: lead.assignedToId=new, isSticky=true, stickySince=now; conversations owner moves; Activity ASSIGNMENT; notify new owner.

## DISPOSITION DYNAMIC LOGIC (critical)
Disposition extra JSON: `{"showCallback":true}` | `{"showEstimated":true}` | `{"showPayment":true}` | `{"showFollowUp":true}`. Sub-dispositions = master type `sub_disposition` with parentId.
When PATCH includes dispositionUpdate {dispositionId, subDispositionId?, callbackAt?, followUpAt?, paymentAmount?, estimatedValue?, note?}:
- Set lead.dispositionId/subDispositionId; parse disposition.extra.
- showCallback && callbackAt → lead.nextFollowUpAt=callbackAt + create FollowUp(PENDING, dueAt=callbackAt, note)
- showFollowUp && followUpAt → same as above with followUpAt
- showEstimated && estimatedValue → lead.estimatedValue=value
- showPayment && paymentAmount → create Payment(receiptNo=nextCode('RCP','payment'), leadId, amount=paymentAmount, mode=body.dispositionUpdate.mode||'UPI', department=lead.department) + Activity(PAYMENT)
- Always Activity(DISPOSITION, title "Disposition: <label>") + lead.lastContactAt=now (+ isSticky for exec)

## ENDPOINTS

### Auth
- `POST /api/auth/login` {email,password} → verify hashPassword vs user.password; 401 invalid; createSession(userId); set cookie SESSION_COOKIE httpOnly lax path=/ maxAge 7d (use `await cookies()` from next/headers); audit LOGIN; → {user: SessionUser + team{id,name,department}}
- `POST /api/auth/logout` → destroySession + clear cookie → {success:true}
- `GET /api/auth/me` → {user} | 401 (user includes team{id,name,department} if teamId)

### Masters (dynamic master data engine)
- `GET /api/masters?types=disposition,country&dept=&onlyActive=1` → {items} sorted order asc. types=comma list (required). dept filter → dept in (dept,'ALL').
- `POST /api/masters` {type,label,value?,parentId?,dept?='ALL',extra?,order?} (ADMIN,SUPER_ADMIN,MANAGER) → {item}
- `PATCH /api/masters` {id,...updates incl isActive} → {item}
- `DELETE /api/masters?id=` → soft isActive=false → {success:true}

### Users
- `GET /api/users?role=&dept=&q=&teamId=&active=1` → {users:[{id,name,email,role,department,phone,languages,teamId,team{id,name},isActive,dailyCallTarget}]}
- `POST /api/users` {name,email,password,role,department?,phone?,languages?,teamId?,dailyCallTarget?} (ADMIN,SUPER_ADMIN) → 409 dup email → {user}
- `PATCH /api/users` {id,...fields incl password?} → {user}
- `DELETE /api/users?id=` → soft isActive=false → {success}

### Teams
- `GET /api/teams?dept=` → {teams:[{id,name,department,leader{id,name},members[{id,name,role}]}]}
- `POST /api/teams` {name,department,leaderId?} (ADMIN,SUPER_ADMIN) → {team}
- `PATCH /api/teams` {id,name?,leaderId?} → {team}

### Targets
- `GET /api/targets?month=YYYY-MM&userId=&dept=` → {targets:[{id,userId,month,amount,user{id,name,role,department}}]}
- `POST /api/targets` {month, items:[{userId,amount}]} upsert (MANAGER,ADMIN,SUPER_ADMIN; TEAM_LEADER own team only) → {targets}

### Notifications
- `GET /api/notifications?unread=1&limit=20` → {notifications, unreadCount} (own only, desc)
- `PATCH /api/notifications` {id?} or {all:true} → mark read

### Audit
- `GET /api/audit?q=&limit=100&page=1` (ADMIN,SUPER_ADMIN) → {logs, total}

### Settings
- `GET /api/settings` → {settings:{key:value}}
- `PUT /api/settings` {key,value} or {settings:{k:v}} (ADMIN,SUPER_ADMIN) → {settings}

### Dashboard `GET /api/dashboard?dept=&range=today|week|month&teamId=&userId=`
Scope: userId param (if permitted) else self for EXECUTIVE/TL personal cards; dept scope for org numbers.
- workingDays = Number(Setting WORKING_DAYS || 26); todaysTarget = round(monthlyTarget/workingDays)
- achieved = sum(Payment.amount) in current month (scoped); todaysAchieved = payments today
- Response (all keys present, 0/[] defaults):
```
{ role, department,
  kpis: { monthlyTarget, todaysTarget, achieved, remaining, achievementPct, todaysAchieved, todaysProgressPct,
    totalLeads, activeLeads, convertedLeads, lostLeads, conversionPct, stickyLeads, newLeadsToday,
    callsToday, connectedToday, missedToday, followupsToday, overdueFollowups, unreadChats,
    pendingPayments, pendingPaymentsCount, ordersInProgress, shipmentsPending, repeatCustomers, revenueMonth, videoCallsScheduled },
  charts: { pipeline:[{name,count}], sources:[{name,count}], geo:[{name,leads,converted,revenue}],
    trend:[{date:'DD MMM',leads,revenue}](14 days), teamPerformance:[{userId,name,target,achieved,pct}] },
  lists: { todaysFollowups:[{id,lead:{id,leadCode,customerName,department},dueAt,note}],
    overdueFollowups:[...], recentLeads:[{id,leadCode,customerName,department,createdAt,stage{label}}],
    executivePerformance:[{userId,name,target,achieved,pct,todaysTarget,todaysAchieved,pendingCalls,pendingFollowups,conversionPct,stickyLeads,salesAmount}] } }
```
- EXECUTIVE: personal scope. TL: personal + team executivePerformance + team geo. MANAGER/ADMIN/SUPER_ADMIN: department org + teamPerformance + executivePerformance.
- ACCOUNTS: payments-focused kpis. DISPATCH: shipment kpis. SUPPORT: ticket kpis (open/inProgress/escalated/resolvedToday in kpis as pendingPaymentsCount etc. — use sensible mapping).
- geo: EXPORT→group by country label; ONLINE→state label. pipeline: count leads per pipeline_stage (dept's stages).

### Leads
- `GET /api/leads` params: q, dept, stageId, dispositionId, subDispositionId, sourceId, countryId, stateId, assignedToId, teamId, status, priority, sticky=1, followup=today|overdue|upcoming, visit=today, from, to, page=1, pageSize=20, sort=createdAt|nextFollowUpAt|customerName|priority, dir
  → {leads:[LeadDTO with relations: assignedTo{id,name}, stage{id,label,extra}, disposition{id,label,extra}, subDisposition{id,label}, source{id,label}, country{id,label}, state{id,label}], total, page, pageSize, summary:{total,active,converted,lost,sticky}}
  - EXECUTIVE: own only. TL: own + team (teamId param can scope). Management: dept scope.
  - followup=today → nextFollowUpAt within today & status ACTIVE; overdue → nextFollowUpAt < startOfToday & ACTIVE; upcoming → > endOfToday.
- `POST /api/leads` {department, customerName, mobile, sourceId, ...optional companyName, whatsapp, email, city, stateId, countryId, businessTypeId, productInterest, requirementNotes, monthlyVolume, budget, visitDate, visitTime, priority, notes, stageId, campaignId, assignedToId?, allowDuplicate?}
  - dup check mobile+department → 409 {error, existing:{id,leadCode,customerName}} unless allowDuplicate
  - EXPORT && !whatsapp → whatsapp=mobile
  - leadCode nextCode(leadPrefix(dept),'lead'); stage default findMaster('pipeline_stage','New Lead',dept)
  - assignment: management + assignedToId → that; EXECUTIVE → self; else pickExecutiveRoundRobin(dept)
  - if source=Visit (check source label) && !visitDate → 400
  - Activity LEAD → {lead: detail shape}
- `GET /api/leads/detail?id=` → {lead:{...all scalars + master relations + assignedTo{id,name,role,phone,email} + createdBy{id,name}}, activities(desc,+user{name}), followups(+assignedTo{name}), callLogs(desc,+user{name}), quotations(desc), orders(desc,+invoices,+shipment), payments(desc), tickets, meetings(desc), documents(desc), conversations:[{id,phone,unreadCount,lastMessageAt}]}
- `PATCH /api/leads` {id, ...scalars, stageId?, dispositionUpdate?} — EXEC only own lead; changes → Activity (STAGE "Stage: old → new" / DISPOSITION rules above); isSticky auto for exec → {lead: detail shape}
- `POST /api/leads/assign` {leadIds:[], assignedToId, unsticky?} (TEAM_LEADER,MANAGER,ADMIN,SUPER_ADMIN) → reassign + conv owner + Activity ASSIGNMENT + notify → {updated}
- `POST /api/leads/bulk` {department, rows:[{customerName,mobile,sourceId,...}]} (MANAGEMENT) → dedupe by mobile (in-file + DB per dept); round-robin assign; Activity; → {created, skipped:[{mobile,reason}]}
- `GET /api/leads/export` (same filters as list, no pagination) → {rows:[{leadCode,customerName,companyName,mobile,whatsapp,city,state,country,source,stage,disposition,subDisposition,priority,estimatedValue,assignedTo,status,nextFollowUpAt,createdAt}]}
- `DELETE /api/leads?id=` (ADMIN,SUPER_ADMIN) → {success}
- `POST /api/leads/note` {leadId, note} → lead.notes append + Activity NOTE → {activity}

### Follow-ups
- `GET /api/followups?due=today|overdue|upcoming|completed|all&assignedToId=&teamId=&dept=&page=&pageSize=` → {followups:[{id,lead:{id,leadCode,customerName,mobile,department,stage{label}},dueAt,status,note,outcome,assignedTo{name}}], total}
- `POST /api/followups` {leadId,dueAt,note?} → + lead.nextFollowUpAt + Activity → {followup}
- `PATCH /api/followups` {id,status,outcome?,rescheduleTo?,note?} → COMPLETED: lead.lastFollowUpAt=now, Activity; RESCHEDULED: dueAt=rescheduleTo, lead.nextFollowUpAt → {followup}

### Calls
- `GET /api/calls?leadId=&userId=&teamId=&direction=&status=&from=&to=&page=&pageSize=` → {calls:[{id,lead{id,leadCode,customerName,mobile,department},user{name},direction,status,durationSec,notes,channel,createdAt}], total, summary:{total,incoming,outgoing,missed,connected,notConnected,avgTalkTimeSec}}
- `POST /api/calls` {leadId,direction,status,durationSec,notes?,isVideo?} → CallLog; lead.lastContactAt=now; sticky if exec; Activity CALL title like "Outgoing call — Connected (2m 15s)" → {call}

### WhatsApp (Prisma: db.whatsAppConversation / db.whatsAppMessage / db.whatsAppTemplate)
- `GET /api/whatsapp/conversations?dept=&q=&label=` → {conversations:[{id,phone,name,label,dept,unreadCount,lastMessage,lastMessageAt,owner{id,name},lead{id,leadCode,customerName,department}}]} — EXEC own; TL self+team; mgr+ dept
- `GET /api/whatsapp/messages?conversationId=&page=` → {messages(desc→asc display order asc by createdAt), conversation:{...}}; sets unreadCount=0 if owner views
- `POST /api/whatsapp/messages` {conversationId, body?, type?=TEXT, mediaName?, templateId?} → OUT msg SENT; conv.lastMessage/At; sticky+Activity WHATSAPP if leadId → {message}
- `PATCH /api/whatsapp/messages` {conversationId, action:'simulate_reply'|'advance_status', body?} → reply: IN msg + unreadCount++; advance: latest OUT SENT→DELIVERED→READ → {message} | {updated}
- `GET /api/whatsapp/templates?dept=` → {templates}
- `POST /api/whatsapp/templates` {name,category,body,dept?} (ADMIN,SUPER_ADMIN) → {template}
- `POST /api/whatsapp/broadcast` {name?, templateId?|body, dept, filters:{stageIds?,countryIds?,stateIds?,dispositionIds?,status?}, campaignId?} (TEAM_LEADER+) → leads max 500; ensure conversation per lead (phone=whatsapp||mobile, owner=assignedTo||first exec); OUT message status SENT campaignId; Activity BROADCAST; create Campaign if name && !campaignId → {sent, campaignId?}

### Campaigns
- `GET /api/campaigns?dept=&status=` → {campaigns:[{...c, createdBy{name}, leadsCount, messagesCount}]}
- `POST /api/campaigns` {name,type,channel,department?,description?,startDate?,endDate?,budget?} → {campaign}
- `PATCH /api/campaigns` {id,status?,conversions?,revenue?,description?} → {campaign}

### Meetings
- `GET /api/meetings?leadId=&upcoming=1&dept=&from=&to=` → {meetings:[{id,lead{id,leadCode,customerName,department},title,scheduledAt,link,outcome,notes,followUpAction,executive{name}}]}
- `POST /api/meetings` {leadId,title,scheduledAt,link?} → default link https://meet.google.com/ajm-{6 random}; Activity MEETING; notify owner → {meeting}
- `PATCH /api/meetings` {id,outcome?,notes?,followUpAction?,scheduledAt?} → Activity if outcome → {meeting}

### Products
- `GET /api/products?q=&categoryId=&active=&page=` → {products:[{...p, images: string[] parsed, category{id,label}}], total}
- `POST /api/products` {name,categoryId?,price,moq,sku?,description?,packagingDetails?,fabricDetails?,images?:[],video?} (ADMIN,SUPER_ADMIN,MANAGER) → code nextCode('PRD','product') → {product}
- `PATCH /api/products` {id,...} → {product}
- `DELETE /api/products?id=` → soft isActive=false → {success}

### Quotations
- `GET /api/quotations?leadId=&status=&q=&dept=&page=` → {quotations:[{...q, lead{id,leadCode,customerName,companyName,department,mobile}, createdBy{name}}], total}
- `POST /api/quotations` {leadId,items:[{productId,name,qty,price}],discount?,validUntil?,notes?} → compute subtotal=(Σ qty*price), total=subtotal-discount; quoteNo nextCode('QTN','quotation'); dept from lead; Activity QUOTATION → {quotation}
- `PATCH /api/quotations` {id,status?,items?,discount?,validUntil?,notes?} → SENT→sentAt=now+Activity; CONVERTED via orders API only (400 here) → {quotation}

### Orders
- `GET /api/orders?leadId=&status=&paymentStatus=&q=&dept=&page=` → {orders:[{...o, lead{id,leadCode,customerName,department,mobile}, shipment, invoices, createdBy{name}}], total, summary:{count,total,pending,partial,paid}}
- `POST /api/orders` {leadId,quotationId?,items:[{productId,name,qty,price}],discount?,customerType?,notes?} → orderNo nextCode('SO','order'); total=Σ-discount; if quotationId→quotation.status=CONVERTED; lead.status=CONVERTED; lead stage→findMaster('pipeline_stage','Order Confirmed',dept) if found; Activity ORDER → {order}
- `PATCH /api/orders` {id,status?,paymentStatus?,notes?} → {order}

### Invoices
- `GET /api/invoices?status=&q=&dept=&page=` → {invoices:[{...i, order{orderNo,lead{id,leadCode,customerName,department}}}], total, summary:{totalAmount, outstanding}}
- `POST /api/invoices` {orderId,dueDate?} → invoiceNo nextCode('INV','invoice'), amount=order.total → {invoice}
- `PATCH /api/invoices` {id,status?,dueDate?,notes?} → {invoice}

### Payments
- `GET /api/payments?leadId=&orderId=&dept=&mode=&from=&to=&q=&page=` → {payments:[{...p, lead{id,leadCode,customerName}, order{orderNo}, invoice{invoiceNo}, createdBy{name}}], total, summary:{total, thisMonth, today}}
- `POST /api/payments` {leadId?,orderId?,invoiceId?,amount,mode?,reference?,isAdvance?,notes?,paidAt?} → receiptNo nextCode('RCP','payment'); update invoice (paidAmount+=amount, status UNPAID/PARTIAL/PAID/keep OVERDUE logic simple) & order (paidAmount+=amount, paymentStatus PENDING/PARTIAL/PAID); Activity PAYMENT; notify lead owner → {payment}
- `PATCH /api/payments` {id,notes?,mode?,reference?} → {payment}

### Shipments
- `GET /api/shipments?stage=&dept=&q=&page=` → {shipments:[{...s, order{orderNo,total,lead{id,leadCode,customerName,department,mobile}}}], total, summary:{packing,qc,dispatched,inTransit,delivered}}
- `POST /api/shipments` {orderId,courierName?,awbNumber?,notes?} → stage PACKING; order.status=IN_PROCESS; Activity DISPATCH → {shipment}
- `PATCH /api/shipments` {id,stage?,courierName?,awbNumber?,trackingUrl?,proofUrl?,notes?} → stage DISPATCHED→dispatchedAt=now+order.status=DISPATCHED+WhatsApp msg to lead+Activity; DELIVERED→deliveredAt=now+order.status=DELIVERED → {shipment}

### Tickets
- `GET /api/tickets?status=&dept=&q=&assignedToId=&page=` → {tickets:[{...t, lead{id,leadCode,customerName}, assignedTo{name}}], total, summary:{open,inProgress,escalated,resolvedToday}}
- `POST /api/tickets` {leadId?,type,priority?,subject,description?} → ticketNo nextCode('TKT','ticket'); slaDueAt=now+(URGENT 8h|HIGH 24h|MEDIUM 48h|LOW 72h); Activity TICKET; notify support+assignee → {ticket}
- `PATCH /api/tickets` {id,status?,priority?,assignedToId?,type?} → RESOLVED/CLOSED→resolvedAt; ESCALATED→notify managers; Activity → {ticket}
- `POST /api/tickets/comment` {ticketId,body,isInternal?} → {comment}
- `GET /api/tickets/comments?ticketId=` → {comments:[{id,body,isInternal,createdAt,user{name}}]}

### Documents
- `GET /api/documents?leadId=&type=&q=` → {documents:[{...d, lead{id,leadCode,customerName}, uploadedBy{name}}]}
- `POST /api/documents` {leadId?,name,type?,url?,expiryDate?,version?} → Activity DOCUMENT → {document}
- `DELETE /api/documents?id=` → {success}

### AI Visit Reminder (Online dept)
- `GET /api/visits/upcoming?dept=` → {leads:[{id,leadCode,customerName,visitDate,visitTime,mobile,assignedTo{name}}]} (visitDate >= startOfToday, dept ONLINE)
- `POST /api/visits/remind` {leadId, outcome?: 'Answered'|'Failed'|'Confirmed'|'Rejected'} → CallLog(channel AI_REMINDER, direction OUTGOING, status outcome==='Failed'?'NOT_CONNECTED':'CONNECTED', notes "AI Reminder Call — Ajay Sir voice — <outcome>") + Activity AI_CALL + notification → {ok:true, outcome}

### Reports `GET /api/reports?type=...&dept=&from=&to=&userId=&teamId=`
- `lead-conversion` → {summary:{total,converted,lost,conversionPct}, funnel:[{stage,count}]}
- `executive-performance` → {rows:[{userId,name,team,leadsAssigned,calls,connected,followupsDone,conversions,salesAmount,target,achievementPct}]}
- `revenue` → {rows:[{month:'YYYY-MM',orders,revenue}], totalRevenue}
- `geo` → {rows:[{name,leads,converted,lost,pending,revenue,conversionPct}]} (EXPORT→country, ONLINE→state)
- `source-wise` → {rows:[{name,leads,converted,conversionPct,revenue}]}
- `dispatch` → {rows:[{stage,count}], aging:[{bucket:'0-2d'|'3-5d'|'6-10d'|'10d+',count}]}
- `outstanding` → {rows:[{invoiceNo,orderNo,leadCode,customer,amount,paidAmount,dueDate,daysOverdue,status}], totals:{outstanding,overdue}}
- `collection` → {rows:[{month,amount,count}], total}
- `new-vs-repeat` → {newCount,repeatCount,newRevenue,repeatRevenue}
- `call-quality` → {rows:[{name,callsMade,connected,notConnected,missed,avgTalkTimeSec,conversionRatio}]}
- `followup-compliance` → {rows:[{name,pending,overdue,completed,compliancePct}]}
- `campaign-roi` → {rows:[{id,name,type,leads,messages,conversions,revenue,budget,roiPct}]}
- `sticky-performance` → {rows:[{name,stickyLeads,convertedFromSticky,salesFromSticky}]}
All respect dept scope + userId/teamId.

## Conventions
- Query-param ids (no dynamic [id] segments). One route.ts per resource path above.
- ESLint must pass — no unused imports, no explicit any leaks (use unknown + casts where needed).
- Dates serialize as ISO via JSON. Return DTO shapes exactly as above.
- Do NOT modify shared lib files, schema, or other agents' API files.
