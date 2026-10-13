/**
 * End-to-end test dengan Firestore + Firebase Auth (tanpa browser).
 *
 * Membuat user Firebase sungguhan (email dummy), lalu:
 *   1. provider & model mock di Firestore
 *   2. langganan aktif + API key
 *   3. /v1/models, /v1/chat/completions (stream & non-stream)
 *   4. validasi error (key salah, model tidak ada, tanpa key)
 *
 * Jalankan saat server hidup:  node scripts/smoke.js
 */
import 'dotenv/config';

const API = process.env.API || 'http://localhost:8787';

const j = async (path, opts = {}) => {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const { auth } = await import('../server/firebase.js');
const store = await import('../server/store.js');

console.log('▸ health      ', (await j('/api/health')).data);

/* 1. user Firebase sungguhan */
const email = `smoke-${Date.now()}@cloviela-test.local`;
const pass = 'SmokeTest123!';
let userRecord;
try {
  userRecord = await auth.createUser({ email, password: pass, displayName: 'Smoke Test' });
} catch (e) {
  console.log('✗ gagal bikin user firebase:', e.message);
  process.exit(1);
}
console.log('▸ firebase user', userRecord.uid, email);

/* 2. dokumen user + langganan + key */
await store.upsertUser({
  uid: userRecord.uid,
  email,
  name: 'Smoke Test',
  picture: null,
});

const prov = await store.createProvider({
  name: 'Mock Local',
  base_url: 'http://localhost:9999/v1',
  notes: 'testing',
});
await store.createModel({
  model_id: 'mock-model',
  label: 'Mock Model',
  provider_id: prov.id,
  description: 'model uji',
});

const sub = await store.createSubscription(userRecord.uid, {
  plan: 'unlimited',
  priceIdr: 15000,
  days: 7,
  status: 'pending',
});
await store.activateSubscription(userRecord.uid, sub.id, 7);

const minted = await store.mintApiKey(userRecord.uid);
console.log('▸ api key     ', minted.prefix + '…');

/* 3. ID token dari Firebase (dipakai frontend → server)
      Password login disabled (kita hanya pakai Google), jadi pakai custom token. */
const apiKey = process.env.FIREBASE_API_KEY;
const customToken = await auth.createCustomToken(userRecord.uid);
const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  }
);
const signInData = await signIn.json();
if (!signInData.idToken) {
  console.log('✗ tukar token gagal:', JSON.stringify(signInData).slice(0, 300));
  process.exit(1);
}
const idToken = signInData.idToken;
const authHeader = { Authorization: `Bearer ${idToken}` };
console.log('▸ id token    ', idToken.slice(0, 24) + '…');

/* 4. endpoint user pakai Firebase ID token */
const me = await j('/api/me', { headers: authHeader });
console.log('▸ /api/me     ', me.status, me.data.user?.email, '| aktif:', !!me.data.user?.subscription);

const usage = await j('/api/usage', { headers: authHeader });
console.log('▸ /api/usage  ', usage.status, 'totals:', usage.data.totals);

const meNoToken = await j('/api/me');
console.log('▸ /api/me anon', meNoToken.status, '(user null = benar)');

/* 5. proxy /v1 pakai API key cloviela */
const models = await j('/v1/models', { headers: { Authorization: `Bearer ${minted.raw}` } });
console.log('▸ /v1/models  ', models.status, models.data.data?.map((m) => m.id));

const chat = await j('/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${minted.raw}` },
  body: { model: 'mock-model', messages: [{ role: 'user', content: 'Halo' }] },
});
console.log('▸ chat        ', chat.status, chat.data.choices?.[0]?.message?.content);

const streamRes = await fetch(API + '/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${minted.raw}` },
  body: JSON.stringify({ model: 'mock-model', messages: [{ role: 'user', content: 'Halo' }], stream: true }),
});
const streamText = await streamRes.text();
console.log('▸ stream      ', streamRes.status, streamText.slice(0, 60).replace(/\n/g, '⏎'), '…');

const bad = await j('/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: 'Bearer clv_salah' },
  body: { model: 'mock-model', messages: [] },
});
console.log('▸ key invalid ', bad.status, bad.data.error?.code);

const nf = await j('/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${minted.raw}` },
  body: { model: 'tidak-ada', messages: [] },
});
console.log('▸ model 404   ', nf.status, nf.data.error?.code);

/* 6. bersihkan */
await store.revokeKeys(userRecord.uid);
await auth.deleteUser(userRecord.uid).catch(() => {});
console.log('\n✓ selesai — data uji dibersihkan');
