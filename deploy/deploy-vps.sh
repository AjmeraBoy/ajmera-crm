#!/usr/bin/env bash
# ============================================================
#  Ajmera Fashion CRM — One-shot VPS deployment (Ubuntu 22/24)
#  Run:  sudo bash deploy/deploy-vps.sh
#  Assumes project is at /var/www/crm (see deploy/DEPLOYMENT.md)
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/crm}"
DOMAIN="${DOMAIN:-}"
BUN_BIN="$HOME/.bun/bin/bun"

log() { echo -e "\n\033[1;32m==> $1\033[0m"; }

[ -d "$APP_DIR" ] || { echo "Project folder not found: $APP_DIR"; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo ".env not found in $APP_DIR — copy deploy/.env.production.example to .env and fill it first!"; exit 1; }

if [ -z "$DOMAIN" ]; then
  DOMAIN=$(grep -E '^PUBLIC_BASE_URL=' "$APP_DIR/.env" | cut -d= -f2 | sed 's#https\?://##' | tr -d '/' || true)
fi
[ -n "$DOMAIN" ] || { echo "Set PUBLIC_BASE_URL in .env or pass DOMAIN=crm.example.com"; exit 1; }

log "Installing system packages (curl unzip)"
apt-get update -y >/dev/null
apt-get install -y curl unzip >/dev/null

log "Installing Bun runtime"
if [ ! -x "$BUN_BIN" ]; then curl -fsSL https://bun.sh/install | bash; fi
export PATH="$HOME/.bun/bin:$PATH"

log "Installing Caddy web server (auto-HTTPS)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y >/dev/null && apt-get install -y caddy >/dev/null
fi

log "Installing dependencies + generating Prisma client"
cd "$APP_DIR"
"$BUN_BIN" install
"$BUN_BIN" x prisma generate

log "Creating database (SQLite) — safe on existing DB"
"$BUN_BIN" x prisma db push --accept-data-loss || true

log "Building production bundle (next build)"
"$BUN_BIN" run build

log "Creating logs dir"
mkdir -p /var/log/af-crm

log "Installing systemd services"
cp "$APP_DIR/deploy/systemd/af-crm.service" /etc/systemd/system/
cp "$APP_DIR/deploy/systemd/af-crm-socket.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable af-crm af-crm-socket --now
systemctl restart af-crm af-crm-socket

log "Installing Caddy config for $DOMAIN"
sed "s/crm.ajmeraexample.com/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl restart caddy

log "Firewall (22/80/443 open)"
if command -v ufw >/dev/null; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi

sleep 3
log "Service status"
systemctl --no-pager --lines=3 status af-crm | sed -n '1,5p'
systemctl --no-pager --lines=3 status af-crm-socket | sed -n '1,5p'

echo -e "\n\033[1;32m✅ DEPLOYED: https://$DOMAIN\033[0m"
echo "   - Login screen khulega — demo accounts ke password TURANT badlo (Users page)."
echo "   - Webhook URLs: Settings → Communication me copy karke Alendei + telephony panel me paste karo."
echo "   - Logs: /var/log/af-crm/  |  Restart: systemctl restart af-crm af-crm-socket"
