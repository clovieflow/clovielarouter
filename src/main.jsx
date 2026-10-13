import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import { api } from './api';
import { useAuth, useConfig, usePath, navigate } from './hooks';
import { Nav, Landing, LoginPage, CheckoutPage } from './components/Pages';
import { DashboardShell, Overview, Keys, Usage, Billing } from './components/Dashboard';
import { Docs, StatusPage } from './components/Docs';
import { Models, Logs } from './components/Models';
import { Admin } from './components/Admin';

function App() {
  const config = useConfig();
  const auth = useAuth(config);
  const path = usePath();
  const [models, setModels] = useState([]);
  const [_, forceRender] = useState(0);

  useEffect(() => {
    api.models().then((r) => setModels(r.models || [])).catch(() => {});
  }, []);

  // re-render global saat bahasa diganti toggle
  useEffect(() => {
    const onLang = () => forceRender((n) => n + 1);
    window.addEventListener('clv-lang-change', onLang);
    return () => window.removeEventListener('clv-lang-change', onLang);
  }, []);

  const { user, logout } = auth;
  const clean = path.split('?')[0];

  // masih memuat sesi
  if (user === undefined) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  /* ── halaman publik ── */
  if (clean === '/' || clean === '') {
    return (
      <>
        <Nav user={user} onLogout={logout} config={config} onLogin={auth.login} />
        <Landing user={user} config={config} models={models} />
      </>
    );
  }

  if (clean === '/login') {
    return (
      <>
        <Nav user={user} onLogout={logout} config={config} onLogin={auth.login} />
        <LoginPage config={config} onLogin={auth.login} busy={auth.busy} error={auth.error} />
      </>
    );
  }

  if (clean === '/checkout') {
    return (
      <>
        <Nav user={user} onLogout={logout} config={config} onLogin={auth.login} />
        <CheckoutPage user={user} config={config} onLogin={auth.login} refresh={auth.refresh}
                      busy={auth.busy} error={auth.error} />
      </>
    );
  }

  if (clean === '/docs') {
    return (
      <>
        <Nav user={user} onLogout={logout} config={config} onLogin={auth.login} />
        <Docs user={user} config={config} models={models} />
      </>
    );
  }

  // status layanan: khusus admin — user biasa diarahkan balik ke beranda
  if (clean === '/status') {
    if (user && user.admin) {
      return (
        <>
          <Nav user={user} onLogout={logout} config={config} onLogin={auth.login} />
          <StatusPage config={config} models={models} />
        </>
      );
    }
    return (
      <>
        <Nav user={user} onLogout={logout} config={config} onLogin={auth.login} />
        <Landing user={user} config={config} models={models} />
      </>
    );
  }

  /* ── butuh login ── */
  if (!user) {
    return (
      <>
        <Nav user={null} onLogout={logout} config={config} />
        <LoginPage config={config} onLogin={auth.login} busy={auth.busy} error={auth.error} />
      </>
    );
  }

  /* ── admin ── */
  if (clean.startsWith('/admin')) {
    return (
      <>
        <Nav user={user} onLogout={logout} config={config} onLogin={auth.login} />
        <Admin user={user} />
      </>
    );
  }

  /* ── dashboard ── */
  const page =
    clean === '/dashboard/models' ? <Models user={user} models={models} config={config} /> :
    clean === '/dashboard/logs' ? <Logs /> :
    clean === '/dashboard/keys' ? <Keys user={user} refresh={auth.refresh} config={config} /> :
    clean === '/dashboard/usage' ? <Usage /> :
    clean === '/dashboard/billing' ? <Billing user={user} refresh={auth.refresh} /> :
    <Overview user={user} refresh={auth.refresh} config={config} />;

  return (
    <DashboardShell user={user} onLogout={logout} active={clean}>
      {page}
    </DashboardShell>
  );
}

createRoot(document.getElementById('root')).render(<App />);
