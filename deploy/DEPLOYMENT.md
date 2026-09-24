# 🚀 Ajmera Fashion CRM — LIVE Deployment Guide (Hinglish)

## ⚠️ Pehle ye samjho: Netlify pe ye CRM KYUN nahi chalega

| Problem | Wajah |
|---|---|
| **401 Locked Site** | Aapki Netlify site pe "Site protection / Edge Access" ON hai — Netlify login ke bina koi bhi page nahi khulega. Isliye `/super-admin` pe bhi login redirect aa raha hai. |
| **Database gayab ho jayegi** | Ye CRM **SQLite database** use karti hai (leads, messages, calls, orders — sab usme). Netlify serverless hota hai — disk temporary hai. Har thodi der baad DB **reset** → saara data udd jayega. |
| **Real-time chalega hi nahi** | Incoming call popup aur WhatsApp live chat ek **socket service** (alag running process, port 3003) se chalti hai. Netlify long-running process host **nahi** kar sakta. |
| **Webhooks kaam nahi karenge** | Alendei/telephony provider jo call/message events bhejte hain wo DB me save hote hain — serverless ephemeral disk pe impossible. |
| **`/super-admin` route exist hi nahi karta** | Pura CRM ek hi route `/` pe hai — login screen khulegi, wahan **Super Admin** button se login hota hai. Alag admin URL nahi hai. |

> Netlify sirf **static marketing website** ke liye theek hai. CRM ke liye **VPS lo** — ₹300–500/month me sab kuch chalega.

---

## ✅ Sahi Tarika: VPS + Domain (recommended)

### Step 1 — VPS kharido (5 min)
Koi bhi ek:
- **Hostinger VPS** (KVM 2) — ~₹450/month
- **DigitalOcean Droplet** — $6/month
- **AWS Lightsail** — $5/month
- **Contabo** — sabse sasta

**Specs:** Ubuntu 24.04 · 2 vCPU · 4GB RAM · 40GB SSD — bas itna kaafi hai.

### Step 2 — Domain point karo (5 min)
Apne domain provider (GoDaddy/Namecheap/Cloudflare) me jao:
```
Type: A     Name: crm     Value: <VPS ki public IP>     TTL: 300
```

### Step 3 — Project VPS pe upload karo (5 min)
Apne laptop/PC se (ya GitHub se clone karo):
```bash
ssh root@<VPS-IP>
apt update && apt install -y git
git clone <aapka-repo-url> /var/www/crm      # ya scp se folder upload karo
```

### Step 4 — .env banao (5 min)
```bash
cd /var/www/crm
cp deploy/.env.production.example .env
nano .env
```
Fill karo:
- `PUBLIC_BASE_URL=https://crm.aapkadomain.com`
- `WHATSAPP_API_KEY=` → FlexiWaba panel se
- `SIP_*` fields → telephony provider se
- Secrets generate karo (har command alag value degi):
```bash
openssl rand -hex 24   # COMM_WEBHOOK_SECRET
openssl rand -hex 24   # INTERNAL_EVENT_SECRET
openssl rand -hex 16   # CONFIG_ENCRYPTION_KEY
```

### Step 5 — EK COMMAND me deploy (10 min)
```bash
sudo bash deploy/deploy-vps.sh
```
Script khud karega: Bun install → dependencies → database → build → systemd services → Caddy + **free SSL certificate** → firewall → start.

Bas! `https://crm.aapkadomain.com` khulega — SSL ke saath, 2 min me.

### Step 6 — Pehli login + security (5 min)
1. Login screen khulo → Super Admin → `superadmin@ajmera.com / password123`
2. **Turant** Users page pe jao → har account ka password change karo
3. Demo accounts jo chahiye nahi, unhe Inactive kar do

### Step 7 — WhatsApp + Calling connect karo
- **Alendei panel** me webhook daalo (CRM → Settings → Communication → WhatsApp me copy button se URL mil jayega)
- **Telephony provider** panel me voice events URL daalo (SIP settings page se copy)
- Health dashboard (`Settings → Communication Health`) pe sab green aa jayega

---

## 🔄 Update kaise karein (naya code deploy)

```bash
cd /var/www/crm
git pull                    # ya naya code upload
bun install
bunx prisma generate && bunx prisma db push
bun run build
systemctl restart af-crm af-crm-socket
```

## 🛠️ Daily Operations Cheat-Sheet

| Kaam | Command |
|---|---|
| Status dekho | `systemctl status af-crm af-crm-socket caddy` |
| App logs | `tail -f /var/log/af-crm/app.log` |
| Socket logs | `tail -f /var/log/af-crm/socket.log` |
| Restart sab | `systemctl restart af-crm af-crm-socket caddy` |
| **Backup (roz)** | `cp /var/www/crm/db/custom.db /root/backups/crm-$(date +%F).db` |

### Automatic daily backup (ek baar chalao)
```bash
mkdir -p /root/backups
(crontab -e me add karo)
0 2 * * * cp /var/www/crm/db/custom.db /root/backups/crm-$(date +\%F).db && find /root/backups -mtime +30 -delete
```

---

## 🐳 Docker path (optional, agar Docker pasand hai)

```bash
cd /var/www/crm          # .env ready hona chahiye
DOMAIN=crm.aapkadomain.com docker compose -f deploy/docker-compose.yml up -d --build
```
DB Docker volume me persist hoti hai (`crm-db` volume).

---

## 🔴 Sabse zaroori 3 cheezein (bhoolna mat)

1. **PUBLIC_BASE_URL** set karo warna webhooks nahi aayenge
2. Pehli login ke baad **passwords change** karo
3. **Daily backup** cron lagao — SQLite file copy = pura CRM backup
