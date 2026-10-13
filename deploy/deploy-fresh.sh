#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
#  Cloviela Router — deploy ULANG di VPS (bersih dari nol)
#  Jalankan di VPS: bash deploy-fresh.sh
# ══════════════════════════════════════════════════════════════
set -euo pipefail
APP="/opt/cloviela"
DOMAIN="router.cloviela.my.id"

say() { printf '\n▸ %s\n' "$1"; }
ok()  { printf '  ✓ %s\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

[ -f "$APP/.env" ]    || die "$APP/.env tidak ada".
[ -f "$APP/secrets/firebase-service-account.json" ] || die "secrets/firebase-service-account.json tidak ada"

# ── 1. dependency ──────────────────────────────────────────────
say "install dependency"
cd "$APP"
rm -rf node_modules
npm install --no-audit --no-fund 2>&1 | tail -1 || true

# ── 2. build frontend ──────────────────────────────────────────
say "build frontend"
npm run build 2>&1 | tail -1

# ── 3. systemd ─────────────────────────────────────────────────
say "pasang systemd service"
sudo tee /etc/systemd/system/cloviela.service >/dev/null <<'UNIT'
[Unit]
Description=Cloviela Router
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/cloviela
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
EnvironmentFile=/opt/cloviela/.env
Environment=NODE_ENV=production
SyslogIdentifier=cloviela

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable cloviela -q
sudo systemctl restart cloviela
sleep 4

systemctl is-active cloviela >/dev/null || {
  echo "--- log ---"
  sudo journalctl -u cloviela -n 30 --no-pager
  die "cloviela.service gagal start"
}
ok "cloviela.service: aktif"

# ── 4. sertifikat ──────────────────────────────────────────────
say "generate sertifikat origin (self-signed)"
sudo mkdir -p /etc/ssl/cloviela
if [ ! -f /etc/ssl/cloviela/origin.crt ]; then
  sudo openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout /etc/ssl/cloviela/origin.key \
    -out /etc/ssl/cloviela/origin.crt \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN"
  sudo chmod 600 /etc/ssl/cloviela/origin.key
fi
ok "sertifikat siap"

# ── 5. nginx ───────────────────────────────────────────────────
say "konfigurasi nginx"
sudo tee /etc/nginx/sites-available/cloviela >/dev/null <<'CONF'
server {
    listen 80;
    listen [::]:80;
    server_name router.cloviela.my.id;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name router.cloviela.my.id;

    ssl_certificate /etc/ssl/cloviela/origin.crt;
    ssl_certificate_key /etc/ssl/cloviela/origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 2m;

    location = /api/webhook/paymenku {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 60s;
    }

    location /v1/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
CONF
sudo ln -sf /etc/nginx/sites-available/cloviela /etc/nginx/sites-enabled/cloviela
sudo nginx -t 2>&1 | tail -1 || die "nginx config error"
sudo systemctl reload nginx
ok "nginx configured"

# ── 6. verifikasi ──────────────────────────────────────────────
say "verifikasi"
curl -s -m 5 "http://127.0.0.1:8787/api/health" >/dev/null && ok "api :8787"
curl -sk -m 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null && ok "https via nginx"

printf '\n✓ Deploy selesai.\n'
echo "  app     : https://$DOMAIN"
echo "  webhook : https://$DOMAIN/api/webhook/paymenku"
echo "  logs    : journalctl -u cloviela -f"
