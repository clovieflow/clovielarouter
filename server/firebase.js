import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * Firebase Admin SDK — dipakai server untuk Auth (verifikasi ID token)
 * dan Firestore (semua baca/tulis data). Project: cloviela1
 *
 * Kredensial, urutan prioritas:
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

const projectId = process.env.FIREBASE_PROJECT_ID || 'cloviela1';

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ projectId, credential: credentials() });

export const auth = getAuth(app);
export const db = getFirestore(app);

db.settings({ ignoreUndefinedProperties: true });

/** Firestore Timestamp → ISO string (untuk JSON API). */
export const iso = (ts) => {
  if (!ts) return null;
  if (typeof ts === 'string') return ts;
  if (typeof ts?.toDate === 'function') return ts.toDate().toISOString();
  const d = new Date(ts);
  return Number.isNaN(+d) ? null : d.toISOString();
};

export const now = () => FieldValue.serverTimestamp();
export const timestamp = Timestamp;

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
  subscriptions: (uid) => `users/${uid}/subscriptions`,
  payments: (uid) => `users/${uid}/payments`,
};

export { app, FieldValue, Timestamp };
export default { app, auth, db };
