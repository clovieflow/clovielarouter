import { useEffect, useState } from 'react';
import { api, setTokenProvider } from './api';
import { watchAuth, firebaseSignOut } from './firebase';

/** Ambil config sekali (harga, plan days, firebase keys). */
export function useConfig() {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig({ price_idr: 15000, plan_days: 7 }));
  }, []);
  return config;
}

/**
 * Auth state dari Firebase (Google Sign-In).
 * - `user` = profil dari server (langganan, key) — null kalau belum login
 * - token Firebase otomatis dipasang ke semua request API
 */
export function useAuth(config) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // token provider untuk api client
  useEffect(() => {
    setTokenProvider(async () => token);
  }, [token]);

  const loadProfile = async () => {
    const { user } = await api.me();
    setUser(user);
    return user;
  };

  useEffect(() => {
    if (!config?.firebase?.apiKey) return;
    let cancelled = false;
    const unsub = watchAuth(config, async (idToken) => {
      if (cancelled) return;
      if (!idToken) {
        setToken(null);
        setUser(null);
        return;
      }
      setToken(idToken);
      try {
        setTokenProvider(async () => idToken);
        await api.syncUser();       // pastikan dokumen user ada di Firestore
        const { user } = await api.me();
        if (!cancelled) setUser(user);
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setUser(null);
        }
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [config]);

  const login = async () => {
    setBusy(true);
    setError('');
    try {
      const { signInWithGoogle } = await import('./firebase');
      const idToken = await signInWithGoogle(config);
      setToken(idToken);
      setTokenProvider(async () => idToken);
      await api.syncUser();
      const { user } = await api.me();
      setUser(user);
      return user;
    } catch (e) {
      setError(e.message || 'Gagal login.');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await firebaseSignOut(config).catch(() => {});
    setToken(null);
    setUser(null);
  };

  const refresh = async () => loadProfile();

  return { user, token, busy, error, login, logout, refresh, setUser };
}

/** Deteksi path (tanpa react-router — bundle tetap kecil). */
export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

export function navigate(to) {
  if (window.location.pathname + window.location.search === to) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}
