import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

/**
 * Firebase — project: cloviela1
 * Google Sign-In (Firebase Auth) saja.
 *
 * Data (langganan, pembayaran, key) TIDAK diambil dari Firestore lagi —
 * semua lewat API server sendiri (/api/*) yang menyimpan di SQLite.
 * Config datang dari server (/api/config) supaya tidak perlu rebuild
 * saat pindah environment; fallback ke app project cloviela1.
 */
const FALLBACK = {
  apiKey: 'AIzaSyDAIf-YBTqwJ9YRawMyHccoUZwmRAjEO7U',
  authDomain: 'cloviela1.firebaseapp.com',
  projectId: 'cloviela1',
  storageBucket: 'cloviela1.firebasestorage.app',
  messagingSenderId: '513134013669',
  appId: '1:513134013669:web:7d9dd2652bf20ef153f80c',
};

let _app = null;

export function initFirebase(config) {
  if (!_app) {
    const cfg = config?.apiKey ? config : FALLBACK;
    _app = getApps().length ? getApps()[0] : initializeApp(cfg);
  }
  return _app;
}

export function getFirebaseAuth(config) {
  return getAuth(initFirebase(config));
}

/** Login Google via popup → kembalikan ID token untuk dikirim ke server. */
export async function signInWithGoogle(config) {
  const auth = getFirebaseAuth(config);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
}

export async function firebaseSignOut(config) {
  await signOut(getFirebaseAuth(config));
}

/**
 * Pantau sesi Firebase. Callback menerima ID token terbaru (atau null).
 * Token ini dipakai untuk semua request API ke server.
 */
export function watchAuth(config, onChange) {
  const auth = getFirebaseAuth(config);
  return onAuthStateChanged(auth, async (user) => {
    if (!user) return onChange(null, null);
    const token = await user.getIdToken();
    onChange(token, {
      uid: user.uid,
      email: user.email,
      name: user.displayName,
      photo: user.photoURL,
    });
  });
}
