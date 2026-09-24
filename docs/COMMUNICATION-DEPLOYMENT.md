# Communication System — LIVE Deployment Guide

WhatsApp (Alendei/FlexiWaba) + SIP/Dialer + Webhooks + Real-time — production configuration and QA reference.

---

## 1. Architecture

```
             CRM (Next.js 16, port 3000)
              |
    ----------------------                     ----------------------
    |                    |                     |  socket-relay svc  |
WhatsApp Service      DialerService          |  :3003 (ws, public |
(Alendei provider)    (SIP REST templates)   |  via ?XTransformPort|
    |                    |                   |  :3004 internal API |
Alendei API          SIP Provider            ----------------------
    |                    |
WhatsApp Business   Agent extension → Customer
    |
 Customer
        ↘ inbound events via webhooks:
          POST /api/webhooks/whatsapp   (messages + delivery/read/failed)
          POST /api/webhooks/voice      (call lifecycle + recordings)
        → Customer 360 unified timeline (WhatsApp + Calls + Notes + Tasks)
```

- The **API key never reaches the browser**. All provider calls run server-side (`src/lib/comm/*`).
- Credentials are stored **AES-256-GCM encrypted** in the DB, or provided via env (env wins).
- Webhook processing is **idempotent** (WebhookEvent.dedupeKey). Duplicates are recorded, never double-processed.
- Every provider call is logged in **ApiLog** (secrets redacted) and campaign sends in **CampaignLog**.

## 2. Environment variables (.env — see .env.example)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file path |
| `WHATSAPP_API_BASE_URL` | `https://autoapi.alendei.io` (or `https://backend.api-wa.co`) |
| `WHATSAPP_API_KEY` | Client's FlexiWaba API key — **overrides** the value saved in Settings UI |
| `WHATSAPP_BUSINESS_NUMBER` | `+912613547700` |
| `COMM_WEBHOOK_SECRET` | Required on all webhook calls (`?secret=` or `x-webhook-secret`) |
| `INTERNAL_EVENT_SECRET` | Shared secret: Next API ↔ socket relay (never exposed) |
| `CONFIG_ENCRYPTION_KEY` | AES-256-GCM master key (`openssl rand -hex 32`) |
| `PUBLIC_BASE_URL` | Public https origin — used to build absolute media URLs Alendei can fetch |
| `SIP_PROVIDER/SIP_SERVER/SIP_USERNAME/SIP_PASSWORD/SIP_PORT/SIP_TRANSPORT/SIP_CALLER_ID` | SIP credentials (password overrides Settings UI) |

Generate secrets: `openssl rand -hex 24` (webhook/internal), `openssl rand -hex 32` (encryption key).
**Never commit real values.**

## 3. Alendei (FlexiWaba) panel setup

1. **API Campaign**: create an API Campaign (e.g. `catalogue_share`) bound to an **approved** template with its variables; **Set Live**. Alendei rejects sends when the campaign is not live or `templateParams` count ≠ template variables — the CRM enforces this before calling.
2. **API key**: copy from FlexiWaba *Manage → API key*. Set it via `WHATSAPP_API_KEY` env (preferred) or Settings → Communication → WhatsApp (stored encrypted; shown only as `••••••••xxxx`).
3. **Webhook**: point Alendei's webhook/event URL to
   `{PUBLIC_BASE_URL}/api/webhooks/whatsapp?secret=<COMM_WEBHOOK_SECRET>`
   (also accepts header `x-webhook-secret`). Meta-style GET verification (`hub.challenge`) is supported.
4. If Alendei's event payload differs from the Meta Cloud API shape, check **API Logs → Webhook Events**: every raw payload is archived with status `UNRECOGNIZED` (no data loss); adapt `normalizeWhatsappPayload()` in `src/lib/comm/webhook-service.ts` (single function) and re-process.

### Real API used (from Alendei official docs)
```
POST {WHATSAPP_API_BASE_URL}/campaign/flexiwaba/api
{
  "apiKey": "...",            // server-side only
  "campaignName": "...",      // live API campaign
  "destination": "9198...",
  "userName": "...",          // optional
  "source": "ajmera-crm",
  "media": { "url": "...", "filename": "..." },  // media templates only, must be publicly fetchable
  "templateParams": ["p1", "p2"],                 // count MUST match campaign template
  "tags": [], "attributes": {}
}
```
Retry policy: 3 attempts, exponential backoff (0s/2s/8s), only on 5xx/429/network — same `requestId` (no duplicates). Non-retryable: 401/403/400/404 (surface readable messages; technical detail in ApiLog).

## 4. SIP / Dialer setup

The CRM drives the telephony provider over HTTP (click-to-call: agent extension first, then customer):

1. Settings → Communication → SIP / Dialer: fill provider, server, username, password, port, transport (UDP/TCP/TLS), caller ID `+912613547700`, agent extensions per user (Users & Teams → SIP Extension).
2. **Click-to-Call API URL** template (from your SIP provider's REST API), placeholders:
   `{agent} {customer} {caller_id} {server} {extension} {call_id}` — the CRM POSTs JSON `{agent, customer, caller_id, crm_call_id}` with Basic auth (username/password).
3. **Call Action API URL** template: `{call_id} {action} {target}` for HOLD / UNHOLD / MUTE / TRANSFER / END.
4. **Voice webhook**: point the provider's call-events webhook to
   `{PUBLIC_BASE_URL}/api/webhooks/voice?secret=<COMM_WEBHOOK_SECRET>`.
   Recognized events (flexible normalizer): `incoming/ringing/answered/hold/unhold/transfer/recording/ended/missed/no_answer/busy/failed/cancel` with fields `call_id, customer_number, agent_number/extension, direction, duration_sec, recording_url`. Call logs, duration, recordings and timeline entries are created automatically; missed calls can trigger automations.

## 5. Real-time service

- `mini-services/socket-service` — start with `bun run dev` (port 3003 public via gateway `?XTransformPort=3003`, port 3004 internal publish API on localhost only).
- Sessions are validated against the CRM (`/api/auth/validate-session`); room joins validated (`/api/comm/validate-room`).
- Follow-up automations scheduler: POST `/api/comm/cron/followups` every 5–15 min (internal secret or Super Admin session).

## 6. Endpoint reference

**Public webhooks** (secret-protected): `GET/POST /api/webhooks/whatsapp`, `POST /api/webhooks/voice`
**Internal** (`x-internal-secret`): `POST /api/auth/validate-session`, `POST /api/comm/validate-room`, `POST /api/comm/cron/followups`
**Settings/Admin**: `GET|PUT /api/comm/settings`, `POST /api/comm/settings/test`, `GET /api/comm/health`, `POST /api/comm/health/test`
**Logs (mgmt)**: `GET /api/comm/api-logs`, `GET /api/comm/campaign-logs`, `GET /api/comm/webhook-events`
**Automations (mgmt)**: `GET|POST|PATCH|DELETE /api/automations`, `POST /api/automations/run`, `GET /api/automations/logs`
**WhatsApp**: `GET|POST|PATCH /api/whatsapp/messages`, `GET|POST|PATCH /api/whatsapp/templates`, `GET /api/whatsapp/conversations`
**Calls**: `GET|POST|PATCH /api/calls`, `POST /api/calls/click-to-call`, `POST /api/calls/command`
**Leads**: standard routes + `PATCH /api/leads/optin`
**Files**: `POST /api/files` (multipart ≤15MB), `GET /api/files/[id]?token=`

## 7. QA checklist (honest status)

| Item | Status | Evidence |
|---|---|---|
| Webhook endpoint + secret auth | **PASS** | 401 on wrong secret; Meta GET verify implemented; UI "TEST WEBHOOK" → CONNECTED (53ms, PROCESSED) |
| Inbound WhatsApp message → auto lead + conversation | **PASS** | LEAD-000042 auto-created (source WhatsApp, OPTED_IN) via real Meta-format webhook |
| Duplicate webhook prevention | **PASS** | Same payload replay → `DUPLICATE`, no second message |
| Delivery / read / failed status flow | **PASS** | `delivered`→`read` webhooks updated message + timestamps + live tick |
| Opt-in enforcement | **PASS** | Template send blocked for NOT_OPTED_IN; free-text blocked outside 24h window |
| Template variables (Alendei rule) | **PASS** | Dynamic inputs + count enforcement before API call |
| Outbound send path (real API) | **PASS (code path) / PENDING CREDENTIALS** | Full path incl. retry/idempotency/logs verified; actual delivery needs the real `WHATSAPP_API_KEY` + live campaign — currently the send fails fast with a readable "key not configured" message |
| Incoming call popup (known/new caller) | **PASS** | Real voice webhook → popup with lead info / New Caller + Create Lead loop |
| Call lifecycle logging | **PASS** | ringing→answered→ended(42s) → CallLog CONNECTED; missed → MISSED |
| Click-to-call | **PASS (code path) / PENDING PROVIDER** | Config-template driven; readable error when provider unconfigured |
| Real-time updates | **PASS** | socket relay via gateway; live message + call events in browser |
| API key never in frontend | **PASS** | Masked `••••••••xxxx`; server-only resolver; secrets redacted in all logs |
| Role permissions | **PASS** | Settings/tests = SUPER_ADMIN/ADMIN; logs = +MANAGER; API enforces via requireUser |

**Pending customer actions to go fully LIVE:** (1) set `WHATSAPP_API_KEY` env + create live API campaign(s) in FlexiWaba + configure their webhook URL; (2) provide SIP provider's click-to-call REST endpoint + call-events webhook. Both are configuration-only (no code changes).
