import { useEffect, useState } from 'react';
import { api, rupiah, shortDate, relative } from '../api';
import { navigate } from '../hooks';
import { t } from '../lang';
import { Avatar } from './Auth';

const NAV = [
  { group: 'nav.account', items: [
    { path: '/dashboard', label: 'nav.overview', icon: '▤' },
    { path: '/dashboard/models', label: 'nav.model', icon: '◆' },
    { path: '/dashboard/keys', label: 'nav.keys', icon: '🔑' },
    { path: '/dashboard/logs', label: 'nav.log', icon: '≡' },
    { path: '/dashboard/usage', label: 'nav.usage', icon: '▦' },
    { path: '/dashboard/billing', label: 'nav.billing', icon: '🧾' },
  ]},
  { group: 'nav.help', items: [
    { path: '/docs', label: 'nav.docs', icon: '📖' },
    { path: '/status', label: 'nav.status', icon: '◉' },
  ]},
];

export function DashboardShell({ user, onLogout, children, active }) {
  return (
    <div className="dash">
      <aside className="side">
        <a className="brand mb-16" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          <span className="brand-mark">C</span> cloviela
        </a>
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <div className="side-label">{t(group)}</div>
            {items.map((it) => (
              <a
                key={it.path}
                className={`side-item ${active === it.path ? 'active' : ''}`}
                href={it.path}
                onClick={(e) => { e.preventDefault(); navigate(it.path); }}
              >
                <span style={{ width: 16, opacity: .7 }}>{it.icon}</span>
                {it.label}
              </a>
            ))}
          </div>
        ))}
        {user?.admin && (
          <>
            <div className="side-label">Admin</div>
            <a className="side-item" href="/admin"
               onClick={(e) => { e.preventDefault(); navigate('/admin'); }}>
              <span style={{ width: 16, opacity: .7 }}>⚙</span> Admin Panel
            </a>
          </>
        )}
        <div className="grow" />
        <div className="row gap-12 card card-tight" style={{ padding: 12 }}>
          <Avatar user={user} size={30} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || user?.email}
            </div>
            <div className="tiny text-dim">{user?.email}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout} title="Keluar">⎋</button>
        </div>
      </aside>
      <main className="main">
        {/* profil ringkas — tampil hanya di mobile (bottom nav menggantikan sidebar) */}
        <div className="mobile-user">
          <Avatar user={user} size={30} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || user?.email}
            </div>
            <div className="tiny text-dim">{user?.email}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout} title="Keluar">⎋</button>
        </div>
        {children}
      </main>
    </div>
  );
}

/* ── Overview ────────────────────────────────────── */

export function Overview({ user, refresh, config }) {
  const [usage, setUsage] = useState(null);
  const [copied, setCopied] = useState('');
  const base = config?.api_base || `${window.location.origin}/v1`;

  const copy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 1500);
  };
  const [usageErr, setUsageErr] = useState('');
  const sub = user?.subscription;

  useEffect(() => {
    api.usage()
      .then(setUsage)
      .catch((e) => { setUsageErr(e.message || 'gagal memuat'); setUsage({}); });
  }, []);

  const daysLeft = sub?.days_left ?? 0;
  const expiring = sub && daysLeft <= 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.overview')}</h1>
          <p className="small text-muted mt-4">Halo, {user?.name?.split(' ')[0] || 'developer'} 👋</p>
        </div>
        <span className={`pill ${sub ? (expiring ? 'pill-amber' : 'pill-green') : 'pill-red'}`}>
          {sub ? (expiring ? `⏳ ${daysLeft} hari lagi` : `● aktif · ${daysLeft} hari lagi`) : '● belum aktif'}
        </span>
      </div>

      {usageErr && <div className="alert alert-red mb-16">Gagal memuat usage: {usageErr}</div>}

      {!sub && (
        <div className="alert alert-amber mb-24">
          Langganan belum aktif. <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}
            onClick={() => navigate('/checkout')}>Beli paket →</button>
        </div>
      )}
      {expiring && (
        <div className="alert alert-amber mb-24">
          Masa aktif tinggal {daysLeft} hari ({shortDate(sub.expires_at)}).{' '}
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}
            onClick={() => navigate('/checkout')}>Perpanjang {rupiah(15000)} →</button>
        </div>
      )}

      <div className="kpi-grid mb-24">
        <Kpi label={t('usage.today')} value={usage?.totals?.today ?? '—'} />
        <Kpi label={t('usage.total')} value={usage?.totals?.total ?? '—'} />
        <Kpi label={t('usage.avg')} value={usage?.totals?.avg_ms ? `${usage.totals.avg_ms} ms` : '—'} />
        <Kpi label="MASA AKTIF" value={sub ? `${daysLeft} hari` : '—'}
             tone={expiring ? 'amber' : sub ? 'green' : undefined} />
      </div>

      {/* aksi cepat */}
      <div className="grid-3 mb-16">
        <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate('/dashboard/models')}>
          <strong style={{ fontSize: 14 }}>Coba model →</strong>
          <p className="tiny text-muted mt-8">
            Kirim prompt langsung dari dashboard, lihat hasil & latensinya.
          </p>
        </button>
        <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate('/dashboard/logs')}>
          <strong style={{ fontSize: 14 }}>Lihat log →</strong>
          <p className="tiny text-muted mt-8">
            Riwayat tiap request: model, latensi, token, status.
          </p>
        </button>
        <button className="card" style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate('/docs')}>
          <strong style={{ fontSize: 14 }}>Dokumentasi →</strong>
          <p className="tiny text-muted mt-8">
            Contoh kode Python, Node, curl, dan cara menangani error.
          </p>
        </button>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="row between mb-16">
            <strong>Request 30 hari</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard/usage')}>detail →</button>
          </div>
          <MiniChart data={usage?.daily || []} />
        </div>

        <div className="card">
          <div className="row between mb-16">
            <strong>Cara pakai</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/docs')}>dokumentasi →</button>
          </div>

          <p className="tiny-mono">BASE URL</p>
          <div className="key-value row between gap-12" style={{ marginTop: 8 }}>
            <span className="tiny">{base}</span>
            <button className="btn btn-sm" onClick={() => copy(base, 'base')}>
              {copied === 'base' ? '✓' : 'copy'}
            </button>
          </div>

          <p className="tiny-mono mt-16">API KEY</p>
          {user?.api_key ? (
            <>
              <div className="key-value row between gap-12" style={{ marginTop: 8 }}>
                <span className="tiny">{user.api_key.prefix}••••••••••</span>
                <button className="btn btn-sm" onClick={() => navigate('/dashboard/keys')}>kelola</button>
              </div>
              <p className="tiny text-dim mt-8">
                Terakhir dipakai: {user.api_key.last_used_at ? relative(user.api_key.last_used_at) : 'belum pernah'}
              </p>
            </>
          ) : (
            <p className="small text-muted mt-8">
              Belum ada key aktif. Key terbit otomatis setelah pembayaran.
            </p>
          )}
        </div>
      </div>

      {/* contoh pakai singkat */}
      <div className="card mt-16">
        <div className="row between mb-16 wrap gap-12">
          <div>
            <strong>Mulai pakai dalam 2 langkah</strong>
            <p className="tiny text-muted mt-4">
              Cukup ganti <span className="mono">base_url</span> — kode OpenAI-mu langsung jalan.
            </p>
          </div>
          <button className="btn btn-sm" onClick={() => navigate('/docs')}>panduan lengkap →</button>
        </div>

        <div className="grid-2">
          <div>
            <p className="tiny-mono mb-8">1 · PYTHON</p>
            <pre className="code" style={{ fontSize: 11.5, margin: 0 }}>{`from openai import OpenAI

client = OpenAI(
  base_url="${base}",
  api_key="${user?.api_key?.prefix || 'clv_...'}...",
)

resp = client.chat.completions.create(
  model="${'model-anda'}",
  messages=[{"role":"user","content":"Halo"}],
)
print(resp.choices[0].message.content)`}</pre>
          </div>
          <div>
            <p className="tiny-mono mb-8">2 · CURL</p>
            <pre className="code" style={{ fontSize: 11.5, margin: 0 }}>{`curl ${base}/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "model-anda",
    "messages": [
      {"role":"user","content":"Halo"}
    ]
  }'`}</pre>
          </div>
        </div>
      </div>

      <div className="card mt-16">
        <strong>Request terakhir</strong>
        <div className="mt-16" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr><th>Waktu</th><th>Request ID</th><th>Model</th><th>Latensi</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(usage?.recent || []).slice(0, 8).map((r) => (
                <tr key={r.request_id}>
                  <td className="mono tiny" data-label="Waktu">{new Date(r.created_at + 'Z').toLocaleTimeString('id-ID')}</td>
                  <td className="mono tiny" data-label="Request ID">{r.request_id?.slice(0, 16)}…</td>
                  <td className="mono tiny" data-label="Model">{r.model}</td>
                  <td className="mono tiny" data-label="Latensi">{r.latency_ms ? `${r.latency_ms} ms` : '—'}</td>
                  <td className={`mono tiny ${r.status_code >= 400 ? 'text-red' : 'text-green'}`} data-label="Status">{r.status_code}</td>
                </tr>
              ))}
              {!usage?.recent?.length && (
                <tr><td colSpan={5} className="text-dim small">Belum ada request.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div className="card card-tight">
      <div className="tiny-mono">{label}</div>
      <div className={`mono mt-8 ${tone === 'green' ? 'text-green' : tone === 'amber' ? 'text-amber' : ''}`}
           style={{ fontSize: 24 }}>{value}</div>
    </div>
  );
}

function MiniChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.requests));
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10);
    const hit = data.find((x) => x.day === d);
    return { day: d, requests: hit?.requests || 0 };
  });
  return (
    <div className="bar-chart">
      {days.map((d) => (
        <div key={d.day} className="bar" title={`${d.day}: ${d.requests} request`}
             style={{ height: `${Math.max(3, (d.requests / max) * 100)}%` }} />
      ))}
    </div>
  );
}

/* ── API Keys ────────────────────────────────────── */

export function Keys({ user, refresh, config }) {
  const base = config?.api_base || `${window.location.origin}/v1`;
  const [revealed, setRevealed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const sub = user?.subscription;

  useEffect(() => { setLoaded(true); }, []);

  const rotate = async () => {
    if (!confirm('Buat key baru? Key lama langsung tidak berlaku.')) return;
    setBusy(true); setError('');
    try {
      const { key } = await api.rotateKey();
      setRevealed(key.raw);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!confirm('Revoke key aktif? Request dengan key ini akan ditolak.')) return;
    setBusy(true); setError('');
    try {
      await api.revokeKey(user.api_key.id);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><h1>API Keys</h1></div>

      {!sub && (
        <div className="alert alert-amber mb-24">
          Key hanya bisa diterbitkan saat langganan aktif.{' '}
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/checkout')}>Beli paket →</button>
        </div>
      )}

      {revealed && (
        <div className="key-reveal mb-24">
          <strong className="text-green">✓ Key baru dibuat — simpan sekarang</strong>
          <p className="small mt-8" style={{ color: 'var(--text-2)' }}>
            Key mentah hanya ditampilkan sekali. Setelah halaman ditutup, yang tersisa hanya prefix.
          </p>
          <div className="key-value row between gap-12">
            <span>{revealed}</span>
            <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(revealed)}>copy</button>
          </div>
          <button className="btn btn-ghost btn-sm mt-8" onClick={() => setRevealed(null)}>sudah kusimpan</button>
        </div>
      )}

      <div className="card">
        <div className="row between mb-16">
          <strong>Key aktif</strong>
          <span className={`pill ${sub ? 'pill-green' : 'pill-red'}`}>{sub ? 'aktif' : 'tidak ada'}</span>
        </div>

        {user?.api_key ? (
          <>
            <div className="key-value" style={{ margin: 0 }}>{user.api_key.prefix}••••••••••••••••••••••••</div>
            <p className="tiny text-dim mt-8">
              Terakhir dipakai: {user.api_key.last_used_at ? relative(user.api_key.last_used_at) : 'belum pernah'}
            </p>
            <div className="row gap-8 mt-16 wrap">
              <button className="btn btn-sm" onClick={rotate} disabled={busy || !sub}>↻ Regenerate key</button>
              <button className="btn btn-danger btn-sm" onClick={revoke} disabled={busy}>Revoke</button>
            </div>
          </>
        ) : (
          <button className="btn btn-primary" onClick={rotate} disabled={busy || !sub}>
            {busy ? 'Membuat…' : 'Terbitkan key →'}
          </button>
        )}

        {error && <div className="alert alert-red mt-16">{error}</div>}
      </div>

      <div className="card mt-16">
        <div className="row between mb-16 wrap gap-12">
          <strong>Contoh pakai</strong>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/docs')}>dokumentasi →</button>
        </div>
        <p className="tiny-mono">BASE URL</p>
        <div className="key-value" style={{ marginTop: 8 }}>{base}</div>
        <pre className="code mt-16">{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${user?.api_key?.prefix || 'clv_...'}..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"<model-id>","messages":[{"role":"user","content":"Halo"}]}'`}</pre>
      </div>

      <div className="card mt-16">
        <strong>Batas pemakaian</strong>
        <p className="tiny text-muted mt-8">
          Berlaku otomatis untuk semua request lewat API key-mu. Kalau terlampaui, server
          membalas <span className="mono">HTTP 429</span> dengan header <span className="mono">Retry-After</span>.
        </p>
        <table className="table mt-16">
          <thead><tr><th>Batas</th><th style={{ textAlign: 'right' }}>Nilai</th></tr></thead>
          <tbody>
            <tr>
              <td className="small" data-label="Batas">Request per menit</td>
              <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Nilai">
                {config?.limits?.user_rpm || 30} RPM
              </td>
            </tr>
            <tr>
              <td className="small" data-label="Batas">Request bersamaan</td>
              <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Nilai">
                {config?.limits?.user_concurrent || 3} concurrent
              </td>
            </tr>
          </tbody>
        </table>
        <p className="tiny text-dim mt-8">
          Kalau butuh lebih tinggi untuk otomasi/agent, hubungi admin.
        </p>
      </div>

      <p className="tiny text-dim mt-16">
        Satu user = satu key aktif. Regenerate membuat key baru dan me-revoke yang lama tanpa mengubah
        langganan.
      </p>
    </>
  );
}

/* ── Usage ───────────────────────────────────────── */

export function Usage() {
  const [usage, setUsage] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.usage()
      .then(setUsage)
      .catch((e) => { setErr(e.message || 'gagal memuat'); setUsage({}); });
  }, []);

  const max = Math.max(1, ...(usage?.daily || []).map((d) => d.requests));

  return (
    <>
      <div className="page-head"><h1>Usage</h1></div>

      {err && <div className="alert alert-red mb-16">Gagal memuat usage: {err}</div>}

      <div className="kpi-grid mb-24">
        <Kpi label="HARI INI" value={usage?.totals?.today ?? '—'} />
        <Kpi label="30 HARI" value={(usage?.daily || []).reduce((a, b) => a + b.requests, 0)} />
        <Kpi label="TOTAL" value={usage?.totals?.total ?? '—'} />
        <Kpi label="AVG LATENSI" value={usage?.totals?.avg_ms ? `${usage.totals.avg_ms} ms` : '—'} />
      </div>

      <div className="card mb-16">
        <strong>Request harian</strong>
        <div className="mt-24">
          <div className="bar-chart" style={{ height: 140 }}>
            {(usage?.daily || []).map((d) => (
              <div key={d.day} className="bar" title={`${d.day}: ${d.requests} req · avg ${d.avg_ms}ms`}
                   style={{ height: `${Math.max(3, (d.requests / max) * 100)}%` }} />
            ))}
          </div>
          <div className="row between tiny-mono mt-8">
            <span>30 hari lalu</span><span>hari ini</span>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <strong>Per model</strong>
          <table className="table mt-16">
            <thead><tr><th>Model</th><th style={{ textAlign: 'right' }}>Request</th></tr></thead>
            <tbody>
              {(usage?.byModel || []).map((m) => (
                <tr key={m.model}>
                  <td className="mono tiny" data-label="Model">{m.model}</td>
                  <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Request">{m.requests}</td>
                </tr>
              ))}
              {!usage?.byModel?.length && <tr><td colSpan={2} className="text-dim small">Belum ada data.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <strong>Request terakhir</strong>
          <div style={{ overflowX: 'auto' }}>
            <table className="table mt-16">
              <thead><tr><th>Waktu</th><th>Model</th><th>Status</th></tr></thead>
              <tbody>
                {(usage?.recent || []).slice(0, 10).map((r) => (
                  <tr key={r.request_id}>
                    <td className="mono tiny" data-label="Waktu">{new Date(r.created_at + 'Z').toLocaleTimeString('id-ID')}</td>
                    <td className="mono tiny" data-label="Model">{r.model}</td>
                    <td className={`mono tiny ${r.status_code >= 400 ? 'text-red' : 'text-green'}`} data-label="Status">
                      {r.status_code} · {r.latency_ms}ms
                    </td>
                  </tr>
                ))}
                {!usage?.recent?.length && <tr><td colSpan={3} className="text-dim small">Belum ada request.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Billing ─────────────────────────────────────── */

export function Billing({ user, refresh }) {
  const [payments, setPayments] = useState(null);
  const sub = user?.subscription;

  const [payErr, setPayErr] = useState('');

  useEffect(() => {
    api.payments()
      .then((r) => setPayments(r.payments))
      .catch((e) => { setPayErr(e.message || 'gagal memuat'); setPayments([]); });
    const params = new URLSearchParams(window.location.search);
    if (params.get('ref')) refresh?.();
  }, [refresh]);

  return (
    <>
      <div className="page-head">
        <h1>Pembayaran</h1>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/checkout')}>
          {sub ? 'Perpanjang →' : 'Beli paket →'}
        </button>
      </div>

      {payErr && <div className="alert alert-red mb-16">Gagal memuat riwayat: {payErr}</div>}

      {sub && (
        <div className="card mb-24">
          <div className="row between wrap gap-16">
            <div>
              <p className="tiny-mono">PAKET AKTIF</p>
              <strong style={{ fontSize: 18 }}>Unlimited · {sub.days} hari</strong>
              <p className="small text-muted mt-4">
                Aktif sampai {shortDate(sub.expires_at)} · {sub.days_left} hari lagi
              </p>
            </div>
            <span className="pill pill-green">● aktif</span>
          </div>
        </div>
      )}

      <div className="card card-flush">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-soft)' }}>
          <strong>Riwayat pembayaran</strong>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr><th>Tanggal</th><th>Ref</th><th>Metode</th><th>Nominal</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(payments || []).map((p) => (
                <tr key={p.id}>
                  <td className="tiny" data-label="Tanggal">{shortDate(p.created_at)}</td>
                  <td className="mono tiny" data-label="Ref">{p.reference_id}</td>
                  <td className="mono tiny" data-label="Metode">{p.channel}</td>
                  <td className="mono tiny" data-label="Nominal">{rupiah(p.amount)}</td>
                  <td data-label="Status">
                    <span className={`pill ${p.status === 'paid' ? 'pill-green' : p.status === 'pending' ? 'pill-amber' : 'pill-red'}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
              {payments && !payments.length && (
                <tr><td colSpan={5} className="text-dim small" style={{ padding: 20 }}>
                  Belum ada pembayaran.
                </td></tr>
              )}
              {!payments && <tr><td colSpan={5} style={{ padding: 20 }}><div className="skeleton" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <p className="tiny text-dim mt-16">
        Tidak auto-renew. Pembayaran otomatis lewat QRIS (Paymenku).
      </p>
    </>
  );
}
