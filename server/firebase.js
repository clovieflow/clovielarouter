import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue as FirestoreFieldValue, Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore';
import { createLocalDb, nowIso } from './localdb.js';

/**
 * Firebase Admin SDK — dipakai server HANYA untuk Auth (verifikasi ID token
 * user yang login dengan Google). Semua data ada di SQLite lokal (localdb.js).
 *
 * Backend data diatur `DB_BACKEND`:
 *   local (default) → SQLite via localdb.js (DB_PATH, default data/cloviela.db)
 *   firestore       → Firestore (peninggalan; hanya untuk baca/ekspor data lama)
 *
 * Kredensial Firebase, urutan prioritas:
 *   1. FIREBASE_SERVICE_ACCOUNT        (JSON string — cocok untuk deploy/env var)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH   (path ke file JSON)
 *   3. GOOGLE_APPLICATION_CREDENTIALS  (Application Default Credentials)
 *   4. secrets/firebase-service-account.json (lokal, gitignored)
 */
function credentials() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  const path =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    (existsSync(resolve('secrets/firebase-service-account.json'))
      ? resolve('secrets/firebase-service-account.json')
      : null);
  if (path) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
}

export const projectId = process.env.FIREBASE_PROJECT_ID || 'cloviela1';

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ projectId, credential: credentials() });

export const auth = getAuth(app);

/** Backend data aktif: 'local' (SQLite) atau 'firestore'. */
export const backend = (process.env.DB_BACKEND || 'local').toLowerCase() === 'firestore' ? 'firestore' : 'local';

export const db = backend === 'local' ? createLocalDb({ path: process.env.DB_PATH }) : getFirestore(app);

if (backend === 'firestore') db.settings({ ignoreUndefinedProperties: true });

/** Nilai timestamp untuk ditulis: ISO string (lokal) / serverTimestamp (Firestore). */
export const now = () => (backend === 'local' ? nowIso() : FirestoreFieldValue.serverTimestamp());

/** `Timestamp.fromDate()` — dipakai store.activateSubscription. */
export const Timestamp =
  backend === 'local'
    ? { fromDate: (d) => new Date(d).toISOString(), now: nowIso }
    : FirestoreTimestamp;

export const FieldValue =
  backend === 'local' ? { serverTimestamp: nowIso } : FirestoreFieldValue;

/** Timestamp → ISO string (untuk JSON API). */
export const iso = (ts) => {
  if (!ts) return null;
  if (typeof ts === 'string') return ts;
  if (typeof ts?.toDate === 'function') return ts.toDate().toISOString();
  const d = new Date(ts);
  return Number.isNaN(+d) ? null : d.toISOString();
};

/** Nama koleksi — satu tempat biar tidak salah ketik. */
export const C = {
  users: 'users',
  apiKeys: 'api_keys',
  usage: 'usage_logs',
  providers: 'providers',
  models: 'models',
  trxIndex: 'trx_index',
  refIndex: 'ref_index',
  webhooks: 'webhook_events',
  settings: 'settings',
  cryptoOrders: 'crypto_orders',
  subscriptions: (uid) => `users/${uid}/subscriptions`,
  payments: (uid) => `users/${uid}/payments`,
};

export { app };
export default { app, auth, db };
