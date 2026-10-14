/**
 * Self-test lapisan data (server/store.js) di atas SQLite — TANPA Firebase,
 * TANPA server HTTP. Jalankan dari root repo:
 *
 *   node scripts/store-selftest.js            # DB in-memory
 *   node scripts/store-selftest.js /tmp/x.db  # atau file tertentu
 *
 * Yang diuji: users, langganan (aktif/perpanjang/expire), API key, payment +
 * index ref/trx, idempotensi webhook, usage log + ringkasan, provider/model
 * (+rename alias & batch delete), settings, order crypto (klaim atomik),
 * cron expireOverdue (collectionGroup), dan tampilan admin.
 */
process.env.DB_BACKEND = 'local';
process.env.DB_PATH = process.argv[2] || ':memory:';
process.env.ADMIN_EMAILS = 'admin@test.local';

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH && existsSync(resolve('secrets/firebase-service-account.json'))) {
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH = resolve('secrets/firebase-service-account.json');
}

const store = await import('../server/store.js');
const { db, backend } = await import('../server/firebase.js');

assert.equal(backend, 'local', 'backend harus local');
const ok = [];
const step = (name, fn) => Promise.resolve().then(fn).then(() => ok.push(name));

/* ── users ─────────────────────────────────────────────────────── */
await step('users: upsert + promosi admin via ADMIN_EMAILS', async () => {
  const admin = await store.upsertUser({ uid: 'u1', email: 'Admin@Test.local', name: 'Admin', picture: null });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.email, 'admin@test.local'); // dinormalkan lowercase
  const user = await store.upsertUser({ uid: 'u2', email: 'user@test.local' });
  assert.equal(user.role, 'user');
  const again = await store.upsertUser({ uid: 'u1', email: 'admin@test.local', name: 'Admin Baru' });
  assert.equal(again.name, 'Admin Baru');
  assert.equal(again.created_at, admin.created_at); // tidak menimpa created_at
  assert.equal((await store.getUser('u2')).uid, 'u2');
  assert.equal(await store.getUser('nope'), null);
});

/* ── langganan ─────────────────────────────────────────────────── */
await step('subs: pending → aktif → perpanjang menumpuk', async () => {
  const sub = await store.createSubscription('u1', { plan: 'unlimited', priceIdr: 15000, days: 7 });
  assert.equal(sub.status, 'pending');
  assert.equal(await store.activeSubscription('u1'), null);

  await store.activateSubscription('u1', sub.id, 7);
  const active = await store.activeSubscription('u1');
  assert.equal(active.status, 'active');
  assert.ok(new Date(active.expires_at) > new Date(), 'expires_at harus di masa depan');

  const before = new Date(active.expires_at).getTime();
  await store.activateSubscription('u1', sub.id, 1);
  const after = new Date((await store.activeSubscription('u1')).expires_at).getTime();
  assert.ok(Math.abs(after - (before + 864e5)) < 1000, '+1 hari menumpuk dari sisa, bukan reset');

  assert.equal((await store.latestSubscription('u1')).id, sub.id);
});

/* ── api keys ──────────────────────────────────────────────────── */
await step('keys: mint → lookup → revoke (hanya pemilik)', async () => {
  const key = await store.mintApiKey('u1');
  assert.ok(key.raw.startsWith('clv_'));
  assert.equal((await store.keyByRaw(key.raw)).id, key.id);
  assert.equal(await store.keyByRaw('clv_salah'), null);
  assert.equal((await store.activeKey('u1')).id, key.id);
  assert.equal(await store.revokeKey('u2', key.id), false, 'bukan pemilik tidak boleh revoke');
  assert.equal(await store.revokeKey('u1', key.id), true);
  assert.equal(await store.activeKey('u1'), null);
});

/* ── payments ──────────────────────────────────────────────────── */
await step('payments: buat → index ref/trx → pending → update', async () => {
  const pay = await store.createPayment('u1', {
    trx_id: 'trx1', reference_id: 'ref1', channel: 'qris', amount_idr: 15000, status: 'pending',
  });
  assert.ok(pay.id);
  assert.equal((await store.paymentByRef('ref1')).payment.id, pay.id);
  assert.equal((await store.paymentByTrx('trx1')).uid, 'u1');
  assert.equal((await store.pendingPayment('u1', 'qris')).id, pay.id);
  assert.equal(await store.pendingPayment('u1', 'va'), null, 'channel beda → tidak match');
  await store.updatePayment('u1', pay.id, { status: 'paid', paid_at: new Date().toISOString() });
  assert.equal((await store.paymentByRef('ref1')).payment.status, 'paid');
  assert.equal(await store.pendingPayment('u1', 'qris'), null);
  assert.equal((await store.listPayments('u1'))[0].id, pay.id);
});

await step('webhook: idempotensi (klaim kedua ditolak)', async () => {
  assert.equal(await store.claimWebhook('trx1', 'paid'), true);
  assert.equal(await store.claimWebhook('trx1', 'paid'), false);
});

/* ── usage ─────────────────────────────────────────────────────── */
await step('usage: log + ringkasan (model, error, token)', async () => {
  await store.logUsage({ request_id: 'r1', user_id: 'u1', key_id: null, model: 'clv-nano', status_code: 200, latency_ms: 120, tokens_in: 10, tokens_out: 20 });
  await store.logUsage({ request_id: 'r2', user_id: 'u1', key_id: null, model: 'clv-nano', status_code: 500, latency_ms: 300 });
  await store.logUsage({ request_id: 'r3', user_id: 'u2', key_id: null, model: 'clv-mini', status_code: 200, latency_ms: 90 });

  const sum = await store.usageSummary('u1');
  assert.equal(sum.totals.total, 2);
  assert.equal(sum.totals.err_count, 1);
  assert.equal(sum.totals.tokens_in, 10);
  assert.equal(sum.byModel[0].model, 'clv-nano');
  assert.equal(sum.byModel[0].errors, 1);
  assert.equal(sum.totals.last24, 2);
  assert.ok(sum.daily.length >= 1);
});

/* ── providers & models ────────────────────────────────────────── */
await step('models: sanitasi id, relasi provider, rename alias, batch delete', async () => {
  const prov = await store.createProvider({ name: 'Mock', base_url: 'https://mock.test/v1/', api_key: 'sk-x' });
  assert.equal(prov.base_url, 'https://mock.test/v1', 'trailing slash dipangkas');

  const model = await store.createModel({
    model_id: 'Vendor/Model A', label: 'Model A', provider_id: prov.id, upstream_name: 'Vendor/Model A',
  });
  assert.equal(model.id, 'Vendor-Model-A', "id disanitasi ('/'→'-')");

  const got = await store.getModel(model.id);
  assert.equal(got.provider_name, 'Mock');
  assert.equal(got.provider_api_key, 'sk-x');

  const renamed = await store.renameModelAlias(model.id, 'clv-nano');
  assert.equal(renamed.id, 'clv-nano');
  assert.equal(renamed.upstream_name, 'Vendor/Model A', 'upstream tidak berubah');
  assert.equal(await store.getModel('Vendor-Model-A'), null, 'dokumen lama terhapus');

  assert.ok((await store.usedAliases()).includes('clv-nano'));
  assert.equal(await store.aliasTaken('clv-nano'), true);
  assert.equal(await store.aliasTaken('clv-nano', 'clv-nano'), false);
  assert.equal(store.suggestAlias(['clv-nano', 'clv-mini']), 'clv-smart');

  await store.updateModel('clv-nano', { enabled: false });
  assert.equal((await store.listModels({ onlyEnabled: true })).length, 0);

  await store.deleteProvider(prov.id); // batch: model + provider sekaligus
  assert.equal((await store.listModels()).length, 0);
  assert.equal(await store.getProvider(prov.id), null);
});

/* ── settings ──────────────────────────────────────────────────── */
await step('settings: simpan + baca (nested utuh)', async () => {
  await store.saveSettings('crypto', { enabled: true, wallets: { trc20: 'T-Alamat', evm: '0xAlamat' } });
  const s = await store.getSettings('crypto');
  assert.equal(s.enabled, true);
  assert.equal(s.wallets.trc20, 'T-Alamat');
  assert.ok(s.updated_at);
  assert.equal(await store.getSettings('tidak-ada'), null);
});

/* ── order crypto ──────────────────────────────────────────────── */
await step('crypto: order + klaim atomik (yang kedua dapat null)', async () => {
  const order = await store.createCryptoOrder({
    reference: 'REFX', user_id: 'u2', amount_idr: 15000, chain: 'trc20', status: 'pending',
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
  });
  assert.equal(order.id, 'REFX');
  assert.equal((await store.cryptoOrderByRef('REFX')).status, 'pending');
  assert.equal((await store.pendingCryptoOrders()).length, 1);

  const win = await store.claimCryptoPaid('REFX', { status: 'paid' });
  assert.equal(win.status, 'paid');
  assert.ok((await store.cryptoOrderByRef('REFX')).paid_at, 'paid_at tersimpan di dokumen');
  assert.equal(await store.claimCryptoPaid('REFX', { status: 'paid' }), null, 'klaim kedua harus null');
  assert.equal((await store.pendingCryptoOrders()).length, 0);
  assert.equal((await store.listCryptoOrders('u2')).length, 1);
});

/* ── cron expire ───────────────────────────────────────────────── */
await step('cron: expireOverdue (collectionGroup) + cabut key', async () => {
  const sub = await store.createSubscription('u2', { plan: 'unlimited', priceIdr: 15000, days: 1 });
  await store.activateSubscription('u2', sub.id, 1);
  const key = await store.mintApiKey('u2');

  // mundurkan expires_at langsung (mensimulasikan langganan yang lewat)
  await db.collection('users/u2/subscriptions').doc(sub.id).set(
    { expires_at: new Date(Date.now() - 60_000).toISOString() },
    { merge: true }
  );

  const expired = await store.expireOverdue();
  assert.ok(expired >= 1, 'minimal 1 langganan kedaluwarsa');
  assert.equal(await store.activeSubscription('u2'), null);
  assert.equal(await store.activeKey('u2'), null, 'key ikut dicabut');
  assert.equal((await db.collection('api_keys').doc(key.id).get()).data().status, 'revoked');
});

/* ── admin views ───────────────────────────────────────────────── */
await step('admin: stats, daftar user, daftar pembayaran', async () => {
  const stats = await store.adminStats();
  assert.equal(stats.users, 2);
  assert.ok(stats.revenue_idr >= 15000);
  assert.equal(stats.pending_payments, 0);

  const users = await store.adminUsers('admin');
  assert.equal(users.length, 1);
  assert.equal(users[0].email, 'admin@test.local');
  assert.equal(users[0].sub_status, 'active');
  assert.deepEqual(await store.adminUsers('tidak-ada'), []);

  const payments = await store.adminPayments();
  const paid = payments.find((p) => p.status === 'paid');
  assert.ok(paid, 'pembayaran paid muncul');
  assert.equal(paid.email, 'admin@test.local');
  assert.ok(paid.created_at > '2020');
});

/* ── payload ke frontend ───────────────────────────────────────── */
await step('userPayload: bentukan untuk /api/me', async () => {
  const payload = await store.userPayload(await store.getUser('u1'));
  assert.equal(payload.admin, true);
  assert.equal(payload.subscription.status, 'active');
  assert.ok(payload.subscription.days_left >= 1);
  assert.equal(payload.api_key, null, 'key u1 sudah dicabut');
});

console.log(`✓ selftest lolos — ${ok.length} blok:`);
for (const name of ok) console.log(`   • ${name}`);
