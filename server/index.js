import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { auth, iso, Timestamp, db, C } from './firebase.js';
import * as store from './store.js';
import * as paymenku from './paymenku.js';
import * as crypto from './crypto.js';
import QRCode from 'qrcode';
import { notifyAdmin, paymentMessage, signupMessage, revokeMessage } from './telegram.js';
import { rateLimit, limitsInfo, currentLoad } from './limiter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
// API harus selalu segar: 304 tanpa body bikin fetch gagal parse JSON.
app.disable('etag');

const PORT = process.env.PORT || 8787;
const APP_URL = process.env.APP_URL || `http://localhost:5177`;
const PRICE_IDR = Number(process.env.PRICE_IDR || 15000);
const PLAN_DAYS = Number(process.env.PLAN_DAYS || 7);
// Base URL yang dipakai user untuk memanggil API (ditampilkan di dashboard & docs).
const API_BASE = (process.env.PUBLIC_API_BASE || `${APP_URL}/v1`).replace(/\/+$/, '');

/* ─────────────────────────── middleware ─────────────────────────── */

// raw body untuk webhook (signature dihitung dari raw body)
app.use('/api/webhook/paymenku', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Semua endpoint dinamis: jangan di-cache browser/proxy.
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/v1')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  }
  next();
});

const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const fail = (res, status, message, code) =>
  res.status(status).json({ error: { message, code: code || undefined } });

/**
 * Auth = Firebase ID token di header Authorization: Bearer <idToken>.
 * Stateless: tidak ada sesi server, token diverifikasi tiap request.
 */
async function attachUser(req, _res, next) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  try {
    const decoded = await auth.verifyIdToken(header.slice(7).trim(), true);
    let user = await store.getUser(decoded.uid);
    if (!user) {
      user = await store.upsertUser({
        uid: decoded.uid,
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture,
      });
      notifyAdmin(
        signupMessage({ email: user.email, name: user.name })
      ).catch(() => {});
    }
    req.user = user;
    req.firebase = decoded;
  } catch {
    req.user = null;
  }
  next();
}

const requireUser = (req, res, next) =>
  req.user ? next() : fail(res, 401, 'Login dulu ya.', 'unauthorized');
const requireAdmin = (req, res, next) =>
  store.isAdmin(req.user) ? next() : fail(res, 403, 'Khusus admin.', 'forbidden');

/** Dipakai semua endpoint /api/admin/* — auth + harus admin. */
const adminChain = [attachUser, requireAdmin];

/* ─────────────────────────── health & config ─────────────────────────── */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    backend: 'firestore',
    project: process.env.FIREBASE_PROJECT_ID || 'cloviela1',
    payment: paymenku.paymenkuEnabled() ? paymenku.paymenkuMode() : 'disabled',
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    price_idr: PRICE_IDR,
    plan_days: PLAN_DAYS,
    load: currentLoad(),
    limits: limitsInfo(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    price_idr: PRICE_IDR,
    plan_days: PLAN_DAYS,
    plan: 'unlimited',
    api_base: API_BASE,
    limits: {
      user_rpm: limitsInfo().userRpm,
      user_concurrent: limitsInfo().userConcurrent,
      global_rpm: limitsInfo().globalRpm,
      global_concurrent: limitsInfo().globalConcurrent,
    },
    payment_ready: paymenku.paymenkuEnabled(),
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY || '',
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID || '',
    },
  });
});

/* ─────────────────────────── auth (Firebase) ─────────────────────────── */

/**
 * Dipanggil frontend SETELAH signInWithPopup berhasil, untuk memastikan
 * dokumen user ada di Firestore (dan mencatat login).
 */
app.post(
  '/api/auth/sync',
  attachUser,
  requireUser,
  asyncRoute(async (req, res) => {
    res.json({ user: await store.userPayload(req.user) });
  })
);

app.get('/api/me', attachUser, asyncRoute(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: await store.userPayload(req.user) });
}));

/* ─────────────────────────── models publik ─────────────────────────── */

/**
 * Daftar model publik.
 * PENTING: nama provider & nama model upstream TIDAK pernah dikirim ke client —
 * yang keluar hanya alias publik (model_id), label, dan keterangan.
 */
app.get('/api/models', asyncRoute(async (_req, res) => {
  const models = await store.listModels({ onlyEnabled: true });
  res.json({
    models: models.map((m) => ({
      id: m.model_id,              // alias publik — nama asli tidak diekspos
      label: m.label,
      description: m.description,
      context_len: m.context_len,
      tier: m.tier || 'unlimited',
    })),
  });
}));

/* ─────────────────────────── checkout (Paymenku) ─────────────────────────── */

/**
 * Hanya QRIS yang ditawarkan. Kalau nanti mau membuka metode lain,
 * cukup ubah PAYMENT_METHODS di .env (mis. "qris,bca_va") atau daftar di bawah.
 */
/** Settings crypto (alamat wallet, koin aktif) — cache 30 detik. */
let cryptoCache = { at: 0, data: null };
async function cryptoSettings() {
  if (cryptoCache.data && Date.now() - cryptoCache.at < 30_000) return cryptoCache.data;
  const raw = await store.getSettings('crypto').catch(() => null);
  const s = crypto.normalizeSettings(raw || {});
  cryptoCache = { at: Date.now(), data: s };
  return s;
}
const clearCryptoCache = () => { cryptoCache = { at: 0, data: null }; };

const PAYMENT_METHODS = (process.env.PAYMENT_METHODS || 'qris')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.get('/api/channels', asyncRoute(async (_req, res) => {
  if (!paymenku.paymenkuEnabled()) return res.json({ channels: [] });
  try {
    const all = await paymenku.listChannels();
    const allowed = all.filter((c) => PAYMENT_METHODS.includes(c.code));
    // kalau merchant belum punya QRIS aktif, tetap tampilkan QRIS
    res.json({ channels: allowed.length ? allowed : all.filter((c) => c.code === 'qris') });
  } catch {
    res.json({
      channels: PAYMENT_METHODS.filter((c) => c === 'qris').map((code) => ({
        code,
        name: 'QRIS',
        type: 'qris',
        group: 'QRIS',
      })),
    });
  }
}));

/* ─────────────────────────── crypto (Solana) ─────────────────────────── */

/**
 * Metode pembayaran yang tersedia — dipakai halaman checkout untuk
 * menampilkan pilihan QRIS / USDC / USDT / SOL.
 */
app.get('/api/pay-methods', asyncRoute(async (_req, res) => {
  const cs = await cryptoSettings();
  res.json({
    qris: {
      enabled: paymenku.paymenkuEnabled() && PAYMENT_METHODS.includes('qris'),
      label: 'QRIS',
      note: 'GoPay, OVO, DANA, ShopeePay, m-banking',
    },
    crypto: {
      enabled: crypto.isReady(cs),
      label: 'Crypto (Solana)',
      note: 'USDC · USDT · SOL',
      coins: crypto.isReady(cs) ? crypto.publicCoins(cs) : [],
    },
  });
}));

/**
 * Buat order crypto. Body: { coin: 'usdc'|'usdt'|'sol' }
 * Mengembalikan alamat + jumlah + QR (data URL) + URI wallet.
 */
app.post(
  '/api/checkout/crypto',
  attachUser,
  requireUser,
  asyncRoute(async (req, res) => {
    const cs = await cryptoSettings();
    if (!crypto.isReady(cs)) {
      return fail(res, 503, 'Pembayaran crypto belum dikonfigurasi admin.', 'crypto_disabled');
    }

    const coin = String(req.body?.coin || '').toLowerCase();
    if (!crypto.COINS[coin] || !cs.coins.includes(coin)) {
      return fail(res, 400, 'Koin tidak didukung.', 'invalid_coin');
    }

    // pakai ulang order pending yang masih hidup (hindari spam QR)
    const existing = (await store.listCryptoOrders(req.user.uid))
      .find((o) => o.status === 'pending' && o.coin === coin &&
                   Date.now() - new Date(o.created_at).getTime() < 60 * 60 * 1000);
    if (existing) {
      return res.json({ order: publicCryptoOrder(existing), reused: true });
    }

    let amount;
    try {
      amount = await crypto.amountFor(coin, PRICE_IDR, cs);
    } catch (e) {
      return fail(res, 502, `Gagal ambil kurs: ${e.message}`, 'rate_error');
    }

    const reference = crypto.newReference();
    const uri = crypto.payUri({
      address: cs.address,
      amount: amount.amount,
      coin,
      reference,
      label: 'Cloviela',
      message: `Cloviela Unlimited ${PLAN_DAYS} hari`,
    });

    const sub = await store.createSubscription(req.user.uid, {
      plan: 'unlimited',
      priceIdr: PRICE_IDR,
      days: PLAN_DAYS,
      status: 'pending',
    });

    const order = await store.createCryptoOrder({
      reference,
      user_id: req.user.uid,
      subscription_id: sub.id,
      days: PLAN_DAYS,            // dibekukan saat order dibuat — harga & masa aktif sepakat di sini
      coin,
      symbol: amount.symbol,
      amount: amount.amount,
      amount_idr: PRICE_IDR,
      rate_idr: amount.rate_idr,
      address: cs.address,
      uri,
      status: 'pending',
      signature: null,
    });

    notifyAdmin(
      paymentMessage({
        email: req.user.email,
        name: req.user.name,
        amount: PRICE_IDR,
        channel: `crypto:${coin}`,
        trxId: reference.slice(0, 16),
        status: 'pending',
      })
    ).catch(() => {});

    res.json({ order: publicCryptoOrder(order) });
  })
);

const publicCryptoOrder = (o) => ({
  reference: o.reference,
  coin: o.coin,
  symbol: o.symbol,
  amount: o.amount,
  amount_idr: o.amount_idr,
  address: o.address,
  uri: o.uri,
  status: o.status,
  signature: o.signature || null,
  expires_at: new Date(new Date(o.created_at).getTime() + 60 * 60 * 1000).toISOString(),
  created_at: o.created_at,
});

/** Polling status order crypto — cek on-chain kalau masih pending. */
app.get(
  '/api/crypto/:ref',
  attachUser,
  requireUser,
  asyncRoute(async (req, res) => {
    let order = await store.cryptoOrderByRef(req.params.ref);
    if (!order || order.user_id !== req.user.uid) {
      return fail(res, 404, 'Order tidak ditemukan.', 'not_found');
    }

    if (order.status === 'pending') {
      order = await checkCryptoOrder(order);
    }

    res.json({
      order: publicCryptoOrder(order),
      subscription: (await store.userPayload(req.user)).subscription,
    });
  })
);

/**
 * Cek satu order ke blockchain; kalau lunas → aktifkan langganan + terbitkan key.
 * Idempoten: order yang sudah paid tidak diproses ulang.
 */
async function checkCryptoOrder(order) {
  let verdict;
  try {
    verdict = await crypto.verifyPayment(order);
  } catch (e) {
    console.warn('[crypto] verify gagal:', e.message);
    return order;
  }
  if (!verdict.paid) {
    // order kedaluwarsa setelah 1 jam
    if (Date.now() - new Date(order.created_at).getTime() > 60 * 60 * 1000) {
      await store.updateCryptoOrder(order.reference, { status: 'expired' });
      return { ...order, status: 'expired' };
    }
    return order;
  }

  // klaim atomik: hanya satu pemanggil (cron ATAU polling) yang menang,
  // jadi aktifasi + mint key + notif tidak pernah dobel.
  const claimed = await store.claimCryptoPaid(order.reference, {
    status: 'paid',
    signature: verdict.signature,
    received: verdict.received,
  });
  if (!claimed) return { ...order, status: 'paid', signature: order.signature || verdict.signature };

  const days = order.days || PLAN_DAYS;
  await store.activateSubscription(order.user_id, order.subscription_id, days);

  const key = await store.activeKey(order.user_id);
  if (!key) await store.mintApiKey(order.user_id);

  const user = await store.getUser(order.user_id);
  notifyAdmin(
    paymentMessage({
      email: user?.email,
      name: user?.name,
      amount: order.amount_idr,
      channel: `crypto:${order.coin}`,
      trxId: order.reference.slice(0, 16),
      status: 'paid',
      days,
    })
  ).catch(() => {});

  console.log(`[crypto] lunas ${order.reference} · ${order.amount} ${order.symbol} · ${verdict.signature}`);
  return { ...order, status: 'paid', signature: verdict.signature };
}

/** QR data URL untuk order crypto (dibuat di server, tidak perlu lib di frontend). */
app.get(
  '/api/crypto/:ref/qr',
  attachUser,
  requireUser,
  asyncRoute(async (req, res) => {
    const order = await store.cryptoOrderByRef(req.params.ref);
    if (!order || order.user_id !== req.user.uid) {
      return fail(res, 404, 'Order tidak ditemukan.', 'not_found');
    }
    const png = await QRCode.toBuffer(order.uri, { width: 440, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(png);
  })
);

/* ── admin: settings crypto ── */

app.get('/api/admin/settings/crypto', ...adminChain, asyncRoute(async (_req, res) => {
  const s = await cryptoSettings();
  let rateInfo = null;
  try { rateInfo = await crypto.rates(); } catch { /* offline */ }
  res.json({ settings: s, rates: rateInfo, coins: crypto.COIN_CODES });
}));

app.put('/api/admin/settings/crypto', ...adminChain, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const next = crypto.normalizeSettings({
    enabled: body.enabled,
    address: body.address,
    coins: body.coins,
    markup: body.markup,
    fallback: body.fallback,
  });

  if (next.enabled && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(next.address)) {
    return fail(res, 400, 'Alamat Solana tidak valid.', 'invalid_address');
  }

  await store.saveSettings('crypto', next);
  clearCryptoCache();
  res.json({ settings: next });
}));

const publicPayment = (p) => ({
  id: p.id,
  reference_id: p.reference_id,
  trx_id: p.trx_id,
  amount: p.amount_idr,
  channel: p.channel,
  status: p.status,
  pay_url: p.pay_url,
  qr_url: p.qr_url,
  va_number: p.va_number,
  created_at: iso(p.created_at),
});

app.post(
  '/api/checkout',
  attachUser,
  requireUser,
  asyncRoute(async (req, res) => {
    const user = req.user;
    // QRIS only — channel dari client diabaikan kalau tidak diizinkan.
    const requested = (req.body?.channel || 'qris').toString();
    const channel = PAYMENT_METHODS.includes(requested) ? requested : PAYMENT_METHODS[0];

    if (!paymenku.paymenkuEnabled()) {
      return fail(res, 503, 'Payment gateway belum dikonfigurasi.', 'payment_disabled');
    }

    // pakai ulang transaksi pending yang masih hidup (hindari spam)
    const existing = await store.pendingPayment(user.uid, channel);
    if (existing) return res.json({ payment: publicPayment(existing), reused: true });

    const referenceId = `CLV-${Date.now().toString(36).toUpperCase()}-${user.uid.slice(-4)}`;

    let trx;
    try {
      trx = await paymenku.createTransaction({
        channel,
        amount: PRICE_IDR,
        referenceId,
        customerName: user.name || 'Cloviela User',
        customerEmail: user.email,
        customerPhone: undefined,
        returnUrl: `${APP_URL}/dashboard/billing?ref=${referenceId}`,
        orderItems: [{ name: `Cloviela Unlimited · ${PLAN_DAYS} hari`, quantity: 1 }],
      });
    } catch (err) {
      return fail(res, 502, `Gagal membuat transaksi: ${err.message}`, 'paymenku_error');
    }

    const sub = await store.createSubscription(user.uid, {
      plan: 'unlimited',
      priceIdr: PRICE_IDR,
      days: PLAN_DAYS,
      status: 'pending',
    });

    const payment = await store.createPayment(user.uid, {
      subscription_id: sub.id,
      amount_idr: PRICE_IDR,
      channel,
      reference_id: referenceId,
      trx_id: trx.trx_id,
      pay_url: trx.pay_url || null,
      qr_url: trx.payment_info?.qr_url || null,
      va_number: trx.payment_info?.va_number || null,
      status: 'pending',
      paid_at: null,
      raw: trx,
    });

    notifyAdmin(
      paymentMessage({
        email: user.email,
        name: user.name,
        amount: PRICE_IDR,
        channel,
        trxId: trx.trx_id,
        status: 'pending',
      })
    ).catch(() => {});

    res.json({ payment: publicPayment(payment) });
  })
);

app.get('/api/payments', attachUser, requireUser, asyncRoute(async (req, res) => {
  const rows = await store.listPayments(req.user.uid);
  res.json({ payments: rows.map(publicPayment) });
}));

/** Polling status — frontend pakai ini setelah redirect dari halaman bayar. */
app.get(
  '/api/payments/:ref',
  attachUser,
  requireUser,
  asyncRoute(async (req, res) => {
    const found = await store.paymentByRef(req.params.ref);
    if (!found || found.uid !== req.user.uid) {
      return fail(res, 404, 'Pembayaran tidak ditemukan.', 'not_found');
    }
    let p = found.payment;

    if (p.status === 'pending' && paymenku.paymenkuEnabled()) {
      try {
        const s = await paymenku.checkStatus(p.reference_id);
        if (s?.status && s.status !== p.status) {
          await settlePayment(p.trx_id, s.status, s, { source: 'poll' });
          p = { ...p, status: s.status };
        }
      } catch {
        /* biarkan status lama */
      }
    }
    res.json({
      payment: publicPayment(p),
      subscription: (await store.userPayload(req.user)).subscription,
    });
  })
);

/* ─────────────────────────── webhook Paymenku ─────────────────────────── */

app.post(
  '/api/webhook/paymenku',
  asyncRoute(async (req, res) => {
    const raw = req.body?.toString('utf8') || '';
    const ts = req.get('X-PaymenKu-Timestamp');
    const sig = req.get('X-PaymenKu-Signature');

    if (!paymenku.verifyWebhook(raw, ts, sig)) {
      return fail(res, 401, 'Signature tidak valid.', 'bad_signature');
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(res, 400, 'Body bukan JSON.', 'bad_body');
    }

    // idempoten: create() gagal kalau trx_id sudah pernah diproses
    const fresh = await store.claimWebhook(body.trx_id, body.status);
    if (fresh) {
      await settlePayment(body.trx_id, body.status, body, { source: 'webhook' });
    }

    res.json({ received: true });
  })
);

/**
 * Idempoten: dipanggil webhook maupun polling.
 * paid → aktifkan subscription (+ generate key kalau belum ada) + notif Telegram admin.
 */
async function settlePayment(trxId, status, payload, { source }) {
  const found = await store.paymentByTrx(trxId);
  if (!found) return;

  const { uid, payment } = found;
  const map = {
    paid: 'paid',
    failed: 'failed',
    expired: 'expired',
    cancelled: 'cancelled',
    refunded: 'refunded',
  };
  const next = map[status] || status;
  if (payment.status === next) return;

  const user = await store.getUser(uid);

  await store.updatePayment(uid, payment.id, {
    status: next,
    paid_at: next === 'paid' ? Timestamp.now() : null,
    raw: payload,
  });

  if (next === 'paid') {
    const subSnap = await db
      .collection(C.subscriptions(uid))
      .doc(payment.subscription_id)
      .get();
    const days = subSnap.exists ? subSnap.data().days : PLAN_DAYS;

    await store.activateSubscription(uid, payment.subscription_id, days);

    // key: pakai yang aktif, atau terbitkan baru
    let key = await store.activeKey(uid);
    let rawKey = null;
    if (!key) {
      const minted = await store.mintApiKey(uid);
      rawKey = minted.raw;
      key = { id: minted.id, key_prefix: minted.prefix };
    }

    notifyAdmin(
      paymentMessage({
        email: user?.email,
        name: user?.name,
        amount: payment.amount_idr,
        channel: payment.channel,
        trxId,
        status: 'paid',
        days,
      })
    ).catch(() => {});

    return { activated: true, rawKey };
  }

  if (next === 'refunded') {
    await store.expireSubscription(uid, payment.subscription_id);
    notifyAdmin(
      paymentMessage({
        email: user?.email,
        name: user?.name,
        amount: payment.amount_idr,
        channel: payment.channel,
        trxId,
        status: 'refunded',
      })
    ).catch(() => {});
  }
}

/* ─────────────────────────── API keys ─────────────────────────── */

app.post(
  '/api/keys/rotate',
  attachUser,
  requireUser,
  asyncRoute(async (req, res) => {
    const sub = await store.activeSubscription(req.user.uid);
    if (!sub) return fail(res, 402, 'Langganan tidak aktif.', 'subscription_inactive');

    await store.revokeKeys(req.user.uid);
    const minted = await store.mintApiKey(req.user.uid);

    notifyAdmin(
      revokeMessage({
        email: req.user.email,
        prefix: minted.prefix,
        reason: 'rotate dari dashboard',
      })
    ).catch(() => {});

    res.json({ key: { prefix: minted.prefix, raw: minted.raw } });
  })
);

app.post('/api/keys/revoke', attachUser, requireUser, asyncRoute(async (req, res) => {
  const { id } = req.body || {};
  const ok = await store.revokeKey(req.user.uid, id);
  if (ok) {
    notifyAdmin(
      revokeMessage({ email: req.user.email, prefix: id, reason: 'revoke manual' })
    ).catch(() => {});
  }
  res.json({ ok });
}));

/* ─────────────────────────── usage ─────────────────────────── */

app.get('/api/usage', attachUser, requireUser, asyncRoute(async (req, res) => {
  res.json(await store.usageSummary(req.user.uid));
}));

/**
 * Log request lengkap dengan filter + paginasi.
 * query: ?limit=50&offset=0&status=error|ok&model=<alias>
 */
app.get('/api/logs', attachUser, requireUser, asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const status = (req.query.status || '').toString();
  const modelFilter = (req.query.model || '').toString();

  const snap = await db.collection(C.usage).where('user_id', '==', req.user.uid).limit(2000).get();

  const all = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => new Date(iso(b.created_at) || 0) - new Date(iso(a.created_at) || 0));

  const models = [...new Set(all.map((r) => r.model).filter(Boolean))].sort();

  let rows = all;
  if (status === 'ok') rows = rows.filter((r) => (r.status_code || 0) < 400);
  if (status === 'error') rows = rows.filter((r) => (r.status_code || 0) >= 400);
  if (modelFilter) rows = rows.filter((r) => r.model === modelFilter);

  const page = rows.slice(offset, offset + limit);

  res.json({
    total: all.length,
    filtered: rows.length,
    models,
    logs: page.map((r) => ({
      request_id: r.request_id,
      model: r.model,
      status_code: r.status_code,
      latency_ms: r.latency_ms,
      tokens_in: r.tokens_in,
      tokens_out: r.tokens_out,
      created_at: iso(r.created_at),
    })),
  });
}));

/**
 * Playground — coba model langsung dari dashboard.
 * Memakai API key user yang aktif, dan tercatat di log seperti request biasa.
 */
app.post('/api/playground', attachUser, requireUser, asyncRoute(async (req, res) => {
  const { model: alias, prompt = 'Halo!', max_tokens = 256 } = req.body || {};

  const key = await store.activeKey(req.user.uid);
  if (!key) return fail(res, 402, 'Belum ada API key aktif — beli paket dulu.', 'no_key');

  const sub = await store.activeSubscription(req.user.uid);
  if (!sub) return fail(res, 402, 'Langganan tidak aktif.', 'subscription_inactive');

  const model = await store.getModel((alias || '').toString());
  if (!model || !model.enabled || !model.provider_enabled) {
    return fail(res, 404, `Model "${alias}" tidak tersedia.`, 'model_not_found');
  }

  const requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);

  try {
    const upstream = await fetch(`${model.provider_base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(model.provider_api_key ? { Authorization: `Bearer ${model.provider_api_key}` } : {}),
        'X-Request-Id': requestId,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: model.upstream_name || model.model_id,
        messages: [{ role: 'user', content: String(prompt).slice(0, 4000) }],
        max_tokens: Math.min(Math.max(Number(max_tokens) || 256, 1), 2048),
        stream: false,
      }),
    });
    clearTimeout(timer);

    const ms = Date.now() - started;
    const text = await upstream.text();
    let reply = null;
    let usage = null;
    let reason = null;
    try {
      const j = JSON.parse(text);
      reply = j?.choices?.[0]?.message?.content ?? null;
      usage = j?.usage ?? null;
      if (!reply) reason = j?.error?.message || 'Respons tanpa jawaban.';
    } catch {
      reason = 'Respons bukan JSON.';
    }

    const ok = upstream.ok && !!reply;
    logUsage({
      key: { id: key.id, user_id: req.user.uid },
      model,
      requestId,
      status: upstream.status,
      ms,
      text,
    });

    if (!ok) return fail(res, 502, reason || `Upstream HTTP ${upstream.status}`, 'upstream_error');

    res.json({
      ok: true,
      request_id: requestId,
      reply,
      latency_ms: ms,
      usage,
      model: model.model_id,
    });
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - started;
    const msg = err.name === 'AbortError' ? 'Timeout 60s — model tidak merespons.' : err.message;
    logUsage({ key: { id: key.id, user_id: req.user.uid }, model, requestId, status: 502, ms });
    fail(res, 502, msg, 'upstream_unreachable');
  }
}));

/* ─────────────────────────── admin ─────────────────────────── */

app.get('/api/admin/stats', ...adminChain, asyncRoute(async (_req, res) => {
  const [stats, providers] = await Promise.all([
    store.adminStats(),
    store.listProviders(),
  ]);
  const models = await store.listModels();
  res.json({
    ...stats,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      enabled: p.enabled,
      model_count: models.filter((m) => m.provider_id === p.id).length,
      model_enabled: models.filter((m) => m.provider_id === p.id && m.enabled).length,
    })),
  });
}));

app.get('/api/admin/users', ...adminChain, asyncRoute(async (req, res) => {
  res.json({ users: await store.adminUsers((req.query.q || '').toString()) });
}));

app.get('/api/admin/payments', ...adminChain, asyncRoute(async (_req, res) => {
  res.json({ payments: await store.adminPayments() });
}));

app.post('/api/admin/users/:id/extend', ...adminChain, asyncRoute(async (req, res) => {
  const uid = req.params.id;
  const days = Number(req.body?.days || PLAN_DAYS);
  const user = await store.getUser(uid);
  if (!user) return fail(res, 404, 'User tidak ditemukan.', 'not_found');

  const current = await store.activeSubscription(uid);
  let subId = current?.id;
  if (!subId) {
    const sub = await store.createSubscription(uid, {
      plan: 'unlimited',
      priceIdr: PRICE_IDR,
      days,
      status: 'pending',
    });
    subId = sub.id;
  }
  const expires = await store.activateSubscription(uid, subId, days);

  let key = await store.activeKey(uid);
  let rawKey = null;
  if (!key) {
    const minted = await store.mintApiKey(uid);
    rawKey = minted.raw;
  }
  res.json({ ok: true, expires_at: expires.toISOString(), key_raw: rawKey });
}));

app.post('/api/admin/users/:id/revoke', ...adminChain, asyncRoute(async (req, res) => {
  const user = await store.getUser(req.params.id);
  if (!user) return fail(res, 404, 'User tidak ditemukan.', 'not_found');
  await store.revokeKeys(user.uid);
  notifyAdmin(
    revokeMessage({ email: user.email, prefix: 'all', reason: 'admin revoke' })
  ).catch(() => {});
  res.json({ ok: true });
}));

/* -------- admin: providers & models (generik, tanpa hardcode) -------- */

app.get('/api/admin/providers', ...adminChain, asyncRoute(async (_req, res) => {
  const [providers, models] = await Promise.all([store.listProviders(), store.listModels()]);
  res.json({
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      base_url: p.base_url,
      notes: p.notes,
      enabled: p.enabled,
      has_key: !!p.api_key,
      last_test: p.last_test ? {
        ...p.last_test,
        at: iso(p.last_test.at),
      } : null,
      model_count: models.filter((m) => m.provider_id === p.id).length,
      model_enabled: models.filter((m) => m.provider_id === p.id && m.enabled).length,
    })),
  });
}));

app.post('/api/admin/providers', ...adminChain, asyncRoute(async (req, res) => {
  const { name, base_url, api_key, notes, enabled } = req.body || {};
  if (!name || !base_url) return fail(res, 400, 'name & base_url wajib.', 'invalid');
  res.json({ provider: await store.createProvider({ name, base_url, api_key, notes, enabled }) });
}));

app.patch('/api/admin/providers/:id', ...adminChain, asyncRoute(async (req, res) => {
  const p = await store.updateProvider(req.params.id, req.body || {});
  if (!p) return fail(res, 404, 'Provider tidak ditemukan.', 'not_found');
  res.json({ provider: p });
}));

app.delete('/api/admin/providers/:id', ...adminChain, asyncRoute(async (req, res) => {
  await store.deleteProvider(req.params.id);
  res.json({ ok: true });
}));

/**
 * Tes koneksi provider: panggil GET /models di upstream.
 * Berguna untuk tahu endpoint masih hidup dan model apa saja yang tersedia
 * di sana (biar bisa dicocokkan dengan daftar model kita).
 */
app.get('/api/admin/providers/:id/test', ...adminChain, asyncRoute(async (req, res) => {
  const p = await store.getProvider(req.params.id);
  if (!p) return fail(res, 404, 'Provider tidak ditemukan.', 'not_found');

  const started = Date.now();
  const url = `${p.base_url}/models`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const upstream = await fetch(url, {
      headers: {
        ...(p.api_key ? { Authorization: `Bearer ${p.api_key}` } : {}),
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);

    const text = await upstream.text();
    const ms = Date.now() - started;
    let ids = [];
    let parseError = null;
    try {
      const j = JSON.parse(text);
      const list = j?.data || j?.models || [];
      ids = list.map((m) => m?.id || m?.name || m?.model).filter(Boolean);
    } catch {
      parseError = 'Respons bukan JSON.';
    }

    const ok = upstream.ok && !parseError;
    await store.updateProvider(p.id, {
      last_test: {
        at: new Date(),
        ok,
        status: upstream.status,
        latency_ms: ms,
        models_found: ids.length,
        error: ok ? null : (parseError || `HTTP ${upstream.status}`),
      },
    });

    res.json({
      ok,
      status: upstream.status,
      latency_ms: ms,
      models_found: ids.length,
      models: ids.slice(0, 100),
      error: ok ? null : (parseError || text.slice(0, 200)),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    const ms = Date.now() - started;
    const msg = err.name === 'AbortError' ? 'Timeout 15s — upstream tidak merespons.' : err.message;
    await store.updateProvider(p.id, {
      last_test: { at: new Date(), ok: false, status: 0, latency_ms: ms, models_found: 0, error: msg },
    });
    res.json({ ok: false, status: 0, latency_ms: ms, models_found: 0, models: [], error: msg });
  }
}));

/** Saran alias publik yang belum dipakai. */
app.get('/api/admin/alias/suggest', ...adminChain, asyncRoute(async (_req, res) => {
  const used = await store.usedAliases();
  res.json({ alias: store.suggestAlias(used), used });
}));

app.get('/api/admin/models', ...adminChain, asyncRoute(async (_req, res) => {
  const models = await store.listModels();
  res.json({
    models: models.map((m) => ({
      ...m,
      last_test: m.last_test ? { ...m.last_test, at: iso(m.last_test.at) } : null,
    })),
  });
}));

/**
 * Tes satu model end-to-end: kirim chat pendek ke upstream lewat
 * pipeline yang sama dengan yang dipakai user (provider + upstream_name).
 * Hasilnya menyimpan status + latensi supaya bisa dilihat kapan saja.
 */
app.post('/api/admin/models/:id/test', ...adminChain, asyncRoute(async (req, res) => {
  const m = await store.getModel(req.params.id);
  if (!m) return fail(res, 404, 'Model tidak ditemukan.', 'not_found');
  if (!m.provider_base_url) {
    return fail(res, 400, 'Provider model ini tidak ditemukan.', 'no_provider');
  }

  const prompt = (req.body?.prompt || 'Balas satu kata: OK').toString().slice(0, 200);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);

  try {
    const upstream = await fetch(`${m.provider_base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(m.provider_api_key ? { Authorization: `Bearer ${m.provider_api_key}` } : {}),
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: m.upstream_name || m.model_id,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        stream: false,
      }),
    });
    clearTimeout(timer);

    const ms = Date.now() - started;
    const text = await upstream.text();
    let reply = null;
    let usage = null;
    let parseError = null;

    try {
      const j = JSON.parse(text);
      const msgObj = j?.choices?.[0]?.message ?? null;
      reply = msgObj?.content || msgObj?.reasoning_content || j?.choices?.[0]?.text || null;
      usage = j?.usage ?? null;
      if (!reply) parseError = j?.error?.message || 'Respons tidak berisi jawaban.';
    } catch {
      parseError = 'Respons bukan JSON.';
    }

    const ok = upstream.ok && !!reply;
    await store.updateModel(m.id, {
      last_test: {
        at: new Date(),
        ok,
        status: upstream.status,
        latency_ms: ms,
        error: ok ? null : (parseError || `HTTP ${upstream.status}`),
      },
    });

    res.json({
      ok,
      status: upstream.status,
      latency_ms: ms,
      reply: reply ? String(reply).slice(0, 300) : null,
      usage,
      error: ok ? null : (parseError || text.slice(0, 300)),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    clearTimeout(timer);
    const ms = Date.now() - started;
    const msg = err.name === 'AbortError' ? 'Timeout 30s — model tidak merespons.' : err.message;
    await store.updateModel(m.id, {
      last_test: { at: new Date(), ok: false, status: 0, latency_ms: ms, error: msg },
    });
    res.json({ ok: false, status: 0, latency_ms: ms, reply: null, error: msg });
  }
}));

/**
 * Tes semua model sekaligus (batch) — untuk cek rutin "masih jalan semua?".
 * Dijalankan berurutan supaya tidak membanjiri provider.
 */
app.post('/api/admin/models/test-all', ...adminChain, asyncRoute(async (req, res) => {
  const list = await store.listModels();
  const results = [];

  for (const item of list) {
    // getModel() menyertakan provider_api_key — listModels() tidak,
    // jadi WAJIB ambil ulang per model supaya Authorization terkirim.
    const m = (await store.getModel(item.model_id)) || item;
    if (!m.provider_base_url) {
      results.push({ model_id: m.model_id, ok: false, error: 'provider hilang' });
      continue;
    }
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const upstream = await fetch(`${m.provider_base_url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(m.provider_api_key ? { Authorization: `Bearer ${m.provider_api_key}` } : {}),
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: m.upstream_name || m.model_id,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 100,
          stream: false,
        }),
      });
      clearTimeout(timer);
      const ms = Date.now() - started;
      const text = await upstream.text();
      let ok = upstream.ok;
      let reply = null;
      let reason = null;
      try {
        const j = JSON.parse(text);
        const msgObj = j?.choices?.[0]?.message ?? null;
        reply = msgObj?.content || msgObj?.reasoning_content || null;
        if (!reply) {
          ok = false;
          reason = j?.error?.message || 'respons tanpa jawaban';
        }
      } catch {
        ok = false;
        reason = text.slice(0, 200) || 'respons bukan JSON';
      }
      const errText = ok ? null : (reason || `HTTP ${upstream.status}`);
      await store.updateModel(m.id, {
        last_test: { at: new Date(), ok, status: upstream.status, latency_ms: ms, error: errText },
      });
      results.push({ model_id: m.model_id, ok, status: upstream.status, latency_ms: ms, error: errText });
    } catch (err) {
      const ms = Date.now() - started;
      const msg = err.name === 'AbortError' ? 'timeout' : err.message;
      await store.updateModel(m.id, {
        last_test: { at: new Date(), ok: false, status: 0, latency_ms: ms, error: msg },
      });
      results.push({ model_id: m.model_id, ok: false, error: msg, latency_ms: ms });
    }
  }

  res.json({
    checked: results.length,
    healthy: results.filter((r) => r.ok).length,
    results,
  });
}));

app.post('/api/admin/models', ...adminChain, asyncRoute(async (req, res) => {
  const { model_id, label, provider_id } = req.body || {};
  if (!model_id || !label || !provider_id) {
    return fail(res, 400, 'model_id, label & provider_id wajib.', 'invalid');
  }
  const exists = await store.getModel(model_id);
  if (exists) return fail(res, 409, `Alias "${model_id}" sudah dipakai.`, 'duplicate');
  res.json({ model: await store.createModel(req.body) });
}));

app.patch('/api/admin/models/:id', ...adminChain, asyncRoute(async (req, res) => {
  const { model_id: newAlias, ...patch } = req.body || {};
  const cur = await store.getModel(req.params.id);
  if (!cur) return fail(res, 404, 'Model tidak ditemukan.', 'not_found');

  // ganti alias publik (model_id) → dokumen baru, upstream_name tetap
  if (newAlias && newAlias !== req.params.id) {
    if (await store.aliasTaken(newAlias, req.params.id)) {
      return fail(res, 409, `Alias "${newAlias}" sudah dipakai model lain.`, 'alias_taken');
    }
    const renamed = await store.renameModelAlias(req.params.id, newAlias);
    if (Object.keys(patch).length) await store.updateModel(newAlias, patch);
    return res.json({ model: await store.getModel(newAlias), renamed_from: req.params.id });
  }

  const m = await store.updateModel(req.params.id, patch);
  res.json({ model: m });
}));

app.delete('/api/admin/models/:id', ...adminChain, asyncRoute(async (req, res) => {
  await store.deleteModel(req.params.id);
  res.json({ ok: true });
}));

/* ─────────────────────────── /v1 — OpenAI-compatible proxy ─────────────────────────── */

async function keyAuth(req) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return { error: ['401', 'API key wajib.', 'missing_key'] };

  const key = await store.keyByRaw(header.slice(7).trim());
  if (!key || key.status !== 'active') return { error: ['401', 'API key tidak valid.', 'invalid_key'] };

  const sub = await store.activeSubscription(key.user_id);
  if (!sub) return { error: ['402', 'Langganan tidak aktif.', 'subscription_inactive'] };

  return { key, sub };
}

/** Set pemilik request untuk limiter (dipanggil setelah key valid). */
function markUser(req, res, next) {
  const header = req.get('Authorization') || '';
  if (header.startsWith('Bearer ')) {
    req.apiUser = header.slice(7).trim().slice(0, 24); // prefix key = identitas stabil
  }
  next();
}

/**
 * Rate limit dipasang di seluruh /v1 — dihitung per user (dan global),
 * supaya satu user tidak bisa menghabiskan kuota atau membanjiri provider.
 */
app.use('/v1', markUser, rateLimit());

app.get('/v1/models', asyncRoute(async (req, res) => {
  const { error } = await keyAuth(req);
  if (error) return fail(res, Number(error[0]), error[1], error[2]);

  const models = await store.listModels({ onlyEnabled: true });
  res.json({
    object: 'list',
    data: models.map((m) => ({
      id: m.model_id,
      object: 'model',
      owned_by: 'cloviela',
      created: Math.floor(Date.now() / 1000),
    })),
  });
}));

app.all('/v1/*', asyncRoute(async (req, res) => {
  const started = Date.now();
  const requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  const { key, error } = await keyAuth(req);
  if (error) return fail(res, Number(error[0]), error[1], error[2]);

  const body = req.body && Object.keys(req.body).length ? { ...req.body } : undefined;
  const requestedModel = body?.model;
  if (!requestedModel) return fail(res, 400, 'Field "model" wajib.', 'missing_model');

  const model = await store.getModel(requestedModel);
  if (!model || !model.enabled || !model.provider_enabled) {
    return fail(res, 404, `Model "${requestedModel}" tidak dikenal.`, 'model_not_found');
  }

  // Susun URL upstream dengan aman: base_url bisa sudah berisi /v1
  // (mis. https://api.contoh.com/v1) atau belum (https://api.contoh.com).
  // Tanpa penanganan ini, "/v1" bisa dobel → /v1/v1/chat/completions → 404.
  const upstreamPath = req.path.replace(/^\/v1/, ''); // "/chat/completions"
  const upstream = model.provider_base_url.endsWith('/v1')
    ? `${model.provider_base_url}${upstreamPath}`
    : `${model.provider_base_url}/v1${upstreamPath}`;
  const upstreamBody = body
    ? { ...body, model: model.upstream_name || requestedModel }
    : undefined;

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(model.provider_api_key ? { Authorization: `Bearer ${model.provider_api_key}` } : {}),
        'X-Request-Id': requestId,
      },
      body: upstreamBody ? JSON.stringify(upstreamBody) : undefined,
    });
  } catch (err) {
    logUsage({ key, model, requestId, status: 502, ms: Date.now() - started });
    return fail(res, 502, `Upstream tidak bisa dihubungi: ${err.message}`, 'upstream_unreachable');
  }

  res.status(upstreamRes.status);
  res.set('X-Request-Id', requestId);
  const ctype = upstreamRes.headers.get('content-type') || 'application/json';
  res.set('Content-Type', ctype);

  const isStream = ctype.includes('text/event-stream');
  if (!isStream) {
    const text = await upstreamRes.text();
    logUsage({
      key,
      model,
      requestId,
      status: upstreamRes.status,
      ms: Date.now() - started,
      text,
    });
    return res.send(text);
  }

  const reader = upstreamRes.body.getReader();
  res.flushHeaders?.();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch {
    /* client memutus koneksi */
  } finally {
    res.end();
    logUsage({ key, model, requestId, status: upstreamRes.status, ms: Date.now() - started });
  }
}));

function logUsage({ key, model, requestId, status, ms, text }) {
  let tokensIn = null;
  let tokensOut = null;
  if (text) {
    try {
      const j = JSON.parse(text);
      tokensIn = j?.usage?.prompt_tokens ?? null;
      tokensOut = j?.usage?.completion_tokens ?? null;
    } catch {
      /* bukan JSON */
    }
  }
  // async — logging tidak boleh menambah latensi request
  store
    .logUsage({
      key_id: key.id,
      user_id: key.user_id,
      request_id: requestId,
      model: model.model_id,
      status_code: status,
      latency_ms: ms,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
    })
    .catch((e) => console.warn('[usage]', e.message));
}

/* ─────────────────────────── static + error ─────────────────────────── */

if (process.env.NODE_ENV === 'production') {
  const dist = join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/v1).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: { message: 'Server error.', code: 'internal' } });
});

/* cron ringan: expire langganan yang lewat */
setInterval(() => {
  store.expireOverdue().catch((e) => console.warn('[cron]', e.message));
}, 15 * 60 * 1000).unref?.();

/* cron crypto: cek order pending tiap 45 detik (webhook-nya blockchain) */
setInterval(() => {
  (async () => {
    const pending = await store.pendingCryptoOrders(60);
    for (const o of pending) await checkCryptoOrder(o);
  })().catch((e) => console.warn('[cron crypto]', e.message));
}, 45 * 1000).unref?.();

app.listen(PORT, () => {
  console.log(`▸ cloviela api   http://localhost:${PORT}`);
  console.log(`▸ backend        Firestore (${process.env.FIREBASE_PROJECT_ID || 'cloviela1'})`);
  console.log(`▸ payment        ${paymenku.paymenkuEnabled() ? paymenku.paymenkuMode() : 'disabled'}`);
  console.log(`▸ telegram admin ${process.env.TELEGRAM_BOT_TOKEN ? 'on' : 'off'}`);
});
