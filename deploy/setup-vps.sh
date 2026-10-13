#!/usr/bin/env bash
#
# Deploy / update Cloviela di VPS (idempoten — aman dijalankan berulang).
#
# Pemakaian di VPS (dari dalam folder project):
#   bash deploy/setup-vps.sh
#
# Yang dilakukan:
#   1. cek Node.js >= 20
#   2. install dependency produksi
#   3. build frontend (Vite → dist/)
#   4. pasang systemd service + jalankan
#   5. tampilkan langkah Caddy & webhook
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="cloviela"

say() { printf '\n\033[1;32m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

cd "$APP_DIR"

# ── 1. Node.js ────────────────────────────────────────────────
say "Cek Node.js"
if ! command -v node >/dev/null 2>&1; then
  die "Node.js belum terpasang. Install dulu:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js v$NODE_MAJOR terlalu tua — butuh >= 20 (node:sqlite/Firestore)."
echo "  node $(node -v) · npm $(npm -v)"

# ── 2. .env ───────────────────────────────────────────────────
say "Cek konfigurasi"
[ -f .env ] || die "File .env belum ada. Jalankan:
    cp .env.production.example .env && nano .env"

grep -q '^FIREBASE_PROJECT_ID=' .env || warn "FIREBASE_PROJECT_ID belum diisi di .env"
grep -q '^PAYMENKU_API_KEY=sk_live_\|^PAYMENKU_API_KEY=sk_test_' .env \
  || warn "PAYMENKU_API_KEY belum diisi (pembayaran akan nonaktif)"
if grep -qE '^PAYMENKU_BASE=.+' .env; then
  warn "PAYMENKU_BASE terisi — itu untuk mode mock. Kosongkan untuk Paymenku asli."
fi

# kredensial Firebase
if grep -q '^FIREBASE_SERVICE_ACCOUNT_PATH=' .env; then
  SA_PATH="$(grep '^FIREBASE_SERVICE_ACCOUNT_PATH=' .env | cut -d= -f2-)"
  [ -f "$SA_PATH" ] || die "Service account tidak ditemukan di $SA_PATH
  Upload file JSON-nya ke VPS, atau pakai FIREBASE_SERVICE_ACCOUNT=<json string>."
  echo "  service account: $SA_PATH"
elif grep -q '^FIREBASE_SERVICE_ACCOUNT=' .env; then
  echo "  service account: dari env var"
else
  warn "Kredensial Firebase Admin belum diset (FIREBASE_SERVICE_ACCOUNT_PATH / _ACCOUNT)"
fi

# ── 3. dependency + build ─────────────────────────────────────
say "Install dependency"
npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund

# devDependencies dibutuhkan untuk build (vite, react plugin)
say "Build frontend"
npm install --no-audit --no-fund --include=dev >/dev/null 2>&1 || npm install --no-audit --no-fund
npm run build

# ── 4. systemd ────────────────────────────────────────────────
say "Pasang service systemd"
if command -v systemctl >/dev/null 2>&1; then
  RUN_USER="$(id -un)"
  if [ "$RUN_USER" = "root" ]; then
    # bikin user khusus kalau dijalankan sebagai root
    id -u cloviela >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin cloviela
    chown -R cloviela:cloviela "$APP_DIR"
    RUN_USER="cloviela"
  fi

  sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null < <(
    sed -e "s|^User=.*|User=${RUN_USER}|" \
        -e "s|^WorkingDirectory=.*|WorkingDirectory=${APP_DIR}|" \
        -e "s|^ExecStart=.*|ExecStart=$(command -v node) server/index.js|" \
        -e "s|^EnvironmentFile=.*|EnvironmentFile=${APP_DIR}/.env|" \
        -e "s|^ReadWritePaths=.*|ReadWritePaths=${APP_DIR}|" \
        "${APP_DIR}/deploy/${SERVICE_NAME}.service"
  )

  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}" >/dev/null
  sudo systemctl restart "${SERVICE_NAME}"
  sleep 2
  systemctl is-active --quiet "${SERVICE_NAME}" \
    && echo "  service aktif ✓" \
    || { warn "service gagal start — cek: journalctl -u ${SERVICE_NAME} -n 50"; exit 1; }
else
  warn "systemd tidak ada — jalankan manual: NODE_ENV=production node server/index.js"
fi

# ── 5. health check ───────────────────────────────────────────
say "Health check"
PORT_VAL="$(grep -E '^PORT=' .env | cut -d= -f2- || echo 8787)"
sleep 1
curl -fsS "http://127.0.0.1:${PORT_VAL}/api/health" | head -c 400 || warn "API belum merespons"

# ── 6. langkah manual ─────────────────────────────────────────
say "Selesai — langkah terakhir (manual, sekali saja)"
cat <<'EOF'

  1) Reverse proxy + HTTPS (Caddy):
       sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
       sudo nano /etc/caddy/Caddyfile      # ganti domain & email
       sudo systemctl reload caddy

  2) Daftarkan webhook di dashboard Paymenku:
       https://<domain-kamu>/api/webhook/paymenku

  3) Tambahkan domain ke Firebase (wajib, kalau tidak login Google gagal):
       Firebase Console → Authentication → Settings → Authorized domains
       → Add domain: <domain-kamu>
     lalu deploy ulang redirect URI:
       npx -y firebase-tools@latest deploy --only auth --project cloviela1

  Update berikutnya cukup:
       git pull && npm run deploy:vps

  Lihat log:
       journalctl -u cloviela -f
EOF
