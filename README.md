# Cloviela — Router AI

Website + backend layanan **router AI unlimited** (Rp15.000 / 7 hari).
Login user pakai **Google (Firebase Auth)**, database **Cloud Firestore**,
pembayaran otomatis lewat **Paymenku (QRIS)**, notifikasi pembelian masuk ke
**Telegram admin** — user tidak perlu chat, semua di web.

```
VPS (1 server)  →  Express: serve React build + /api + /v1 + webhook Paymenku
Firebase        →  Auth (Google Sign-In) + Firestore (database)   ← gratis
```

Kenapa begitu? Project `cloviela1` belum pakai plan Blaze, jadi Cloud Functions
belum tersedia. Dengan Express di VPS, kamu tidak perlu billing Firebase sama
sekali dan hanya ada satu tempat untuk di-deploy.

---

## Isi repo

```
server/                 # Express API + Firestore
├── index.js            # route: auth, checkout, webhook, /v1 proxy, admin
├── firebase.js         # Firebase Admin SDK (Auth + Firestore) — project cloviela1
├── store.js            # data layer Firestore (users, subs, payments, keys, usage)
├── paymenku.js         # create transaction, check status, verifikasi webhook HMAC
├── telegram.js         # notifikasi admin
src/                    # React (Vite) — landing, checkout, dashboard, admin
scripts/                # seed, smoke test, mock upstream & mock Paymenku
deploy/                 # systemd service, Caddyfile, setup-vps.sh
firestore.rules         # security rules (sudah dideploy)
firestore.indexes.json  # composite indexes (sudah dideploy)
firebase.json           # config Firebase (auth provider + firestore)
```

**Firebase yang sudah disiapkan** (project `cloviela1`, region Jakarta):
- Web app terdaftar: `cloviela web` (`1:513134013669:web:7d9dd2652bf20ef153f80c`)
- Google Sign-In aktif (authorized: `localhost`, `router.cloviela.my.id`)
- Firestore database `(default)` — lokasi `asia-southeast2`
- Security rules + indexes ter-deploy
- Service account untuk server: `secrets/firebase-service-account.json` (gitignored)

**Admin**: email di `ADMIN_EMAILS` (sekarang `clovvalencied@gmail.com`) otomatis
dapat role `admin` saat pertama login Google.

### Cek cepat semuanya jalan

```bash
npm run smoke        # Firebase Auth → langganan → /v1 chat + stream
npm run test:webhook # signature webhook + aktivasi otomatis + idempotensi
npm run test:rules   # security rules (PII, eskalasi role, api_keys tertutup)
```

---

## 1. Jalankan lokal

```bash
npm install
cp .env.example .env      # sudah terisi kredensial cloviela1
npm run dev               # api :8787 + web :5177
```

Login pakai Google langsung jalan (domain `localhost` sudah diizinkan).

### Uji tanpa akun Paymenku

```bash
npm run mock:paymenku     # :9099 — API tiruan + pengirim webhook
npm run mock:upstream     # :9999 — provider AI tiruan (OpenAI-compatible)
```

`.env` (mode dev sudah begini):
```bash
PAYMENKU_API_KEY=sk_test_mock
PAYMENKU_BASE=http://localhost:9099/api/v1
PAYMENKU_WEBHOOK_SECRET=whsec_test_123
```

Lunasi transaksi dari terminal:
```bash
curl -X POST localhost:9099/__pay -H 'Content-Type: application/json' \
     -d '{"trx_id":"IDP…"}'      # → webhook "paid" → langganan aktif + key terbit
```

Verifikasi otomatis:
```bash
npm run smoke              # Firebase Auth → langganan → /v1 chat + stream
npm run test:webhook       # signature + idempotensi webhook
```

---

## 2. Alur pembayaran (otomatis penuh)

```
user klik Beli
  → POST /api/checkout        → Paymenku create transaction (QRIS)
  → QR tampil                 → user scan & bayar
  → Paymenku kirim webhook    → POST /api/webhook/paymenku
      • verifikasi HMAC-SHA256 + anti-replay 5 menit
      • idempoten (webhook_events/{trx_id} pakai create → atomic)
      • langganan aktif +7 hari (perpanjang dari expires_at kalau masih jalan)
      • API key terbit otomatis
      • notif Telegram ke admin
  → halaman bayar auto-pindah → dashboard, key langsung tampil
```

Status pembayaran di halaman bayar memakai **realtime listener Firestore**
(`users/{uid}/payments/{id}`) — begitu webhook menulis `paid`, UI langsung
berubah tanpa polling. Polling server tetap ada sebagai fallback.

---

## 3. Konfigurasi `.env`

| Variabel | Nilai |
|---|---|
| `FIREBASE_*` | sudah terisi untuk project `cloviela1` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | `secrets/firebase-service-account.json` (gitignored) |
| `PAYMENKU_API_KEY` | `sk_live_…` dari dashboard Paymenku |
| `PAYMENKU_WEBHOOK_SECRET` | Settings → Webhook |
| `ADMIN_EMAILS` | email Google kamu — hanya ini yang bisa buka `/admin` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ADMIN_CHAT_ID` | notif pembelian |
| `APP_URL` | URL publik (untuk `return_url` pembayaran) |
| `PRICE_IDR` / `PLAN_DAYS` | default `15000` / `7` |
| `PAYMENT_METHODS` | default `qris` — isi `qris,bca_va` kalau mau buka metode lain |
| `GLOBAL_RPM` / `GLOBAL_CONCURRENT` | kuota total semua user (default `60` / `5`) — melindungi provider |
| `USER_RPM` / `USER_CONCURRENT` | kuota per akun (default `30` / `3`) — isi `0` untuk mematikan |

Untuk production pakai `.env.production.example` sebagai acuan.

---

## 4. Endpoint

### Publik
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/health` | status + backend + mode pembayaran |
| GET | `/api/config` | harga, masa aktif, config Firebase untuk frontend |
| GET | `/api/models` | daftar model aktif |

### User (butuh Firebase ID token: `Authorization: Bearer <idToken>`)
| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/auth/sync` | pastikan dokumen user ada di Firestore |
| GET | `/api/me` | profil + langganan + key aktif |
| GET | `/api/channels` | channel pembayaran (QRIS) |
| POST | `/api/checkout` | buat transaksi |
| GET | `/api/payments`, `/api/payments/:ref` | riwayat & status |
| POST | `/api/keys/rotate`, `/api/keys/revoke` | kelola API key |
| GET | `/api/usage` | statistik request (agregat) |
| GET | `/api/logs` | log request lengkap — filter `?status=ok\|error&model=&limit=&offset=` |
| POST | `/api/playground` | **coba model langsung dari dashboard** (tercatat di log) |

### Admin (email di `ADMIN_EMAILS`)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/admin/stats` | ringkasan (user, langganan, revenue, request) |
| GET | `/api/admin/users` | daftar user + cari |
| POST | `/api/admin/users/:id/extend` | perpanjang manual (`+7d` / `+30d`) |
| POST | `/api/admin/users/:id/revoke` | revoke semua key user |
| GET | `/api/admin/payments` | semua pembayaran |
| GET/POST/PATCH/DELETE | `/api/admin/providers` | provider upstream |
| GET | `/api/admin/providers/:id/test` | **tes koneksi provider** + daftar model upstream |
| GET/POST/PATCH/DELETE | `/api/admin/models` | model |
| POST | `/api/admin/models/:id/test` | **tes satu model** (kirim chat nyata) |
| POST | `/api/admin/models/test-all` | **tes semua model** sekaligus |

### Gateway OpenAI-compatible
```
GET  /v1/models
POST /v1/chat/completions     (stream & non-stream)
```
Auth: `Authorization: Bearer clv_…` → cek key → cek langganan → teruskan ke provider.

---

## 5. Provider & model — generik, tidak di-hardcode

Provider **apa pun** yang kompatibel OpenAI bisa ditambah dari
**Admin → Provider & Model**: provider resmi, agregator, atau endpoint custom
milikmu sendiri. Jumlahnya bebas.

- **Provider**: `name`, `base_url`, `api_key` (opsional), enable/disable, bisa diedit
- **Model**: `model_id` (**alias publik**), `label`, `provider`, `upstream_name`
  (nama asli di provider), `context_len`, deskripsi, enable/disable

### Alias publik — nama provider tidak pernah bocor

User hanya melihat **alias publik** (`clv-flash`, `clv-nova`, …). Nama asli model
dan nama provider disimpan di server saja:

| Yang disimpan | Contoh | Dilihat user? |
|---|---|---|
| `model_id` (alias publik) | `clv-flash` | ✅ ya |
| `upstream_name` (nama asli) | `deepseek-v4.1-flash` | ❌ tidak |
| `provider.name` | `Provider Rahasia` | ❌ tidak |
| `provider.base_url` | `https://api.internal/v1` | ❌ tidak |

- `GET /api/models` hanya mengirim `id` (alias), `label`, `description`, `context_len`
- Request user memakai alias; server memetakan ke `upstream_name` saat memanggil provider
- Memakai nama asli langsung lewat API → **404 model_not_found**
- **Ganti alias kapan saja** dari admin (tombol `ganti` di tabel model) — kode user
  yang masih memakai alias lama akan 404, jadi kabari mereka dulu. `upstream_name` tidak berubah.
- Tombol **saran** di form model menghasilkan alias netral yang belum terpakai

### Cek model masih hidup (fitur admin)

| Tombol | Yang dilakukan |
|---|---|
| **tes koneksi** (per provider) | `GET {base_url}/models` di upstream → status, latensi, dan daftar model yang tersedia. Model yang ditemukan tapi belum terdaftar muncul sebagai tombol `+ model-id` (klik untuk langsung menambahkan). |
| **tes** (per model) | Kirim chat pendek nyata ke upstream memakai `upstream_name` → status, latensi, dan cuplikan jawaban. Sama seperti yang dialami user. |
| **⚡ tes semua model** | Uji seluruh model sekaligus, tampilkan ringkasan sehat/gagal. |

Hasil tes disimpan (`last_test`) sehingga dashboard admin selalu menampilkan
kartu **MODEL SEHAT / BERMASALAH** tanpa perlu tes ulang.

---

## 6. Struktur Firestore

```
users/{uid}                          profil (email, name, photo, role)
users/{uid}/subscriptions/{id}       langganan
users/{uid}/payments/{id}            pembayaran
api_keys/{keyId}                     key (hash + prefix) — tidak bisa dibaca client
usage_logs/{autoId}                  log request
providers/{id}, models/{modelId}     konfigurasi (models boleh dibaca publik)
trx_index, ref_index                 lookup webhook (internal)
webhook_events/{trxId}               idempotensi webhook
```

Security rules: default **deny**, PII hanya owner, `role` tidak bisa diubah user,
`api_keys` sama sekali tertutup untuk client (dilayani endpoint `/api/me`).

---

## 7. Deploy ke VPS

Di VPS (Ubuntu/Debian, Node.js ≥ 20):

```bash
git clone <repo> /opt/cloviela && cd /opt/cloviela
cp .env.production.example .env
nano .env                      # isi PAYMENKU_*, ADMIN_EMAILS, TELEGRAM_*, APP_URL

# upload service account Firebase ke secrets/ (scp dari laptop):
#   scp secrets/firebase-service-account.json user@vps:/opt/cloviela/secrets/

npm run deploy:vps             # install deps, build, pasang systemd, jalankan
```

Lalu sekali saja:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo nano /etc/caddy/Caddyfile
sudo systemctl reload caddy            # HTTPS otomatis
```

**Wajib:** tambahkan domain ke Firebase → Authentication → Settings →
Authorized domains, lalu:

```bash
npx -y firebase-tools@latest deploy --only auth --project cloviela1
```

Daftarkan webhook di dashboard Paymenku:
`https://<domain-kamu>/api/webhook/paymenku`

Update berikutnya: `git pull && npm run deploy:vps`
Log: `journalctl -u cloviela -f`

---

## 8. Rate limit

Dua lapis, keduanya in-memory (tanpa Redis), pakai token bucket untuk RPM:

| Lapis | Variabel | Default | Tujuan |
|---|---|---|---|
| Global RPM | `GLOBAL_RPM` | 60 | melindungi provider upstream dari lonjakan total |
| Global concurrent | `GLOBAL_CONCURRENT` | 5 | batasi request paralel ke provider |
| Per user RPM | `USER_RPM` | 30 | jaring pengaman: 1 akun tidak menghabiskan kuota global |
| Per user concurrent | `USER_CONCURRENT` | 3 | batasi request paralel per akun |

**Token bucket**, bukan reset per menit: kuota terisi ulang bertahap tiap detik.

Artinya: **pemakaian merata tidak akan diblokir** — kalau kamu kirim 1 request tiap
2 detik (30/menit), itu pas di batas dan tetap lancar. Yang ditolak adalah **lonjakan**
— misalnya 50 request sekaligus dalam 1 detik. Ini disengaja supaya pemakaian wajar
tidak terganggu, tapi penyalahgunaan tetap dibatasi.

Saat terlampaui, server membalas **HTTP 429** dengan:

```
Retry-After: 2
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
X-RateLimit-Scope: user
```

```json
{"error":{"message":"Terlalu banyak request dari akunmu (batas 30/menit)…",
          "code":"rate_limit","retry_after":2,"scope":"user"}}
```

Set `0` untuk mematikan lapis mana pun. Kalau nanti jalan di beberapa server,
ganti penyimpanan counter di `server/limiter.js` ke Redis — antarmukanya sengaja
dibuat sederhana supaya mudah ditukar.

Uji: `npm run test:limits` (butuh server hidup; ikut menguji kebocoran slot).

## 9. Keamanan

- API key Paymenku hanya di server, tidak pernah ke browser.
- API key user disimpan sebagai **SHA-256 hash**; raw hanya tampil sekali.
- Auth: Firebase ID token diverifikasi Admin SDK tiap request (stateless, tanpa sesi server).
- Webhook: HMAC-SHA256 atas `timestamp + "." + raw_body`, tolak > 5 menit, idempoten.
- Admin: allowlist email, dicek di server **dan** di security rules.
- `secrets/` dan `.env` sudah masuk `.gitignore`.
