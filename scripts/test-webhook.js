/**
 * Test webhook Paymenku (signature HMAC-SHA256) + aktivasi otomatis.
 * Jalankan saat server hidup:  node scripts/test-webhook.js
 */
import 'dotenv/config';
import { createHmac } from 'node:crypto';

const API = process.env.API || 'http://localhost:8787';
const SECRET = process.env.PAYMENKU_WEBHOOK_SECRET || 'whsec_test_123';

const { auth } = await import('../server/firebase.js');
const store = await import('../server/store.js');

/* siapkan user Firebase + payment pending di Firestore */
const email = `webhook-${Date.now()}@cloviela-test.local`;
const rec = await auth.createUser({ email, displayName: 'Webhook Test' });
await store.upsertUser({ uid: rec.uid, email, name: 'Webhook Test' });
const user = { id: rec.uid, uid: rec.uid, email };

const sub = await store.createSubscription(rec.uid, {
  plan: 'unlimited', priceIdr: 15000, days: 7, status: 'pending',
});
const subId = sub.id;

const trxId = `IDP${Date.now()}`;
const ref = `CLV-TEST-${Date.now().toString(36).toUpperCase()}`;
await store.createPayment(rec.uid, {
  subscription_id: subId,
  amount_idr: 15000,
  channel: 'qris',
  reference_id: ref,
  trx_id: trxId,
  status: 'pending',
});

/* kirim webhook "paid" dengan signature benar */
const payload = JSON.stringify({
  event: 'payment.status_updated',
  trx_id: trxId,
  reference_id: ref,
  status: 'paid',
  amount: '15205.00',
  total_fee: '205.00',
  amount_received: '15000.00',
  payment_channel: 'qris',
  customer_name: 'Webhook Test',
  customer_email: email,
  paid_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  is_sandbox: true,
});

const ts = Math.floor(Date.now() / 1000).toString();
const sig = createHmac('sha256', SECRET).update(`${ts}.${payload}`).digest('hex');

const send = async (timestamp, signature, body) => {
  const res = await fetch(`${API}/api/webhook/paymenku`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PaymenKu-Timestamp': timestamp,
      'X-PaymenKu-Signature': signature,
    },
    body,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

console.log('▸ signature salah ', await send(ts, 'deadbeef', payload));
console.log('▸ signature benar ', await send(ts, sig, payload));

/* cek hasil */
const found = await store.paymentByTrx(trxId);
const subAfter = await store.activeSubscription(rec.uid);
const key = await store.activeKey(rec.uid);

console.log('▸ payment status  ', found?.payment.status);
console.log('▸ subscription    ', subAfter ? `${subAfter.status} → ${store.iso ? new Date(subAfter.expires_at.toDate()).toISOString() : ''}` : 'TIDAK AKTIF');
console.log('▸ api key terbit  ', key ? `${key.key_prefix}… (${key.status})` : 'TIDAK ADA');

/* replay: harus tidak dobel */
const again = await send(ts, sig, payload);
console.log('▸ replay (idempoten)', again.status, again.data);

/* bersihkan */
await auth.deleteUser(rec.uid).catch(() => {});
console.log('\n✓ selesai — user uji dihapus');
