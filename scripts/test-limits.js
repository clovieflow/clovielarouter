/**
 * Uji rate limiter lewat HTTP (state limiter ada di proses server).
 * Jalankan saat server hidup: node scripts/test-limits.js
 */
import 'dotenv/config';

const API = process.env.API || 'http://localhost:8787';
const { auth } = await import('../server/firebase.js');
const store = await import('../server/store.js');

const cfg = await fetch(`${API}/api/health`).then((r) => r.json()).catch(() => ({}));
const L = cfg.limits || {};
console.log('konfigurasi server:', JSON.stringify({
  user_rpm: L.userRpm, user_concurrent: L.userConcurrent,
  global_rpm: L.globalRpm, global_concurrent: L.globalConcurrent,
}));

/* user + key uji */
const email = `limit-${Date.now()}@cloviela-test.local`;
const rec = await auth.createUser({ email, displayName: 'Limit Test' });
await store.upsertUser({ uid: rec.uid, email, name: 'Limit Test' });
const sub = await store.createSubscription(rec.uid, {
  plan: 'unlimited', priceIdr: 15000, days: 7, status: 'pending',
});
await store.activateSubscription(rec.uid, sub.id, 7);
const { raw: key } = await store.mintApiKey(rec.uid);

const call = () =>
  fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.TEST_MODEL || 'deepseek-v4.1-flash',
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });

const j = async (r) => { try { return await r.json(); } catch { return {}; } };
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'}  ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

/* ── 1. request normal berhasil ── */
console.log('\n── request normal ──');
const r1 = await call();
check('request pertama → 200', r1.status === 200, `status ${r1.status}`);
console.log(`  header: limit=${r1.headers.get('x-ratelimit-limit')} remaining=${r1.headers.get('x-ratelimit-remaining')}`);

/* ── 2. RPM ── */
console.log(`\n── RPM (batas ${L.userRpm}/menit, token bucket) ──`);
console.log('  Catatan: bucket diisi ulang bertahap, jadi request merata tidak diblokir.');
console.log('  Yang diuji: lonjakan (burst) paralel harus ditolak.');

// burst: kirim banyak sekaligus tanpa jeda → harus ada yang ditolak
const burst = await Promise.all(
  Array.from({ length: L.userRpm + 5 }, (_, i) =>
    i < 1 ? Promise.resolve(null) : call()   // 1 sudah dipakai di tes sebelumnya
  )
);
const burstCodes = burst.filter(Boolean).map((r) => r.status);
const burstBlocked = burstCodes.filter((c) => c === 429).length;
const burstOk = burstCodes.filter((c) => c === 200).length;

check('lonjakan paralel sebagian ditolak 429', burstBlocked > 0,
      `${burstOk} sukses, ${burstBlocked} ditolak`);

// ambil detail salah satu 429
const blockedRes = burst.find((r) => r && r.status === 429);
if (blockedRes) {
  const body = await j(blockedRes);
  check('header Retry-After ada', !!blockedRes.headers.get('retry-after'),
        `${blockedRes.headers.get('retry-after')}s`);
  check('header X-RateLimit-Scope ada', !!blockedRes.headers.get('x-ratelimit-scope'),
        String(blockedRes.headers.get('x-ratelimit-scope')));
  check('pesan error jelas', !!body.error?.message, (body.error?.message || '').slice(0, 70));
  check('kode error benar', body.error?.code === 'rate_limit' || body.error?.code === 'concurrency_limit',
        String(body.error?.code));
}

// rate merata TIDAK boleh diblokir (bukti bucket bekerja wajar)
console.log('\n  menguji pemakaian merata (5 request berurutan)…');
await new Promise((r) => setTimeout(r, 12_000)); // beri waktu bucket terisi
let sequentialOk = 0;
for (let i = 0; i < 5; i++) {
  const r = await call();
  if (r.status === 200) sequentialOk++;
  await new Promise((res) => setTimeout(res, 1200));
}
check('pemakaian merata tetap lancar', sequentialOk === 5, `${sequentialOk}/5 sukses`);

/* ── 3. concurrency (setelah tunggu token pulih) ── */
console.log(`\n── concurrency (batas ${L.userConcurrent}) ──`);
console.log('  menunggu token pulih…');
await new Promise((r) => setTimeout(r, 65_000)); // tunggu bucket terisi ulang

const parallel = await Promise.all(Array.from({ length: L.userConcurrent + 3 }, () => call()));
const codes = parallel.map((r) => r.status);
const concBlocked = codes.filter((c) => c === 429).length;
check('sebagian ditolak karena concurrency', concBlocked > 0, codes.join(', '));

/* ── 4. slot dilepas ── */
console.log('\n── slot concurrency dilepas ──');
await new Promise((r) => setTimeout(r, 3000));
const after = await call();
check('request baru setelah request lain selesai → 200', after.status === 200, `status ${after.status}`);

/* ── 5. beban server ── */
const health = await fetch(`${API}/api/health`).then((r) => r.json());
console.log(`\n── beban server: ${health.load?.active || 0}/${health.load?.capacity} slot terpakai`);
check('tidak ada slot bocor', (health.load?.active || 0) === 0, `${health.load?.active} aktif`);

/* bersihkan */
await store.revokeKeys(rec.uid);
await auth.deleteUser(rec.uid).catch(() => {});
console.log(`\n${fail === 0 ? '✓ semua lolos' : '✗ ada yang gagal'} — ${pass} lolos, ${fail} gagal`);
console.log('user uji dihapus');
