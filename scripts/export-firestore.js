/**
 * Ekspor SELURUH data Firestore → satu file JSON (untuk migrasi ke SQLite).
 *
 *   node scripts/export-firestore.js [keluaran.json] [--watch]
 *
 *   --watch  tunggu sampai kuota Firestore pulih (Spark reset tengah malam PT):
 *            coba tiap 10 menit, menyerah setelah 24 jam. Dipakai untuk
 *            ekspor otomatis setelah kena "Quota exceeded".
 *
 * Kredensial sama dengan server: FIREBASE_SERVICE_ACCOUNT (JSON string),
 * FIREBASE_SERVICE_ACCOUNT_PATH, GOOGLE_APPLICATION_CREDENTIALS, atau
 * secrets/firebase-service-account.json.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Firestore } from '@google-cloud/firestore';

const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'firestore-export.json';
const WATCH = process.argv.includes('--watch');
const RETRY_MS = 10 * 60 * 1000;
const MAX_HOURS = 24;

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'cloviela1';

const TOP = ['users', 'api_keys', 'usage_logs', 'providers', 'models', 'trx_index', 'ref_index', 'webhook_events', 'settings', 'crypto_orders'];
const SUBS = ['subscriptions', 'payments'];

function firestore() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    return new Firestore({
      projectId: PROJECT,
      credentials: { client_email: sa.client_email, private_key: sa.private_key },
    });
  }
  const path =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    (existsSync(resolve('secrets/firebase-service-account.json')) ? resolve('secrets/firebase-service-account.json') : null);
  return new Firestore(path ? { projectId: PROJECT, keyFilename: path } : { projectId: PROJECT });
}

/** Firestore Timestamp/Date/dll → JSON polos (timestamp jadi ISO string). */
function plain(v) {
  if (v == null) return v;
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = plain(val);
    return out;
  }
  return v;
}

async function dump(db) {
  const collections = {};

  for (const name of TOP) {
    try {
      const snap = await db.collection(name).get();
      collections[name] = snap.docs.map((d) => ({ id: d.id, data: plain(d.data()) }));
    } catch (e) {
      // Koleksi belum ada: Firestore tidak error untuk ini, tapi jaga-jaga.
      if (String(e.message).includes('not found')) { collections[name] = []; continue; }
      throw e;
    }
  }

  const users = collections.users || [];
  for (const u of users) {
    for (const sub of SUBS) {
      const snap = await db.collection('users').doc(u.id).collection(sub).get();
      collections[`users/${u.id}/${sub}`] = snap.docs.map((d) => ({ id: d.id, data: plain(d.data()) }));
    }
  }

  return {
    exported_at: new Date().toISOString(),
    project: PROJECT,
    collections,
  };
}

const isQuota = (e) => e?.code === 8 || /quota/i.test(String(e?.details || e?.message || ''));

async function main() {
  const db = firestore();
  const deadline = Date.now() + MAX_HOURS * 3600 * 1000;

  for (;;) {
    try {
      const out = await dump(db);
      writeFileSync(OUT, JSON.stringify(out, null, 1));
      const total = Object.values(out.collections).reduce((n, rows) => n + rows.length, 0);
      console.log(`✓ ekspor selesai → ${OUT} (${total} dokumen)`);
      for (const [name, rows] of Object.entries(out.collections)) {
        if (rows.length) console.log(`  ${name}: ${rows.length}`);
      }
      return;
    } catch (e) {
      if (!WATCH || !isQuota(e) || Date.now() > deadline) {
        console.error(`✗ ekspor gagal: ${e.code || ''} ${e.details || e.message}`);
        process.exit(1);
      }
      console.log(`… kuota Firestore masih habis (${e.details || e.message}) — coba lagi 10 menit`);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}

main();
