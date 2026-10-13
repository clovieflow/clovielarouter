import { db, auth, C, iso, now, Timestamp } from './firebase.js';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Data layer — Firestore sebagai backend.
 *
 * Struktur:
 *   users/{uid}                       profil + role (admin|user)
 *   users/{uid}/subscriptions/{id}    langganan (aktif/pending/expired)
 *   users/{uid}/payments/{id}         pembayaran
 *   api_keys/{keyId}                  key (hash + prefix), owner: uid
 *   usage_logs/{autoId}               log request (uid, keyId, model, status…)
 *   providers/{id}                    provider upstream (admin-only)
 *   models/{modelId}                  model publik (admin-only)
 *   trx_index/{trx_id}                webhook → {uid, paymentId} (lookup cepat)
 *   ref_index/{reference_id}          reference → {uid, paymentId}
 *   webhook_events/{trx_id}           idempotensi webhook
 */

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => randomBytes(n).toString('base64url');

export function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}

export const isAdmin = (user) => !!user && user.role === 'admin';

/* ────────────────────────────── users ────────────────────────────── */

const ADMIN_EMAILS = () =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/**
 * Upsert user dari hasil verifikasi Firebase ID token.
 * Role hanya bisa jadi 'admin' kalau email ada di allowlist ADMIN_EMAILS —
 * user tidak pernah bisa menaikkan rolenya sendiri.
 */
export async function upsertUser({ uid, email, name, picture }) {
  const mail = (email || '').toLowerCase().trim();
  if (!mail) throw new Error('no_email');

  const ref = db.collection(C.users).doc(uid);
  const snap = await ref.get();
  const role = ADMIN_EMAILS().includes(mail) ? 'admin' : 'user';

  if (!snap.exists) {
    await ref.set({
      uid,
      email: mail,
      name: name || mail.split('@')[0],
      photo: picture || null,
      role,
      created_at: now(),
      last_login_at: now(),
    });
    return (await ref.get()).data();
  }

  const data = snap.data();
  const patch = {
    name: name || data.name,
    photo: picture ?? data.photo ?? null,
    last_login_at: now(),
    // promote kalau email ditambahkan ke allowlist; demote kalau dihapus
    role,
  };
  await ref.set(patch, { merge: true });
  return { ...data, ...patch };
}

export async function getUser(uid) {
  const snap = await db.collection(C.users).doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/* ────────────────────────── subscriptions ────────────────────────── */

const subsRef = (uid) => db.collection(C.subscriptions(uid));

export async function activeSubscription(uid) {
  // Query sederhana (tanpa orderBy) → tidak butuh composite index,
  // lalu urutkan di memori. Lebih tahan banting saat index masih dibangun.
  const snap = await subsRef(uid).where('status', '==', 'active').get();
  if (snap.empty) return null;

  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(iso(b.expires_at) || 0) - new Date(iso(a.expires_at) || 0));

  const sub = docs[0];
  const exp = iso(sub.expires_at);
  if (!exp || new Date(exp) <= new Date()) {
    await expireSubscription(uid, sub.id);
    // cek apakah masih ada yang lain yang valid
    const rest = docs.slice(1).find((s) => new Date(iso(s.expires_at)) > new Date());
    return rest || null;
  }
  return sub;
}

export async function latestSubscription(uid) {
  const snap = await subsRef(uid).get();
  if (snap.empty) return null;
  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(iso(b.created_at) || 0) - new Date(iso(a.created_at) || 0));
  return docs[0];
}

export async function createSubscription(uid, { plan, priceIdr, days, status = 'pending' }) {
  const ref = subsRef(uid).doc();
  const data = {
    id: ref.id,
    user_id: uid,
    plan,
    price_idr: priceIdr,
    days,
    status,
    starts_at: null,
    expires_at: null,
    created_at: now(),
  };
  await ref.set(data);
  return data;
}

/** Aktifkan / perpanjang: mulai dari expires_at yang masih berlaku kalau ada. */
/**
 * Aktifkan / perpanjang langganan.
 * @param days    lama dalam hari (bisa pecahan, mis. 1/24 = 1 jam)
 */
export async function activateSubscription(uid, subId, days) {
  const current = await activeSubscription(uid);
  // Tambah waktu SELALU menumpuk di atas sisa masa aktif yang masih berlaku
  // (admin "+1 jam" harus = sisa + 1 jam, bukan reset ke sekarang + 1 jam).
  const base =
    current && new Date(iso(current.expires_at)) > new Date()
      ? new Date(iso(current.expires_at))
      : new Date();
  const expires = new Date(base.getTime() + days * 864e5);

  await subsRef(uid).doc(subId).set(
    {
      status: 'active',
      starts_at: now(),
      expires_at: Timestamp.fromDate(expires),
    },
    { merge: true }
  );
  return expires;
}

export async function expireSubscription(uid, subId) {
  await subsRef(uid).doc(subId).set({ status: 'expired' }, { merge: true });
}

/** Cron: expire langganan yang lewat + revoke key-nya. */
export async function expireOverdue(limit = 200) {
  // Baca tanpa where → tidak butuh index COLLECTION_GROUP sama sekali.
  // Filter di memori (jumlah langganan per instance kecil).
  const snap = await db.collectionGroup('subscriptions').limit(limit).get();

  const nowMs = Date.now();
  const overdue = snap.docs.filter((d) => {
    const s = d.data();
    const exp = iso(s.expires_at);
    return s.status === 'active' && exp && new Date(exp).getTime() <= nowMs;
  });

  let n = 0;
  for (const doc of overdue) {
    const uid = doc.ref.parent.parent.id;
    await doc.ref.set({ status: 'expired' }, { merge: true });
    const keys = await db
      .collection(C.apiKeys)
      .where('user_id', '==', uid)
      .where('status', '==', 'active')
      .get();
    for (const k of keys.docs) {
      await k.ref.set({ status: 'revoked', revoked_at: now() }, { merge: true });
    }
    n++;
  }
  return n;
}

/* ────────────────────────────── api keys ────────────────────────────── */

export async function mintApiKey(uid) {
  const raw = `clv_${randomBytes(24).toString('hex')}`;
  const prefix = raw.slice(0, 12);
  const ref = db.collection(C.apiKeys).doc();
  await ref.set({
    id: ref.id,
    user_id: uid,
    key_prefix: prefix,
    key_hash: sha256(raw),
    status: 'active',
    last_used_at: null,
    created_at: now(),
    revoked_at: null,
  });
  return { id: ref.id, prefix, raw };
}

export async function keyByRaw(raw) {
  const snap = await db
    .collection(C.apiKeys)
    .where('key_hash', '==', sha256(raw))
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function activeKey(uid) {
  const snap = await db
    .collection(C.apiKeys)
    .where('user_id', '==', uid)
    .where('status', '==', 'active')
    .limit(1)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function revokeKeys(uid) {
  const snap = await db
    .collection(C.apiKeys)
    .where('user_id', '==', uid)
    .where('status', '==', 'active')
    .get();
  for (const doc of snap.docs) {
    await doc.ref.set({ status: 'revoked', revoked_at: now() }, { merge: true });
  }
  return snap.size;
}

export async function revokeKey(uid, keyId) {
  const ref = db.collection(C.apiKeys).doc(keyId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().user_id !== uid) return false;
  await ref.set({ status: 'revoked', revoked_at: now() }, { merge: true });
  return true;
}

/* ────────────────────────────── payments ────────────────────────────── */

export async function createPayment(uid, payment) {
  const ref = db.collection(C.payments(uid)).doc();
  const data = { id: ref.id, user_id: uid, ...payment, created_at: now() };
  await ref.set(data);

  // index global untuk lookup dari webhook (webhook tidak tahu uid)
  await db.collection(C.trxIndex).doc(payment.trx_id).set({ uid, paymentId: ref.id });
  await db.collection(C.refIndex).doc(payment.reference_id).set({ uid, paymentId: ref.id });

  return data;
}

export async function listPayments(uid, limit = 50) {
  const snap = await db.collection(C.payments(uid)).limit(200).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(iso(b.created_at) || 0) - new Date(iso(a.created_at) || 0))
    .slice(0, limit);
}

/** Cari payment lewat reference_id (dipakai polling status user). */
export async function paymentByRef(referenceId) {
  const idx = await db.collection(C.refIndex).doc(referenceId).get();
  if (!idx.exists) return null;
  const { uid, paymentId } = idx.data();
  const snap = await db.collection(C.payments(uid)).doc(paymentId).get();
  return snap.exists ? { uid, payment: { id: snap.id, ...snap.data() } } : null;
}

/** Cari payment lewat trx_id (dipakai webhook). */
export async function paymentByTrx(trxId) {
  const idx = await db.collection(C.trxIndex).doc(trxId).get();
  if (!idx.exists) return null;
  const { uid, paymentId } = idx.data();
  const snap = await db.collection(C.payments(uid)).doc(paymentId).get();
  return snap.exists ? { uid, payment: { id: snap.id, ...snap.data() } } : null;
}

export async function updatePayment(uid, paymentId, patch) {
  await db.collection(C.payments(uid)).doc(paymentId).set(patch, { merge: true });
}

export async function pendingPayment(uid, channel, maxAgeMinutes = 30) {
  const since = Date.now() - maxAgeMinutes * 60_000;
  const snap = await db
    .collection(C.payments(uid))
    .where('status', '==', 'pending')
    .get();
  const hit = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.channel === channel && new Date(iso(p.created_at) || 0).getTime() > since)
    .sort((a, b) => new Date(iso(b.created_at)) - new Date(iso(a.created_at)))[0];
  return hit || null;
}

/* ────────────────────────── webhook idempotency ────────────────────────── */

export async function claimWebhook(trxId, status) {
  const ref = db.collection(C.webhooks).doc(trxId);
  try {
    // create() gagal kalau dokumen sudah ada → aman untuk request paralel
    await ref.create({ trx_id: trxId, status, received_at: now() });
    return true;
  } catch {
    return false;
  }
}

/* ────────────────────────────── usage logs ────────────────────────────── */

export async function logUsage(entry) {
  await db.collection(C.usage).add({ ...entry, created_at: now() });
  if (entry.key_id) {
    await db
      .collection(C.apiKeys)
      .doc(entry.key_id)
      .set({ last_used_at: now() }, { merge: true })
      .catch(() => {});
  }
}

export async function usageSummary(uid) {
  const since = Date.now() - 30 * 864e5;
  const snap = await db.collection(C.usage).where('user_id', '==', uid).limit(3000).get();

  const rows = snap.docs
    .map((d) => d.data())
    .filter((r) => new Date(iso(r.created_at) || 0).getTime() > since)
    .sort((a, b) => new Date(iso(b.created_at) || 0) - new Date(iso(a.created_at) || 0));
  const daily = {};
  const dailyErr = {};
  const dailyLatency = {};
  const byModel = {};
  const byModelTokens = {};
  const byModelErr = {};
  let latencySum = 0;
  let latencyN = 0;
  let errCount = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let today = 0;
  let last24 = 0;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const since24 = Date.now() - 864e5;

  for (const r of rows) {
    const d = iso(r.created_at)?.slice(0, 10);
    const isErr = r.status_code >= 400;
    if (isErr) errCount++;
    if (d) {
      daily[d] = (daily[d] || 0) + 1;
      if (isErr) dailyErr[d] = (dailyErr[d] || 0) + 1;
      if (r.latency_ms) dailyLatency[d] = Math.max(dailyLatency[d] || 0, r.latency_ms);
    }
    if (r.model) {
      byModel[r.model] = (byModel[r.model] || 0) + 1;
      tokensIn += r.tokens_in || 0;
      tokensOut += r.tokens_out || 0;
      byModelTokens[r.model] = byModelTokens[r.model] || { in: 0, out: 0 };
      byModelTokens[r.model].in += r.tokens_in || 0;
      byModelTokens[r.model].out += r.tokens_out || 0;
      if (isErr) byModelErr[r.model] = (byModelErr[r.model] || 0) + 1;
    }
    if (r.latency_ms) {
      latencySum += r.latency_ms;
      latencyN++;
    }
    if (iso(r.created_at)) {
      const t = new Date(iso(r.created_at)).getTime();
      if (t >= dayStart.getTime()) today++;
      if (t >= since24) last24++;
    }
  }

  // RPM teramati puncak: request per menit tertinggi dalam 30 hari
  const perMinute = {};
  for (const r of rows) {
    const m = iso(r.created_at)?.slice(0, 16); // menit
    if (m) perMinute[m] = (perMinute[m] || 0) + 1;
  }
  const peakRpm = Math.max(0, ...Object.values(perMinute));

  return {
    daily: Object.entries(daily)
      .map(([day, requests]) => ({
        day,
        requests,
        errors: dailyErr[day] || 0,
        max_ms: dailyLatency[day] || null,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byModel: Object.entries(byModel)
      .map(([model, requests]) => ({
        model,
        requests,
        errors: byModelErr[model] || 0,
        tokens_in: byModelTokens[model]?.in || null,
        tokens_out: byModelTokens[model]?.out || null,
      }))
      .sort((a, b) => b.requests - a.requests),
    totals: {
      total: rows.length,
      today,
      last24,
      err_count: errCount,
      err_rate: rows.length ? Math.round((errCount / rows.length) * 1000) / 10 : 0,
      tokens_in: tokensIn || null,
      tokens_out: tokensOut || null,
      peak_rpm: peakRpm || null,
      avg_ms: latencyN ? Math.round(latencySum / latencyN) : null,
    },
    recent: rows.slice(0, 20).map((r) => ({
      request_id: r.request_id,
      model: r.model,
      status_code: r.status_code,
      latency_ms: r.latency_ms,
      tokens_in: r.tokens_in,
      tokens_out: r.tokens_out,
      created_at: iso(r.created_at),
    })),
  };
}

/* ────────────────────────── providers & models ────────────────────────── */

export async function listProviders({ onlyEnabled = false } = {}) {
  let q = db.collection(C.providers);
  if (onlyEnabled) q = q.where('enabled', '==', true);
  const snap = await q.get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (iso(a.created_at) || '').localeCompare(iso(b.created_at) || ''));
}

export async function getProvider(id) {
  const snap = await db.collection(C.providers).doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

export async function createProvider(data) {
  const ref = db.collection(C.providers).doc();
  const doc = {
    id: ref.id,
    name: data.name,
    base_url: String(data.base_url).replace(/\/+$/, ''),
    api_key: data.api_key || null,
    notes: data.notes || null,
    enabled: data.enabled !== false,
    created_at: now(),
  };
  await ref.set(doc);
  return doc;
}

export async function updateProvider(id, patch) {
  const ref = db.collection(C.providers).doc(id);
  const cur = await ref.get();
  if (!cur.exists) return null;
  const next = { ...patch };
  if (next.base_url) next.base_url = String(next.base_url).replace(/\/+$/, '');
  await ref.set(next, { merge: true });
  return { id, ...cur.data(), ...next };
}

export async function deleteProvider(id) {
  const models = await db.collection(C.models).where('provider_id', '==', id).get();
  const batch = db.batch();
  models.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.collection(C.providers).doc(id));
  await batch.commit();
}

export async function listModels({ onlyEnabled = false } = {}) {
  let q = db.collection(C.models);
  if (onlyEnabled) q = q.where('enabled', '==', true);
  const [snap, providers] = await Promise.all([q.get(), listProviders()]);
  const byId = Object.fromEntries(providers.map((p) => [p.id, p]));

  return snap.docs
    .map((d) => {
      const m = { id: d.id, ...d.data() };
      const p = byId[m.provider_id];
      return {
        ...m,
        provider_name: p?.name || '—',
        provider_base_url: p?.base_url,
        provider_enabled: p?.enabled ?? false,
      };
    })
    .filter((m) => !onlyEnabled || m.provider_enabled)
    .sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.model_id.localeCompare(b.model_id));
}

export async function getModel(modelId) {
  const snap = await db.collection(C.models).doc(modelId).get();
  if (!snap.exists) return null;
  const m = { id: snap.id, ...snap.data() };
  const p = await getProvider(m.provider_id);
  return {
    ...m,
    provider_name: p?.name,
    provider_base_url: p?.base_url,
    provider_api_key: p?.api_key,
    provider_enabled: p?.enabled ?? false,
  };
}

/**
 * SANITASI ID: Firestore melarang "/" di doc ID. Model upstream sering
 * berbentuk "vendor/nama" (mis. Mistral/codestral-latest) — garis miring
 * diganti minus supaya bisa dipakai sebagai ID publik yang aman.
 */
const safeModelId = (id) =>
  String(id || '').trim().replace(/\\/g, '-').replace(/\//g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');

export async function createModel(data) {
  const ref = db.collection(C.models).doc(safeModelId(data.model_id));
  const doc = {
    model_id: data.model_id,
    label: data.label,
    provider_id: data.provider_id,
    upstream_name: data.upstream_name || data.model_id,
    description: data.description || null,
    context_len: data.context_len || null,
    tier: data.tier || null,
    enabled: data.enabled !== false,
    sort: data.sort ?? 100,
    created_at: now(),
  };
  await ref.set(doc);
  return { id: ref.id, ...doc };
}

/**
 * Alias publik: nama netral yang dipakai user, supaya model asli provider
 * tidak terekspos. Dihasilkan dari daftar kata yang tidak menyebut provider.
 */
const ALIAS_WORDS = ['nano', 'mini', 'smart', 'turbo', 'flash', 'nova', 'prime', 'ultra', 'core', 'edge'];

export function suggestAlias(used = []) {
  const taken = new Set(used.map((a) => String(a).toLowerCase()));
  for (const w of ALIAS_WORDS) {
    const a = `clv-${w}`;
    if (!taken.has(a)) return a;
  }
  let i = 2;
  while (taken.has(`clv-model-${i}`)) i++;
  return `clv-model-${i}`;
}

/** Semua alias publik yang sudah dipakai (untuk cek bentrok). */
export async function usedAliases() {
  const snap = await db.collection(C.models).get();
  return snap.docs.map((d) => d.id);
}

/** Cek apakah alias masih dipakai model lain. */
export async function aliasTaken(alias, exceptId = null) {
  const snap = await db.collection(C.models).doc(alias).get();
  return snap.exists && snap.id !== exceptId;
}

/**
 * Ganti alias publik sebuah model: buat dokumen baru, hapus yang lama.
 * upstream_name TIDAK berubah, jadi routing tetap benar.
 */
export async function renameModelAlias(oldId, newId) {
  const target = safeModelId(newId);
  if (!target) return null;
  const old = await getModel(oldId);
  if (!old) return null;
  const { id, provider_name, provider_base_url, provider_api_key, provider_enabled, ...data } = old;
  await db.collection(C.models).doc(target).set({ ...data, model_id: target });
  if (target !== oldId) await db.collection(C.models).doc(oldId).delete();
  return getModel(target);
}

export async function updateModel(id, patch) {
  const ref = db.collection(C.models).doc(id);
  const cur = await ref.get();
  if (!cur.exists) return null;
  await ref.set(patch, { merge: true });
  return { id, ...cur.data(), ...patch };
}

export async function deleteModel(id) {
  await db.collection(C.models).doc(id).delete();
}

/* ────────────────────────────── admin views ────────────────────────────── */

export async function adminStats() {
  // Sengaja TANPA collectionGroup where/aggregate: itu butuh field override
  // COLLECTION_GROUP dan bisa gagal saat index masih dibangun.
  const [usersSnap, subsSnap, paymentsSnap, usageSnap] = await Promise.all([
    db.collection(C.users).get(),
    db.collectionGroup('subscriptions').get(),
    db.collectionGroup('payments').get(),
    db.collection(C.usage).limit(5000).get(),
  ]);

  const nowMs = Date.now();
  const activeSubs = subsSnap.docs.filter((d) => {
    const s = d.data();
    const exp = iso(s.expires_at);
    return s.status === 'active' && exp && new Date(exp).getTime() > nowMs;
  });

  const paid = paymentsSnap.docs.filter((d) => d.data().status === 'paid');
  const revenue = paid.reduce((sum, d) => sum + (d.data().amount_idr || 0), 0);
  const pending = paymentsSnap.docs.filter((d) => d.data().status === 'pending').length;

  const since24 = nowMs - 864e5;
  const usage = usageSnap.docs
    .map((d) => d.data())
    .filter((u) => new Date(iso(u.created_at) || 0).getTime() > since24);
  const errors = usage.filter((u) => (u.status_code || 0) >= 400).length;

  return {
    users: usersSnap.size,
    active_subs: activeSubs.length,
    revenue_idr: revenue,
    pending_payments: pending,
    requests_24h: usage.length,
    error_rate: usage.length ? Math.round((errors / usage.length) * 1000) / 10 : 0,
  };
}

export async function adminUsers(q = '') {
  const snap = await db.collection(C.users).orderBy('created_at', 'desc').limit(100).get();
  const needle = q.toLowerCase();
  const users = snap.docs
    .map((d) => d.data())
    .filter(
      (u) =>
        !needle ||
        u.email?.toLowerCase().includes(needle) ||
        u.name?.toLowerCase().includes(needle)
    );

  return Promise.all(
    users.map(async (u) => {
      const [sub, key] = await Promise.all([latestSubscription(u.uid), activeKey(u.uid)]);
      return {
        id: u.uid,
        email: u.email,
        name: u.name,
        role: u.role,
        created_at: iso(u.created_at),
        sub_status: sub?.status || null,
        expires_at: iso(sub?.expires_at),
        key_prefix: key?.key_prefix || null,
      };
    })
  );
}

export async function adminPayments(limit = 100) {
  // collectionGroup tanpa where/orderBy → tidak butuh index khusus
  const snap = await db.collectionGroup('payments').limit(300).get();

  const sorted = snap.docs
    .sort((a, b) => new Date(iso(b.data().created_at) || 0) - new Date(iso(a.data().created_at) || 0))
    .slice(0, limit);

  const rows = await Promise.all(
    sorted.map(async (d) => {
      const p = d.data();
      const u = await getUser(p.user_id);
      return {
        ...p,
        created_at: iso(p.created_at),
        paid_at: iso(p.paid_at),
        email: u?.email,
        name: u?.name,
      };
    })
  );
  return rows;
}

/* ────────────────────────────── settings ────────────────────────────── */

/** Baca settings bernama (mis. 'crypto'). */
export async function getSettings(name) {
  const snap = await db.collection(C.settings).doc(name).get();
  return snap.exists ? snap.data() : null;
}

export async function saveSettings(name, data) {
  await db.collection(C.settings).doc(name).set({ ...data, updated_at: now() }, { merge: true });
  return getSettings(name);
}

/* ────────────────────────────── crypto orders ────────────────────────────── */

/**
 * Order crypto disimpan di koleksi top-level `crypto_orders` supaya bisa
 * dicari lewat `reference` (yang ada di QR) tanpa tahu uid pemiliknya.
 */
export async function createCryptoOrder(data) {
  // reference JUGA dipakai sebagai doc ID — lookup langsung O(1) tanpa query.
  const ref = db.collection(C.cryptoOrders).doc(data.reference);
  const doc = { ...data, created_at: now() };
  await ref.set(doc);
  return { ...doc, id: data.reference, created_at: new Date().toISOString() };
}

export async function cryptoOrderByRef(reference) {
  const snap = await db.collection(C.cryptoOrders).doc(reference).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

export async function updateCryptoOrder(reference, patch) {
  await db.collection(C.cryptoOrders).doc(reference).set(patch, { merge: true });
}

/**
 * Tandai order lunas SECARA ATOMIK: hanya satu pemanggil (cron vs polling)
 * yang berhasil membalik status 'pending' -> 'paid'. Yang kalah mendapat null,
 * jadi tidak pernah ada key dobel / notifikasi dobel.
 * @returns order terbaru kalau menang, null kalau sudah diklaim pihak lain.
 */
export function claimCryptoPaid(reference, patch) {
  const ref = db.collection(C.cryptoOrders).doc(reference);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    if (snap.data().status !== 'pending') return null;
    tx.update(ref, { ...patch, paid_at: new Date().toISOString() });
    return { ...snap.data(), ...patch };
  });
}

export async function listCryptoOrders(uid, limit = 50) {
  const snap = await db
    .collection(C.cryptoOrders)
    .where('user_id', '==', uid)
    .limit(200)
    .get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(iso(b.created_at) || 0) - new Date(iso(a.created_at) || 0))
    .slice(0, limit);
}

/** Order crypto yang masih menunggu (untuk cron + polling). */
export async function pendingCryptoOrders(maxAgeMinutes = 120) {
  const snap = await db.collection(C.cryptoOrders).where('status', '==', 'pending').limit(100).get();
  const since = Date.now() - maxAgeMinutes * 60_000;
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((o) => new Date(iso(o.created_at) || 0).getTime() > since);
}

/* ────────────────────────────── serializer ────────────────────────────── */

export async function userPayload(user) {
  const [sub, key] = await Promise.all([activeSubscription(user.uid), activeKey(user.uid)]);
  const exp = sub ? new Date(iso(sub.expires_at)) : null;
  const daysLeft = exp ? Math.max(0, Math.ceil((exp - Date.now()) / 864e5)) : 0;

  return {
    id: user.uid,
    email: user.email,
    name: user.name,
    photo: user.photo,
    admin: user.role === 'admin',
    subscription: sub
      ? {
          status: 'active',
          plan: sub.plan,
          days: sub.days,
          expires_at: exp.toISOString(),
          days_left: daysLeft,
        }
      : null,
    api_key: key
      ? { id: key.id, prefix: key.key_prefix, last_used_at: iso(key.last_used_at) }
      : null,
  };
}

export { auth };
