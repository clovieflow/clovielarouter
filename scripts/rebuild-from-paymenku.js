/**
 * Bangun ULANG langganan + riwayat pembayaran dari riwayat transaksi Paymenku.
 *
 * Konteks: saat migrasi, Firestore kena kuota harian sehingga data asli
 * (langganan, key, pembayaran) belum bisa diekspor. Paymenku menyimpan
 * transaksinya sendiri — lengkap dengan `customer_email` dan `paid_at` —
 * jadi langganan user bisa direkonstruksi:
 *
 *   tiap transaksi `paid` = +PLAN_DAYS hari, ditumpuk berurutan dari
 *   `paid_at` (persis logika store.activateSubscription).
 *
 * Baris hasil rekonstruksi ditandai `provisional: true` dengan id berawalan
 * `prov_` — `scripts/import-localdb.js` membuangnya dan menggantinya dengan
 * data asli begitu ekspor Firestore berhasil.
 *
 * Pemakaian:
 *   node scripts/rebuild-from-paymenku.js           # pratinjau (default)
 *   node scripts/rebuild-from-paymenku.js --apply   # tulis ke database
 *
 * Butuh: PAYMENKU_API_KEY (live) + kredensial Firebase (untuk daftar email↔uid).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const APPLY = process.argv.includes('--apply');
const PLAN_DAYS = Number(process.env.PLAN_DAYS || 7);
const PRICE_IDR = Number(process.env.PRICE_IDR || 15000);
const PENDING_HOURS = 72; // rekreasi QR pending yang masih mungkin dibayar

/* ── Firebase Auth: email ↔ uid (Auth tidak kena kuota Firestore) ── */
function authUsers() {
  const path =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    (existsSync(resolve('secrets/firebase-service-account.json')) ? resolve('secrets/firebase-service-account.json') : null);
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    : path
      ? cert(JSON.parse(readFileSync(path, 'utf8')))
      : undefined;
  const app = getApps().length ? getApps()[0] : initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'cloviela1', credential });
  return getAuth(app);
}

async function allAuthUsers(auth) {
  const out = [];
  let page = await auth.listUsers(1000);
  for (;;) {
    for (const u of page.users) {
      out.push({
        uid: u.uid,
        email: (u.email || '').toLowerCase(),
        name: u.displayName || (u.email || '').split('@')[0],
        created_at: u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
      });
    }
    if (!page.pageToken) break;
    page = await auth.listUsers(1000, page.pageToken);
  }
  return out;
}

/* ── Paymenku: semua transaksi (paginate sampai habis) ── */
async function allPaymenkuTx() {
  const key = process.env.PAYMENKU_API_KEY;
  if (!key) throw new Error('PAYMENKU_API_KEY kosong');
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`https://paymenku.com/api/v1/transactions?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`paymenku_${res.status}`);
    const json = await res.json();
    const data = json?.data || [];
    rows.push(...data);
    if (data.length < 100) break;
  }
  return rows;
}

/* ── hitungan langganan: tumpuk +PLAN_DAYS dari tiap pembayaran ── */
function subscriptionFor(paidTxns) {
  const sorted = [...paidTxns].sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at));
  let expiry = 0;
  for (const t of sorted) {
    const paidAt = new Date(t.paid_at).getTime();
    const base = Math.max(paidAt, expiry); // kalau masih aktif → menumpuk, bukan reset
    expiry = base + PLAN_DAYS * 864e5;
  }
  return {
    starts_at: sorted[0].paid_at,
    expires_at: new Date(expiry).toISOString(),
    paid_count: sorted.length,
    last_paid_at: sorted.at(-1).paid_at,
    amount_idr: PRICE_IDR * sorted.length,
  };
}

/* ── jalan ── */
const auth = authUsers();
const users = await allAuthUsers(auth);
const byEmail = new Map(users.map((u) => [u.email, u]));
const txns = await allPaymenkuTx();

const paid = txns.filter((t) => t.status === 'paid' && t.paid_at && t.customer_email);
const pendingRecent = txns.filter(
  (t) => t.status === 'pending' && t.customer_email && Date.now() - new Date(t.created_at).getTime() < PENDING_HOURS * 3600e3
);

const byUser = new Map();
for (const t of paid) {
  const u = byEmail.get(String(t.customer_email).toLowerCase());
  if (!u) continue;
  if (!byUser.has(u.uid)) byUser.set(u.uid, { user: u, paid: [], pending: [] });
  byUser.get(u.uid).paid.push(t);
}
for (const t of pendingRecent) {
  const u = byEmail.get(String(t.customer_email).toLowerCase());
  if (!u) continue;
  if (!byUser.has(u.uid)) byUser.set(u.uid, { user: u, paid: [], pending: [] });
  byUser.get(u.uid).pending.push(t);
}

console.log(`\nAuth: ${users.length} akun · Paymenku: ${txns.length} transaksi (paid ${paid.length}, pending ${pendingRecent.length})\n`);

const matched = new Set([...paid, ...pendingRecent].map((t) => String(t.customer_email).toLowerCase()));
const orphan = [...matched].filter((e) => !byEmail.has(e));
if (orphan.length) console.log(`⚠ email pembayar tanpa akun login (dilewati): ${orphan.length}`);

if (!APPLY) {
  console.log('— PRATINJAU (tulis dengan --apply) —\n');
  for (const [uid, { user, paid: p, pending }] of byUser) {
    const sub = p.length ? subscriptionFor(p) : null;
    const aktif = sub && new Date(sub.expires_at) > new Date();
    console.log(
      `${user.email.padEnd(34)} ${p.length ? `${p.length}x bayar → s/d ${sub.expires_at.slice(0, 10)} ${aktif ? '(aktif)' : '(lewat)'}` : '(belum bayar)'}` +
        `${pending.length ? ` · ${pending.length} QR pending` : ''}`
    );
  }
  process.exit(0);
}

/* ── tulis ke database ── */
const { db, C } = await import('../server/firebase.js');
const adminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

let written = { users: 0, subs: 0, payments: 0 };

for (const [uid, { user, paid: p, pending }] of byUser) {
  // 1. baris user (dari Auth) — dibiarkan ditimpa data Firestore saat impor
  const existing = await db.collection(C.users).doc(uid).get();
  if (!existing.exists) {
    await db.collection(C.users).doc(uid).set({
      uid,
      email: user.email,
      name: user.name,
      photo: null,
      role: adminEmails.includes(user.email) ? 'admin' : 'user',
      created_at: user.created_at || new Date().toISOString(),
      last_login_at: null,
      rebuilt_from: 'auth',
    });
    written.users++;
  }

  // 2. langganan hasil rekonstruksi (satu dokumen per user)
  if (p.length) {
    const sub = subscriptionFor(p);
    const aktif = new Date(sub.expires_at) > new Date();
    await db.collection(C.subscriptions(uid)).doc(`prov_${uid}`).set({
      id: `prov_${uid}`,
      user_id: uid,
      plan: 'unlimited',
      price_idr: sub.amount_idr,
      days: PLAN_DAYS * sub.paid_count,
      status: aktif ? 'active' : 'expired',
      starts_at: sub.starts_at,
      expires_at: sub.expires_at,
      created_at: sub.starts_at,
      provisional: true,
      source: 'paymenku',
    });
    written.subs++;
  }

  // 3. riwayat pembayaran + index lookup (webhook & polling status)
  for (const t of [...p, ...pending]) {
    const idx = await db.collection(C.trxIndex).doc(t.trx_id).get();
    if (idx.exists && !String(idx.data().paymentId || '').startsWith('prov_')) continue; // sudah ada baris asli
    const id = `prov_${t.trx_id}`;
    await db.collection(C.payments(uid)).doc(id).set({
      id,
      user_id: uid,
      trx_id: t.trx_id,
      reference_id: t.reference_id,
      channel: t.channel_code,
      amount_idr: PRICE_IDR,
      status: t.status === 'paid' ? 'paid' : 'pending',
      created_at: t.created_at,
      paid_at: t.paid_at || null,
      provisional: true,
      source: 'paymenku',
    });
    await db.collection(C.trxIndex).doc(t.trx_id).set({ uid, paymentId: id });
    await db.collection(C.refIndex).doc(t.reference_id).set({ uid, paymentId: id });
    written.payments++;
  }
}

console.log(`\n✓ tulis selesai: ${written.users} user, ${written.subs} langganan, ${written.payments} pembayaran (semua provisional)`);
console.log('  → akan diganti data asli oleh scripts/import-localdb.js saat ekspor Firestore berhasil\n');
