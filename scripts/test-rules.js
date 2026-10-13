/**
 * Uji security rules Firestore dari sisi client (pakai REST API
 * dengan ID token, sama seperti browser).
 *
 * Jalankan: node scripts/test-rules.js
 */
import 'dotenv/config';

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'cloviela1';
const API_KEY = process.env.FIREBASE_API_KEY;

const { auth } = await import('../server/firebase.js');
const store = await import('../server/store.js');

const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const idTokenFor = async (uid) => {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const d = await res.json();
  if (!d.idToken) throw new Error(JSON.stringify(d));
  return d.idToken;
};

const read = async (path, token) => {
  const res = await fetch(`${FS}/${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const write = async (path, token, fields) => {
  const res = await fetch(`${FS}/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ fields }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const str = (v) => ({ stringValue: v });

/* dua user uji */
const mk = async (n) => {
  const email = `rules-${n}-${Date.now()}@cloviela-test.local`;
  const u = await auth.createUser({ email, displayName: `Rules ${n}` });
  await store.upsertUser({ uid: u.uid, email, name: `Rules ${n}` });
  const token = await idTokenFor(u.uid);
  return { uid: u.uid, email, token };
};

const a = await mk('a');
const b = await mk('b');
console.log('▸ user A', a.uid, '\n▸ user B', b.uid);

const check = (label, cond) => console.log(`  ${cond ? '✓' : '✗ GAGAL'}  ${label}`);

console.log('\n── users ──');
const ownDoc = await read(`users/${a.uid}`, a.token);
check('A baca dokumennya sendiri → 200', ownDoc.status === 200);

const otherDoc = await read(`users/${b.uid}`, a.token);
check('A baca dokumen B → ditolak', otherDoc.status === 403);

const anonDoc = await read(`users/${a.uid}`, null);
check('tanpa login → ditolak', anonDoc.status === 403);

console.log('\n── eskalasi role ──');
const escalate = await write(`users/${a.uid}`, a.token, {
  uid: str(a.uid),
  email: str(a.email),
  name: str('Hacker'),
  role: str('admin'),
  created_at: { timestampValue: new Date().toISOString() },
});
check('A ubah role jadi admin → ditolak', escalate.status === 403);

console.log('\n── api_keys (harus tertutup) ──');
const keys = await read('api_keys', a.token);
check('A baca koleksi api_keys → ditolak', keys.status === 403);

console.log('\n── langganan ──');
const sub = await store.createSubscription(a.uid, {
  plan: 'unlimited', priceIdr: 15000, days: 7, status: 'pending',
});
const ownSub = await read(`users/${a.uid}/subscriptions/${sub.id}`, a.token);
check('A baca langganannya → 200', ownSub.status === 200);

const otherSub = await read(`users/${b.uid}/subscriptions/x`, a.token);
check('A baca langganan B → ditolak', otherSub.status === 403);

const forgeSub = await write(`users/${a.uid}/subscriptions/fake`, a.token, {
  status: str('active'), days: { integerValue: '999' },
});
check('A palsukan langganan aktif → ditolak', forgeSub.status === 403);

console.log('\n── models publik ──');
const models = await read('models', a.token);
check('A baca daftar model → 200', models.status === 200);

console.log('\n── provider (admin-only) ──');
const provs = await read('providers', a.token);
check('A (bukan admin) baca provider → ditolak', provs.status === 403);

/* bersihkan */
await auth.deleteUser(a.uid).catch(() => {});
await auth.deleteUser(b.uid).catch(() => {});
console.log('\n✓ selesai — user uji dihapus');
