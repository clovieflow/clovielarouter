import { useEffect, useState } from 'react';
import { api, rupiah } from '../api';
import { navigate } from '../hooks';
import { watchPayment } from '../firebase';
import { GoogleButton, Avatar } from './Auth';

/* ── Nav ─────────────────────────────────────────── */

export function Nav({ user, onLogout, config, onLogin }) {
  return (
    <nav className="nav">
      <div className="shell nav-inner">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          <span className="brand-mark">C</span>
          cloviela
        </a>
        <div className="nav-links grow">
          <a href="/#models" onClick={(e) => { e.preventDefault(); navigate('/'); setTimeout(() => document.getElementById('models')?.scrollIntoView({ behavior: 'smooth' }), 100); }}>Models</a>
          <a href="/#pricing" onClick={(e) => { e.preventDefault(); navigate('/'); setTimeout(() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' }), 100); }}>Pricing</a>
          <a href="/docs" onClick={(e) => { e.preventDefault(); navigate('/docs'); }}>Docs</a>
          <a href="/status" onClick={(e) => { e.preventDefault(); navigate('/status'); }}>Status</a>
        </div>
        {user ? (
          <div className="row gap-12">
            <button className="btn btn-sm" onClick={() => navigate('/dashboard')}>Dashboard</button>
            <button className="btn btn-ghost btn-sm" onClick={onLogout} title="Keluar">
              <Avatar user={user} size={26} />
            </button>
          </div>
        ) : (
          <div className="row gap-12">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/login')}>Masuk</button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/checkout')}>
              Mulai {config ? rupiah(config.price_idr) : 'Rp15.000'}/{config?.plan_days || 7} hari →
            </button>
          </div>
        )}
      </div>
    </nav>
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
        <h1 className="mt-16">Satu API key.<br />Unlimited request ke model AI.</h1>
        <p className="lead">
          Router AI kompatibel OpenAI. Ganti <span className="mono text-green">base_url</span>, kode lama
          langsung jalan — tanpa kuota token, tanpa tagihan kejutan.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => navigate('/checkout')}>
            Mulai {price} / {days} hari →
          </button>
          <button className="btn" onClick={() => navigate('/docs')}>Baca dokumentasi</button>
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
          <div className="row between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-soft)' }}>
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
        <h2 className="mt-8">Satu paket. Semua model.</h2>
        <div className="grid-2 mt-32">
          <div className="card price-card">
            <div className="row between">
              <strong>Paket Unlimited</strong>
              <span className="pill pill-green">● aktif otomatis</span>
            </div>
            <div className="price-tag mt-16">{price}</div>
            <p className="tiny-mono">per {days} hari · tidak auto-renew</p>
            <ul className="feature-list">
              <li><span className="tick">✓</span> Unlimited request, tanpa hitung token</li>
              <li><span className="tick">✓</span> Semua model yang tersedia</li>
              <li><span className="tick">✓</span> Endpoint kompatibel OpenAI + streaming</li>
              <li><span className="tick">✓</span> 1 API key untuk semua project</li>
              <li><span className="tick">✓</span> Bayar QRIS — otomatis, tanpa konfirmasi manual</li>
            </ul>
            <button className="btn btn-primary btn-block mt-24" onClick={() => navigate('/checkout')}>
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
            <span className="brand-mark" style={{ width: 22, height: 22, fontSize: 12 }}>C</span>
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
        <h1 style={{ fontSize: 26 }}>Masuk ke cloviela</h1>
        <p className="small text-muted mt-8">
          Cukup pakai akun Google — tidak perlu password, tidak perlu verifikasi tambahan.
        </p>
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
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [payment, setPayment] = useState(null);

  const price = config ? rupiah(config.price_idr) : 'Rp15.000';
  const days = config?.plan_days || 7;

  const start = async () => {
    setLocalError('');
    setLoading(true);
    try {
      const { payment } = await api.checkout('qris');
      setPayment(payment);
    } catch (e) {
      setLocalError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="shell-narrow" style={{ padding: '64px 24px' }}>
        <div className="card" style={{ maxWidth: 440, margin: '0 auto' }}>
          <h1 style={{ fontSize: 24 }}>Buat akun &amp; beli paket</h1>
          <p className="small text-muted mt-8">
            Login dengan Google dulu — satu langkah, langsung lanjut ke pembayaran.
          </p>
          <div className="mt-24">
            <GoogleButton config={config} onLogin={onLogin} block busy={busy} error={authError}
                          label="Login dengan Google" />
          </div>
        </div>
      </div>
    );
  }

  if (payment) {
    return <PaymentPending payment={payment} refresh={refresh} config={config} user={user} />;
  }

  return (
    <div className="shell" style={{ padding: '40px 24px' }}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div>
          <h1 style={{ fontSize: 28 }}>Bayar dengan QRIS</h1>
          <p className="small text-muted mt-8">
            Scan QR pakai aplikasi apa pun — GoPay, OVO, DANA, ShopeePay, atau m-banking.
            Pembayaran terverifikasi otomatis, key langsung terbit.
          </p>

          <div className="card mt-24" style={{ borderColor: 'var(--green)' }}>
            <div className="row between">
              <div className="row gap-12">
                <span style={{ fontSize: 22 }}>◉</span>
                <div>
                  <strong style={{ fontSize: 15 }}>QRIS</strong>
                  <div className="tiny text-dim">Semua aplikasi pembayaran · konfirmasi instan</div>
                </div>
              </div>
              <span className="pill pill-green">otomatis</span>
            </div>
          </div>

          <div className="alert mt-16 tiny text-muted">
            QR berlaku terbatas. Kalau kedaluwarsa, tinggal klik beli lagi — tidak ada biaya tambahan.
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

          {localError && <div className="alert alert-red mt-16">{localError}</div>}

          <button className="btn btn-primary btn-block mt-16" onClick={start} disabled={loading}>
            {loading ? <span className="spinner" style={{ borderTopColor: '#04140c' }} /> : null}
            {loading ? 'Membuat QR…' : 'Tampilkan QRIS →'}
          </button>
          <p className="tiny text-dim mt-8 center-text">
            Tidak auto-renew. Kamu dapat pengingat H-1 sebelum masa aktif habis.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Payment pending / QR ────────────────────────── */

function PaymentPending({ payment, refresh, config, user }) {
  const [status, setStatus] = useState(payment.status);
  const [copied, setCopied] = useState('');

  // 1) realtime dari Firestore (instan begitu webhook masuk)
  useEffect(() => {
    if (!config || !user?.id || !payment.id) return;
    let unsub = () => {};
    let alive = true;
    watchPayment(config, user.id, payment.id, (doc) => {
      if (!alive || !doc) return;
      if (doc.status && doc.status !== 'pending') setStatus(doc.status);
    }).then((u) => { if (alive) unsub = u; else u?.(); });
    return () => { alive = false; unsub?.(); };
  }, [config, user?.id, payment.id]);

  // 2) fallback polling server (kalau Firestore diblokir/offline)
  useEffect(() => {
    if (status !== 'pending') return;
    const t = setInterval(async () => {
      try {
        const { payment: p } = await api.payment(payment.reference_id);
        if (p.status !== 'pending') setStatus(p.status);
      } catch { /* diamkan */ }
    }, 6000);
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
