import { useEffect, useState } from 'react';
import { api, rupiah } from '../api';
import { navigate } from '../hooks';
import { t, setLang, getLang } from '../lang';
import { GoogleButton, Avatar } from './Auth';
import { LogoMark } from './Logo';

/* ── Nav ─────────────────────────────────────────── */

export function Nav({ user, onLogout, config, onLogin }) {
  const [lang, setLangState] = useState(getLang());
  const [open, setOpen] = useState(false);
  const toggle = () => {
    const next = lang === 'id' ? 'en' : 'id';
    setLang(next);
    setLangState(next);
  };
  const go = (path) => {
    setOpen(false);
    navigate(path);
  };
  // CTA utama: sudah login → dashboard dulu; belum → checkout (login dulu di sana)
  const ctaGo = () => go(user ? '/dashboard' : '/checkout');
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, []);

  const links = (
    <>
      <a href="/#models" onClick={(e) => { e.preventDefault(); setOpen(false); navigate('/'); setTimeout(() => document.getElementById('models')?.scrollIntoView({ behavior: 'smooth' }), 100); }}>Models</a>
      <a href="/#pricing" onClick={(e) => { e.preventDefault(); setOpen(false); navigate('/'); setTimeout(() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' }), 100); }}>Pricing</a>
      <a href="/docs" onClick={(e) => { e.preventDefault(); go('/docs'); }}>Docs</a>
      {user?.admin && (
        <a href="/status" onClick={(e) => { e.preventDefault(); go('/status'); }}>Status</a>
      )}
    </>
  );

  return (
    <>
      {/* PENTING: drawer & backdrop HARUS di luar <nav> — backdrop-filter nav
          membuat position:fixed di dalamnya terkurung tinggi 56px (bug: drawer
          cuma menampilkan item pertama). */}
      <nav className="nav">
        <div className="shell nav-inner">
          <button className="nav-burger" aria-label="Menu" onClick={() => setOpen(!open)}>
            <span className={`burger-lines ${open ? 'x' : ''}`} />
          </button>

          <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
            <LogoMark size={28} />
            cloviela
          </a>

          <div className="nav-links grow">{links}</div>

          <div className="nav-actions">
            <button className="btn btn-ghost btn-sm mono" onClick={toggle} title="Bahasa / Language">
              {lang === 'id' ? 'EN' : 'ID'}
            </button>
            {user ? (
              <>
                <button className="btn btn-sm btn-dash" onClick={() => go('/dashboard')}>Dashboard</button>
                <button className="btn btn-ghost btn-sm btn-avatar" onClick={onLogout} title={t('nav.logout')}>
                  <Avatar user={user} size={26} />
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm btn-login" onClick={() => go('/login')}>{t('nav.login')}</button>
                <button className="btn btn-primary btn-sm nowrap btn-cta" onClick={ctaGo}>
                  {t('mulai')} {config ? rupiah(config.price_idr) : 'Rp15.000'}/{config?.plan_days || 7} {t('hero.per')} →
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {open && <div className="drawer-back" onClick={() => setOpen(false)} />}
      <aside className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-links">{links}</div>

        <div className="row gap-8 wrap drawer-actions">
          <button className="btn btn-sm mono" onClick={toggle}>{lang === 'id' ? 'EN' : 'ID'}</button>
          {user && <button className="btn btn-sm" onClick={() => go('/dashboard')}>Dashboard</button>}
          {user && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); onLogout?.(); }}>
              {t('nav.logout')}
            </button>
          )}
        </div>

        {/* login langsung di drawer (mobile) — tanpa lewat halaman login */}
        {!user && (
          <div className="mt-16">
            <GoogleButton config={config} onLogin={onLogin} block label={t('checkout.login.google')} />
          </div>
        )}

        {user ? (
          <button className="btn btn-primary btn-block mt-8" onClick={() => go('/dashboard')}>
            {t('nav.enter')} 
          </button>
        ) : (
          <button className="btn btn-primary btn-block mt-8" onClick={ctaGo}>
            {t('mulai')} {config ? rupiah(config.price_idr) : 'Rp15.000'}/{config?.plan_days || 7} {t('hero.per')} →
          </button>
        )}

        {user?.admin && (
          <button className="btn btn-ghost btn-block mt-8" onClick={() => go('/admin')}>
            {t('nav.admin')} →
          </button>
        )}
      </aside>
    </>
  );
}

/* ── Landing ─────────────────────────────────────── */

export function Landing({ user, config, models }) {
  const price = config ? rupiah(config.price_idr) : 'Rp15.000';
  const days = config?.plan_days || 7;

  return (
    <>
      <section className="hero shell">
        <span className="eyebrow">OpenAI-compatible · unlimited request</span>
        <h1 className="mt-16">{t('hero.title')}<br />{t('hero.title2')}</h1>
        <p className="lead">
          {t('hero.lead').split('base_url')[0]}<span className="mono text-green">base_url</span>{t('hero.lead').split('base_url')[1] || ', kode lama langsung jalan.'}
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => navigate(user ? '/dashboard' : '/checkout')}>
            {user ? 'Masuk dashboard →' : `Mulai ${price} / ${days} hari →`}
          </button>
          <button className="btn" onClick={() => navigate('/docs')}>{t('nav.docs')}</button>
        </div>

        <div className="stat-row mt-64">
          <div className="stat">
            <div className="v">{models.length || '—'}</div>
            <div className="k">model tersedia</div>
          </div>
          <div className="stat">
            <div className="v">∞</div>
            <div className="k">request / {days} hari</div>
          </div>
          <div className="stat">
            <div className="v">{price}</div>
            <div className="k">flat, satu paket</div>
          </div>
          <div className="stat">
            <div className="v">OpenAI</div>
            <div className="k">SDK compatible</div>
          </div>
        </div>
      </section>

      {/* quickstart */}
      <section className="shell mt-32">
        <div className="card card-flush">
          <div className="code-head">
            <span className="tiny-mono">quickstart.sh</span>
            <span className="tiny-mono">copy</span>
          </div>
          <pre className="code" style={{ border: 'none', borderRadius: 0, margin: 0 }}>{`curl https://router.cloviela.my.id/v1/chat/completions \\
  -H "Authorization: Bearer $CLOVIELA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${models[0]?.id || 'model-name'}",
    "messages": [{"role": "user", "content": "Halo!"}],
    "stream": true
  }'`}</pre>
        </div>
      </section>

      {/* models */}
      <section className="section shell" id="models">
        <span className="eyebrow">// model tersedia</span>
        <h2 className="mt-8">Pilih model, tetap satu endpoint</h2>
        <p className="lead">
          Model ditambah dari admin panel — daftar di bawah selalu ikut update.
        </p>
        <div className="grid-3 mt-32">
          {models.length === 0 && (
            <div className="card">
              <p className="text-muted small">
                Belum ada model aktif. Admin bisa menambah provider &amp; model dari admin panel.
              </p>
            </div>
          )}
          {models.map((m) => (
            <div className="card" key={m.id}>
              <div className="row between">
                <strong>{m.label}</strong>
                <span className="pill pill-green">unlimited</span>
              </div>
              <p className="mono tiny text-dim mt-8">{m.id}</p>
              {m.description && <p className="small text-muted mt-8">{m.description}</p>}
              {m.context_len && (
                <p className="tiny-mono mt-8">context {m.context_len.toLocaleString('id-ID')}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* why */}
      <section className="section shell">
        <span className="eyebrow">// kenapa cloviela</span>
        <h2 className="mt-8">Dibuat untuk developer yang nggak mau ribet hitung token.</h2>
        <div className="grid-3 mt-32">
          <div className="card">
            <span className="tiny-mono text-green">01 · UNLIMITED</span>
            <h3 className="mt-8" style={{ fontSize: 20 }}>Flat {price}/{days} hari, tanpa hitung token</h3>
            <p className="small text-muted mt-8">
              Tidak ada top-up, tidak ada tagihan membengkak. Fair-use rate limit supaya layanan
              stabil untuk semua.
            </p>
          </div>
          <div className="card">
            <span className="tiny-mono text-blue">02 · COMPATIBLE</span>
            <h3 className="mt-8" style={{ fontSize: 20 }}>Ganti base_url, selesai</h3>
            <p className="small text-muted mt-8">Python, Node, Go, curl. Kode lama langsung jalan.</p>
          </div>
          <div className="card">
            <span className="tiny-mono text-amber">03 · INSTANT</span>
            <h3 className="mt-8" style={{ fontSize: 20 }}>Aktif otomatis setelah bayar</h3>
            <p className="small text-muted mt-8">
              Bayar QRIS, key langsung terbit di dashboard. Semua otomatis di web.
            </p>
          </div>
        </div>
      </section>

      {/* pricing */}
      <section className="section shell" id="pricing">
        <span className="eyebrow">// pricing</span>
        <h2 className="mt-8">{t('pricing.title')}</h2>
        <div className="grid-2 mt-32">
          <div className="card price-card">
            <div className="row between">
              <strong>{t('plan.unlimited')}</strong>
              <span className="pill pill-green">● aktif otomatis</span>
            </div>
            <div className="price-tag mt-16">{price}</div>
            <p className="tiny-mono">per {days} hari · tidak auto-renew</p>
            <ul className="feature-list">
              <li><span className="tick">✓</span> Unlimited request, tanpa hitung token</li>
              <li><span className="tick">✓</span> Semua model yang tersedia</li>
              <li><span className="tick">✓</span> Endpoint kompatibel OpenAI + streaming</li>
              <li><span className="tick">✓</span> 1 API key untuk semua project</li>
              <li><span className="tick">✓</span> {t('checkout.auto')} — {t('checkout.qris')}</li>
            </ul>
            <button className="btn btn-primary btn-block mt-24" onClick={() => navigate(user ? '/dashboard/billing' : '/checkout')}>
              Beli sekarang →
            </button>
          </div>
          <div className="card" id="docs">
            <strong>Mulai pakai</strong>
            <ol className="small text-muted mt-16" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
              <li>Login dengan Google</li>
              <li>Bayar paket — otomatis aktif</li>
              <li>Copy API key dari dashboard</li>
              <li>Ganti <span className="mono text-green">base_url</span> ke router kami</li>
            </ol>
            <pre className="code mt-16" style={{ fontSize: 11.5 }}>{`# Python
from openai import OpenAI
client = OpenAI(
  base_url="${config?.api_base || 'https://router.cloviela.my.id/v1'}",
  api_key="clv_...",
)`}</pre>
            <button className="btn btn-block mt-16" onClick={() => navigate('/docs')}>
              Panduan lengkap →
            </button>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="shell row between wrap gap-16">
          <div className="row gap-8">
            <LogoMark size={22} />
            <strong>cloviela</strong>
          </div>
          <span className="tiny-mono">© {new Date().getFullYear()} router.cloviela.my.id</span>
        </div>
      </footer>
    </>
  );
}

/* ── Login ───────────────────────────────────────── */

export function LoginPage({ config, onLogin, busy, error }) {
  return (
    <div className="shell-narrow" style={{ padding: '80px 24px' }}>
      <div className="card" style={{ maxWidth: 420, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26 }}>{t('auth.title')}</h1>
        <p className="small text-muted mt-8">{t('auth.lead')}</p>
        <div className="mt-24">
          <GoogleButton config={config} onLogin={onLogin} block busy={busy} error={error} />
        </div>
        <p className="tiny text-dim mt-16 center-text">
          Dengan masuk, kamu setuju dengan fair-use policy.
        </p>
      </div>
    </div>
  );
}

/* ── Checkout ────────────────────────────────────── */

export function CheckoutPage({ user, config, onLogin, refresh, busy, error: authError }) {
  const [loading, setLoading] = useState('');
  const [localError, setLocalError] = useState('');
  const [payment, setPayment] = useState(null);
  const [order, setOrder] = useState(null);
  const [methods, setMethods] = useState(null);
  const [coin, setCoin] = useState('');

  const price = config ? rupiah(config.price_idr) : 'Rp15.000';
  const days = config?.plan_days || 7;

  useEffect(() => {
    api.payMethods().then((m) => {
      setMethods(m);
      setCoin(m?.crypto?.coins?.[0]?.code || '');
    }).catch(() => setMethods({ qris: { enabled: true }, crypto: { enabled: false } }));
  }, []);

  const startQris = async () => {
    setLocalError('');
    setLoading('qris');
    try {
      const { payment } = await api.checkout('qris');
      setPayment(payment);
    } catch (e) {
      setLocalError(e.message);
    } finally {
      setLoading('');
    }
  };

  const startCrypto = async () => {
    setLocalError('');
    setLoading('crypto');
    try {
      const { order } = await api.checkoutCrypto(coin);
      setOrder(order);
    } catch (e) {
      setLocalError(e.message);
    } finally {
      setLoading('');
    }
  };

  if (!user) {
    return (
      <div className="shell-narrow" style={{ padding: '64px 24px' }}>
        <div className="card" style={{ maxWidth: 440, margin: '0 auto' }}>
          <h1 style={{ fontSize: 24 }}>{t('checkout.account.title')}</h1>
          <p className="small text-muted mt-8">{t('checkout.account.lead')}</p>
          <div className="mt-24">
            <GoogleButton config={config} onLogin={onLogin} block busy={busy} error={authError}
                          label={t('checkout.login.google')} />
          </div>
        </div>
      </div>
    );
  }

  if (payment) {
    return <PaymentPending payment={payment} refresh={refresh} />;
  }

  if (order) {
    return <CryptoPending order={order} refresh={refresh} config={config} user={user} />;
  }

  const qrisOk = methods?.qris?.enabled;
  const cryptoOk = methods?.crypto?.enabled;
  const coinList = methods?.crypto?.coins || [];

  return (
    <div className="shell" style={{ padding: '40px 24px' }}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div>
          <h1 style={{ fontSize: 28 }}>Pilih metode pembayaran</h1>
          <p className="small text-muted mt-8">
            Semua metode terverifikasi otomatis — API key langsung terbit begitu pembayaran masuk.
          </p>

          {/* QRIS */}
          <button className="card mt-24 pay-opt" style={{ width: '100%', textAlign: 'left', cursor: qrisOk ? 'pointer' : 'not-allowed' }}
                  disabled={!qrisOk || !!loading} onClick={startQris}>
            <div className="row between wrap gap-12">
              <div className="row gap-12">
                <span className="pay-ico">◉</span>
                <div>
                  <strong style={{ fontSize: 15 }}>QRIS</strong>
                  <div className="tiny text-dim">GoPay · OVO · DANA · ShopeePay · m-banking</div>
                </div>
              </div>
              {loading === 'qris'
                ? <span className="spinner" />
                : <span className="pill pill-green">{qrisOk ? 'otomatis' : 'nonaktif'}</span>}
            </div>
          </button>

          {/* Crypto */}
          <div className="card mt-16" style={{ opacity: cryptoOk ? 1 : .5 }}>
            <div className="row between wrap gap-12">
              <div className="row gap-12">
                <span className="pay-ico">◎</span>
                <div>
                  <strong style={{ fontSize: 15 }}>Crypto — Solana</strong>
                  <div className="tiny text-dim">USDC · USDT · SOL · langsung ke wallet</div>
                </div>
              </div>
              <span className={`pill ${cryptoOk ? 'pill-green' : 'pill-amber'}`}>
                {cryptoOk ? 'otomatis' : 'belum aktif'}
              </span>
            </div>

            {cryptoOk && coinList.length > 0 && (
              <>
                <div className="row gap-8 wrap mt-16">
                  {coinList.map((c) => (
                    <button key={c.code}
                            className={`btn btn-sm ${coin === c.code ? 'btn-primary' : ''}`}
                            disabled={!!loading}
                            onClick={() => setCoin(c.code)}>
                      {c.symbol}
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary btn-block mt-16" onClick={startCrypto}
                        disabled={!!loading || !coin}>
                  {loading === 'crypto'
                    ? <><span className="spinner" style={{ borderTopColor: '#04140c' }} /> Membuat QR…</>
                    : `Bayar dengan ${coinList.find((c) => c.code === coin)?.symbol || 'crypto'} →`}
                </button>
                <p className="tiny text-dim mt-8">
                  Kurs dikunci saat QR dibuat. Scan pakai Phantom, Solflare, atau Backpack.
                </p>
              </>
            )}
          </div>

          {localError && <div className="alert alert-red mt-16">{localError}</div>}

          <div className="alert mt-16 tiny text-muted">
            QR & alamat berlaku terbatas. Kalau kedaluwarsa, klik lagi — tidak ada biaya tambahan.
          </div>
        </div>

        <div className="card">
          <p className="tiny-mono">// ringkasan pesanan</p>
          <h3 className="mt-16" style={{ fontSize: 18 }}>Paket Unlimited</h3>
          <ul className="feature-list" style={{ marginTop: 12 }}>
            <li><span className="tick">✓</span> Unlimited request, tanpa hitung token</li>
            <li><span className="tick">✓</span> Semua model yang tersedia</li>
            <li><span className="tick">✓</span> Endpoint kompatibel OpenAI, streaming</li>
            <li><span className="tick">✓</span> 1 API key untuk semua project</li>
          </ul>

          <div className="row between mt-24 small">
            <span className="text-muted">Subtotal</span>
            <span className="mono">{price}</span>
          </div>
          <div className="row between mt-8 small">
            <span className="text-muted">Masa aktif</span>
            <span className="mono">{days} hari</span>
          </div>
          <div className="row between mt-16" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 16 }}>
            <strong>Total</strong>
            <span className="mono text-green" style={{ fontSize: 26 }}>{price}</span>
          </div>

          <p className="tiny text-dim mt-16">
            Tidak auto-renew. Kamu dapat pengingat H-1 sebelum masa aktif habis.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Crypto pending ──────────────────────────────── */

function CryptoPending({ order, refresh, config, user }) {
  const [status, setStatus] = useState(order.status);
  const [copied, setCopied] = useState('');
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(order.expires_at) - Date.now()) / 1000)));

  // countdown
  useEffect(() => {
    const t = setInterval(() => {
      setLeft(Math.max(0, Math.floor((new Date(order.expires_at) - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [order.expires_at]);

  // polling status — server yang cek ke blockchain
  useEffect(() => {
    if (status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const { order: o } = await api.cryptoOrder(order.reference);
        if (o.status !== 'pending') setStatus(o.status);
      } catch { /* diamkan */ }
    }, 7000);
    return () => clearInterval(t);
  }, [status, order.reference]);

  useEffect(() => {
    if (status !== 'paid') return;
    refresh?.();
    const t = setTimeout(() => navigate('/dashboard?paid=1'), 1200);
    return () => clearTimeout(t);
  }, [status, refresh]);

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  if (status === 'paid') {
    return (
      <div className="shell-narrow" style={{ padding: '80px 24px' }}>
        <div className="card center-text" style={{ maxWidth: 440, margin: '0 auto' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <h1 className="mt-16" style={{ fontSize: 24 }}>Pembayaran terkonfirmasi</h1>
          <p className="small text-muted mt-8">Langganan aktif. Mengalihkan ke dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell-narrow" style={{ padding: '48px 24px' }}>
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="row between wrap gap-8">
          <h1 style={{ fontSize: 22 }}>Bayar {order.symbol}</h1>
          <span className="pill pill-amber">⏳ {mm}:{ss}</span>
        </div>
        <p className="small text-muted mt-8">
          Scan QR pakai Phantom, Solflare, atau Backpack. Status ter-update otomatis —
          halaman ini bisa ditinggal, key tetap terbit saat pembayaran masuk.
        </p>

        <div className="mt-24">
          <div className="qr-box">
            <img src={`/api/crypto/${encodeURIComponent(order.reference)}/qr`} alt={`QR ${order.symbol}`} />
          </div>

          <div className="key-reveal mt-16">
            <div className="row between">
              <p className="tiny-mono">Jumlah tepat</p>
              <button className="btn btn-sm" onClick={() => copy(String(order.amount), 'amt')}>
                {copied === 'amt' ? '✓' : 'copy'}
              </button>
            </div>
            <div className="key-value mono">{order.amount} {order.symbol}</div>
            <p className="tiny text-dim mt-8">
              Kirim <strong>jumlah tepat</strong> — kalau kurang, pembayaran tidak terdeteksi otomatis.
            </p>
          </div>

          <div className="mt-16">
            <p className="tiny-mono">Alamat tujuan</p>
            <div className="key-value row between gap-12">
              <span style={{ fontSize: 11.5 }}>{order.address}</span>
              <button className="btn btn-sm" onClick={() => copy(order.address, 'addr')}>
                {copied === 'addr' ? '✓' : 'copy'}
              </button>
            </div>
          </div>

          <a className="btn btn-block mt-16" href={order.uri}>
            Buka di wallet →
          </a>

          <div className="row between mt-24 small">
            <span className="text-muted">Total</span>
            <span className="mono text-green">{rupiah(order.amount_idr)}</span>
          </div>
          <div className="row between mt-8 small">
            <span className="text-muted">Ref</span>
            <span className="mono tiny">{order.reference.slice(0, 20)}…</span>
          </div>
        </div>

        <button className="btn btn-ghost btn-block mt-24" onClick={() => navigate('/dashboard')}>
          Bayar nanti, buka dashboard
        </button>
      </div>
    </div>
  );
}

/* ── Payment pending / QR ────────────────────────── */

function PaymentPending({ payment, refresh }) {
  const [status, setStatus] = useState(payment.status);
  const [copied, setCopied] = useState('');

  // Cek status pembayaran lewat API server (data di SQLite sendiri).
  // Dulu ada listener Firestore untuk update instan; sekarang polling ini
  // satu-satunya jalur — 5 detik cukup cepat, dan tidak membakar kuota.
  useEffect(() => {
    if (status !== 'pending') return;
    const tick = async () => {
      try {
        const { payment: p } = await api.payment(payment.reference_id);
        if (p.status !== 'pending') setStatus(p.status);
      } catch { /* diamkan: coba lagi tick berikutnya */ }
    };
    const t = setInterval(tick, 5000);
    tick();
    return () => clearInterval(t);
  }, [status, payment.reference_id]);

  // begitu lunas → refresh profil & masuk dashboard
  useEffect(() => {
    if (status !== 'paid') return;
    refresh?.();
    const t = setTimeout(() => navigate('/dashboard?paid=1'), 900);
    return () => clearTimeout(t);
  }, [status, refresh]);

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  if (status === 'paid') {
    return (
      <div className="shell-narrow" style={{ padding: '80px 24px' }}>
        <div className="card center-text" style={{ maxWidth: 440, margin: '0 auto' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <h1 className="mt-16" style={{ fontSize: 24 }}>Pembayaran berhasil</h1>
          <p className="small text-muted mt-8">Langganan aktif. Mengalihkan ke dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell-narrow" style={{ padding: '48px 24px' }}>
      <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="row between">
          <h1 style={{ fontSize: 22 }}>Selesaikan pembayaran</h1>
          <span className="pill pill-amber">⏳ menunggu</span>
        </div>
        <p className="small text-muted mt-8">
          Status ter-update otomatis. Halaman ini bisa ditinggal — key tetap terbit saat pembayaran masuk.
        </p>

        <div className="mt-24">
          {payment.qr_url && (
            <>
              <div className="qr-box">
                <img src={payment.qr_url} alt="QRIS" />
              </div>
              <p className="small center-text text-muted mt-12">
                Scan dari GoPay, OVO, DANA, atau m-banking.
              </p>
            </>
          )}

          {payment.va_number && (
            <div className="key-reveal">
              <p className="tiny-mono">Nomor Virtual Account</p>
              <div className="key-value row between gap-12">
                <span>{payment.va_number}</span>
                <button className="btn btn-sm" onClick={() => copy(payment.va_number, 'va')}>
                  {copied === 'va' ? '✓' : 'copy'}
                </button>
              </div>
            </div>
          )}

          {payment.pay_url && (
            <a className="btn btn-primary btn-block mt-16" href={payment.pay_url} target="_blank" rel="noreferrer">
              Buka halaman pembayaran →
            </a>
          )}

          <div className="row between mt-24 small">
            <span className="text-muted">Total</span>
            <span className="mono text-green">{rupiah(payment.amount)}</span>
          </div>
          <div className="row between mt-8 small">
            <span className="text-muted">Ref</span>
            <span className="mono tiny">{payment.reference_id}</span>
          </div>
        </div>

        <button className="btn btn-ghost btn-block mt-24" onClick={() => navigate('/dashboard')}>
          Bayar nanti, buka dashboard
        </button>
      </div>
    </div>
  );
}
