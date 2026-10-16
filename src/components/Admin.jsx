import { useEffect, useState } from 'react';
import { api, rupiah, shortDate, relative } from '../api';
import { navigate } from '../hooks';

/** Tutup modal dengan Esc (dipakai dialog admin). */
function useEscape(active, onClose) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onClose]);
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'payments', label: 'Pembayaran' },
  { id: 'providers', label: 'Provider & Model' },
  { id: 'crypto', label: 'Crypto' },
];

export function Admin({ user }) {
  const [tab, setTab] = useState('overview');

  if (!user?.admin) {
    return (
      <div className="shell-narrow" style={{ padding: '80px 24px' }}>
        <div className="alert alert-red">Halaman ini khusus admin.</div>
      </div>
    );
  }

  return (
    <div className="shell" style={{ padding: '32px 24px 64px' }}>
      <div className="row between wrap gap-16 mb-24">
        <div>
          <h1 style={{ fontSize: 24 }}>cloviela admin</h1>
          <p className="small text-muted mt-4">Monitoring & konfigurasi. Notifikasi Telegram {`aktif untuk pembayaran`}.</p>
        </div>
        <button className="btn btn-sm" onClick={() => navigate('/dashboard')}>← dashboard user</button>
      </div>

      <div className="row gap-8 wrap mb-24">
        {TABS.map((t) => (
          <button key={t.id}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : ''}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <AdminOverview />}
      {tab === 'users' && <AdminUsers />}
      {tab === 'payments' && <AdminPayments />}
      {tab === 'providers' && <AdminProviders />}
      {tab === 'crypto' && <AdminCrypto />}
    </div>
  );
}

/* ── overview ────────────────────────────────────── */

function AdminOverview() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.admin.stats()
      .then(setS)
      .catch((e) => setErr(e.message || 'Gagal memuat statistik.'));
  }, []);

  if (err) {
    return (
      <div className="alert alert-red">
        Gagal memuat statistik: {err}
        <button className="btn btn-sm" style={{ marginLeft: 12 }}
                onClick={() => { setErr(''); setS(null); api.admin.stats().then(setS).catch((e) => setErr(e.message)); }}>
          coba lagi
        </button>
      </div>
    );
  }
  if (!s) return <div className="skeleton" style={{ height: 100 }} />;

  return (
    <>
      <div className="usage-kpis mb-24">
        <Kpi label="USER" value={s.users} sub="terdaftar" />
        <Kpi label="LANGGANAN AKTIF" value={s.active_subs} tone="green" sub="masa berjalan" />
        <Kpi label="PENDING" value={s.pending_payments} tone={s.pending_payments ? 'amber' : undefined}
             sub={s.pending_payments ? 'perlu dicek' : 'tidak ada antrean'} />
        <Kpi label="REVENUE" value={rupiah(s.revenue_idr)} tone="green" sub="total terbayar" />
        <Kpi label="REQUEST 24 JAM" value={s.requests_24h} sub="via API + playground" />
        <Kpi label="ERROR RATE 24 JAM" value={`${s.error_rate}%`}
             tone={s.error_rate > 5 ? 'amber' : s.error_rate === 0 ? 'green' : undefined}
             sub={s.error_rate > 5 ? 'perlu dicek' : 'sehat'} />
      </div>

      <AdminTraffic />

      <div className="card mt-16">
        <strong>Status provider</strong>
        <div className="stack gap-8 mt-16">
          {s.providers.map((p) => (
            <div key={p.id} className="row between small recent-row">
              <span>{p.name}</span>
              <span className={`mono tiny ${p.enabled ? 'text-green' : 'text-red'}`}>
                {p.model_enabled}/{p.model_count} model
              </span>
            </div>
          ))}
          {!s.providers.length && <span className="small text-dim">Belum ada provider.</span>}
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, tone, sub }) {
  return (
    <div className="kpi-cell">
      <div className="tiny-mono">{label}</div>
      <div className={`mono mt-4 ${tone === 'green' ? 'text-green' : tone === 'amber' ? 'text-amber' : tone === 'red' ? 'text-red' : ''}`}
           style={{ fontSize: 20 }}>{value}</div>
      {sub && <div className="tiny text-dim mt-4">{sub}</div>}
    </div>
  );
}

/* Aktivitas request per user — melihat POLA (agent/tool vs chat interaktif) */
function AdminTraffic() {
  const [win, setWin] = useState(60);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.admin.traffic(win)
        .then((r) => { if (alive) { setD(r); setErr(''); } })
        .catch((e) => { if (alive) setErr(e.message || 'gagal memuat'); });
    load();
    // jendela panjang = query berat → refresh lebih jarang
    const every = win <= 240 ? 30_000 : 120_000;
    const t = setInterval(load, every);
    return () => { alive = false; clearInterval(t); };
  }, [win]);

  const label = (m) => (m >= 60 ? `${m / 60} jam` : `${m} menit`);
  const bucketLabel = (m) => (m === 1 ? 'per menit' : `per ${m} menit`);
  const maxPeak = Math.max(1, ...((d && d.users) || []).map((u) => u.peak_rpm));
  const maxMin = Math.max(1, ...((d && d.series) || []).map((m) => m.count));

  return (
    <div className="card mt-16">
      <div className="row between wrap gap-12">
        <div>
          <strong>Aktivitas request</strong>
          <div className="tiny text-dim mt-4">
            Pola per user — request yang <i>diterima</i> saja.
            {d ? ` Auto-refresh ${win <= 240 ? 30 : 120} detik · grafik ${bucketLabel(d.bucket_minutes || 1)}.` : ''}
          </div>
        </div>
        <div className="row gap-8">
          {[30, 60, 240, 1440, 2880].map((m) => (
            <button key={m} className={`btn btn-sm ${win === m ? 'btn-primary' : ''}`} onClick={() => setWin(m)}>
              {label(m)}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="alert alert-red mt-12">{err}</div>}
      {!d && !err && <div className="skeleton" style={{ height: 90, marginTop: 16 }} />}

      {d && (
        <>
          <div className="row between wrap gap-12 mt-16 small">
            <span className="text-muted">
              <b className="mono">{d.total}</b> request · <b className="mono">{d.user_count}</b> user ·
              puncak <b className="mono">{d.peak_rpm_total}</b>/menit
            </span>
            <span className="tiny text-dim">
              ditolak limiter: rpm <b className="mono">{d.limiter?.blocked_rpm ?? 0}</b> · paralel{' '}
              <b className="mono">{d.limiter?.blocked_concurrent ?? 0}</b> · beban {d.load?.active ?? 0}/{d.load?.capacity ?? 0}
            </span>
          </div>

          {d.series?.length > 1 && (
            <div className="spark mt-12" title={`request ${bucketLabel(d.bucket_minutes || 1)}`}>
              {d.series.map((m) => (
                <span key={m.t} title={`${m.t.replace('T', ' ')}Z · ${m.count} request`}
                      style={{ height: `${Math.max(8, Math.round((m.count / maxMin) * 100))}%` }} />
              ))}
            </div>
          )}

          {d.users.length === 0 ? (
            <p className="small text-dim mt-16">Tidak ada request dalam {label(win)} terakhir.</p>
          ) : (
            <div className="stack gap-8 mt-16">
              {d.users.map((u) => (
                <div key={u.id} className="small">
                  <div className="row between wrap gap-8">
                    <span className="grow text-ellipsis">
                      {u.email || u.id}
                      {u.pattern === 'agent' && <span className="pill pill-amber" style={{ marginLeft: 8 }}>agent/tool</span>}
                      {u.pattern === 'interaktif' && <span className="pill text-dim" style={{ marginLeft: 8 }}>interaktif</span>}
                    </span>
                    <span className="mono tiny text-muted">
                      {u.requests} req · puncak {u.peak_rpm}/mnt · rata {u.avg_per_active_minute}/mnt
                      {u.top_model ? ` · ${u.top_model}` : ''} · {relative(u.last_at)}
                    </span>
                  </div>
                  <div className="traffic-bar mt-4"><span style={{ width: `${Math.round((u.peak_rpm / maxPeak) * 100)}%` }} /></div>
                </div>
              ))}
              {d.other_users > 0 && <span className="tiny text-dim">+{d.other_users} user lain</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── users ───────────────────────────────────────── */

function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');

  const load = (query = '') => api.admin.users(query).then((r) => setUsers(r.users)).catch(() => {});
  useEffect(() => { load(); }, []);

  // dialog tambah waktu — angka bebas + satuan (hari/jam/menit)
  const [extFor, setExtFor] = useState(null);   // user yang sedang dibuka dialognya
  const [extAmt, setExtAmt] = useState('');
  const [extUnit, setExtUnit] = useState('jam');
  const [extErr, setExtErr] = useState('');
  const [busy, setBusy] = useState(false);

  const openExtend = (u) => {
    setExtFor(u);
    setExtAmt('');
    setExtUnit('jam');
    setExtErr('');
  };

  const submitExtend = async () => {
    const amt = Number(extAmt.replace(',', '.'));
    if (!(amt > 0)) { setExtErr('Isi angka > 0.'); return; }
    setBusy(true); setExtErr('');
    try {
      const r = await api.admin.extend(extFor.id, amt, extUnit);
      setMsg(r.key_raw
        ? `Key baru untuk ${extFor.email}: ${r.key_raw} (copy sekarang, hanya tampil sekali)`
        : `+${fmtAmt(amt, extUnit)} untuk ${extFor.email} — aktif sampai ${new Date(r.expires_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`);
      setExtFor(null);
      load(q);
    } catch (e) {
      setExtErr(e.message);
    } finally { setBusy(false); }
  };

  const fmtAmt = (n, unit) =>
    unit === 'jam' ? `${n} jam` : unit === 'menit' ? `${n} menit` : `${n} hari`;

  useEscape(!!extFor, () => !busy && setExtFor(null));

  const revoke = async (u) => {
    if (!confirm(`Revoke semua key ${u.email}?`)) return;
    await api.admin.revoke(u.id);
    setMsg(`Key ${u.email} di-revoke.`);
    load(q);
  };

  return (
    <>
      <div className="row gap-8 mb-16 wrap">
        <input className="input" style={{ maxWidth: 320 }} placeholder="cari email / nama…"
               value={q} onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && load(q)} />
        <button className="btn btn-sm" onClick={() => load(q)}>cari</button>
      </div>

      {msg && (
        <div className="alert alert-green mb-16 row between gap-12 wrap">
          <span className="mono tiny" style={{ wordBreak: 'break-all' }}>{msg}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setMsg('')}>×</button>
        </div>
      )}

      <div className="card card-flush">
        <div className="log-list">
          {users.map((u) => {
            const active = u.sub_status === 'active' && u.expires_at && new Date(u.expires_at) > new Date();
            return (
              <div key={u.id} className="log-row" style={{ cursor: 'default' }}>
                <span className={`recent-dot ${active ? 'ok' : u.sub_status === 'pending' ? 'warn-dot' : 'off'}`}
                      title={active ? 'langganan aktif' : u.sub_status || 'belum berlangganan'} />
                <span className="log-main">
                  <span className="log-line1">
                    <span className="small">{u.name || u.email}</span>
                    {u.name && <span className="tiny text-dim">· {u.email}</span>}
                  </span>
                  <span className="log-line2">
                    {active ? `aktif sampai ${shortDate(u.expires_at)}` : u.sub_status || 'belum berlangganan'}
                    {' · '}
                    {u.requests} request · daftar {relative(u.created_at)}
                    {u.key_prefix ? ` · key ${u.key_prefix}…` : ''}
                  </span>
                </span>
                <span className={`pill ${active ? 'pill-green' : u.sub_status === 'pending' ? 'pill-amber' : 'pill-red'}`}>
                  {active ? 'aktif' : u.sub_status || 'belum'}
                </span>
                <span className="row gap-4 admin-user-actions">
                  <button className="btn btn-sm" title="tambah waktu manual" onClick={() => openExtend(u)}>+ waktu</button>
                  <button className="btn btn-danger btn-sm" onClick={() => revoke(u)}>revoke</button>
                </span>
              </div>
            );
          })}
          {!users.length && <div className="small text-dim" style={{ padding: 20 }}>Tidak ada user.</div>}
        </div>

        {extFor && (
          <div className="modal-back" onClick={() => !busy && setExtFor(null)}>
            <div className="modal detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="row between mb-16">
                <div>
                  <strong>Tambah waktu</strong>
                  <div className="tiny text-dim mt-4">{extFor.name || extFor.email}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setExtFor(null)} disabled={busy}>×</button>
              </div>

              <div className="row gap-8">
                <input className="input" style={{ maxWidth: 120 }} inputMode="decimal"
                       placeholder="mis. 1" autoFocus value={extAmt}
                       onChange={(e) => setExtAmt(e.target.value)} />
                <select className="select" style={{ maxWidth: 110 }} value={extUnit}
                        onChange={(e) => setExtUnit(e.target.value)}>
                  <option value="menit">menit</option>
                  <option value="jam">jam</option>
                  <option value="hari">hari</option>
                </select>
              </div>

              <div className="row gap-8 wrap mt-8">
                {[['1 jam', 1, 'jam'], ['6 jam', 6, 'jam'], ['1 hari', 1, 'hari'], ['7 hari', 7, 'hari'], ['30 hari', 30, 'hari']].map(([label, n, u]) => (
                  <button key={label} className="btn btn-sm" onClick={() => { setExtAmt(String(n)); setExtUnit(u); }}>
                    {label}
                  </button>
                ))}
              </div>

              {extErr && <div className="alert alert-red mt-16">{extErr}</div>}

              <button className="btn btn-primary btn-block mt-16" onClick={submitExtend} disabled={busy}>
                {busy ? 'Menyimpan…' : `Tambah waktu →`}
              </button>
              <p className="tiny text-dim mt-8">
                Ditambahkan dari sekarang kalau langganan belum aktif, atau dari sisa masa aktif kalau masih jalan.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ── payments ────────────────────────────────────── */

function AdminPayments() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.admin.payments().then((r) => setRows(r.payments)).catch(() => {}); }, []);

  return (
    <div className="card card-flush">
      <div className="log-list">
        {rows.map((p) => (
          <div key={p.id} className="log-row" style={{ cursor: 'default' }}>
            <span className={`recent-dot ${p.status === 'paid' ? 'ok' : p.status === 'pending' ? 'warn-dot' : 'red'}`} />
            <span className="log-main">
              <span className="log-line1">
                <span className="small">{p.name || p.email || '—'}</span>
                {p.name && <span className="tiny text-dim">· {p.email}</span>}
              </span>
              <span className="log-line2">
                {relative(p.created_at)} · {p.channel}
                {p.trx_id ? ` · ${String(p.trx_id).slice(0, 20)}` : ''}
              </span>
            </span>
            <span className="mono small nowrap">{rupiah(p.amount_idr)}</span>
            <span className={`pill ${p.status === 'paid' ? 'pill-green' : p.status === 'pending' ? 'pill-amber' : 'pill-red'}`}>
              {p.status}
            </span>
          </div>
        ))}
        {!rows.length && <div className="small text-dim" style={{ padding: 20 }}>Belum ada pembayaran.</div>}
      </div>
    </div>
  );
}

/* ── crypto (Solana) ─────────────────────────────── */

function AdminCrypto() {
  const [s, setS] = useState(null);
  const [rates, setRates] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.admin.cryptoSettings()
      .then((r) => { setS(r.settings); setRates(r.rates); })
      .catch((e) => setErr(e.message || 'Gagal memuat settings.'));

  useEffect(() => { load(); }, []);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.admin.saveCryptoSettings({
        enabled: s.enabled, address: s.address, coins: s.coins,
        markup: s.markup, fallback: s.fallback,
      });
      setS(r.settings);
      flash('✓ Settings crypto disimpan.');
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(false); }
  };

  const toggleCoin = (c) => {
    setS((x) => ({
      ...x,
      coins: x.coins.includes(c) ? x.coins.filter((y) => y !== c) : [...x.coins, c],
    }));
  };

  if (!s) {
    return <div className="card"><p className="small text-dim">Memuat…</p>
      {err && <div className="alert alert-red mt-16">{err}</div>}</div>;
  }

  const rate = (code) => rates?.[code];
  const estimate = (code) => {
    const r = rate(code) || s.fallback?.[code];
    if (!r) return '—';
    const decimals = code === 'sol' ? 4 : 2;
    const amt = Math.ceil((15000 * (s.markup || 1) / r) * 10 ** decimals) / 10 ** decimals;
    return `${amt} ${code.toUpperCase()}`;
  };

  return (
    <div className="stack gap-16">
      <div className="card">
        <div className="row between wrap gap-12">
          <div>
            <strong>Pembayaran Crypto (Solana)</strong>
            <p className="tiny text-muted mt-4">
              Terima USDC, USDT, dan SOL langsung ke wallet-mu. Tanpa gateway, tanpa potongan.
            </p>
          </div>
          <label className="row gap-8 small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={!!s.enabled}
                   onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
            aktifkan
          </label>
        </div>

        <div className="field mt-24">
          <label className="label">Alamat wallet Solana (penerima)</label>
          <input className="input mono" placeholder="mis. 7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj"
                 value={s.address || ''}
                 onChange={(e) => setS({ ...s, address: e.target.value.trim() })} />
          <p className="tiny text-dim mt-8">
            Satu alamat untuk semua koin. Bisa dari Phantom, Solflare, Backpack, atau exchange
            (pastikan exchange-mu menerima USDC/USDT di jaringan <strong>Solana</strong>).
          </p>
        </div>

        <div className="field">
          <label className="label">Koin yang diterima</label>
          <div className="row gap-12 wrap">
            {['usdc', 'usdt', 'sol'].map((c) => (
              <label key={c} className="row gap-8 small"
                     style={{ cursor: 'pointer', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
                <input type="checkbox" checked={s.coins.includes(c)} onChange={() => toggleCoin(c)} />
                <span className="mono">{c.toUpperCase()}</span>
                <span className="tiny text-dim">
                  {rate(c) ? `Rp${Number(rate(c)).toLocaleString('id-ID')}` : 'kurs —'}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Markup harga (jaga fluktuasi)</label>
          <input className="input" type="number" step="0.01" min="1" max="2" style={{ maxWidth: 160 }}
                 value={s.markup ?? 1}
                 onChange={(e) => setS({ ...s, markup: Number(e.target.value) })} />
          <p className="tiny text-dim mt-8">
            1.00 = harga normal · 1.03 = 3% lebih mahal (cadangan kalau kurs turun saat pembayaran).
          </p>
        </div>

        <div className="field">
          <label className="label">Kurs cadangan (dipakai kalau CoinGecko tidak bisa diakses)</label>
          <div className="row gap-12 wrap">
            {['usdc', 'usdt', 'sol'].map((c) => (
              <div key={c} style={{ maxWidth: 180 }}>
                <div className="tiny-mono">{c.toUpperCase()} · IDR per 1</div>
                <input className="input mono" type="number" min="0" step="1"
                       value={s.fallback?.[c] ?? 0}
                       onChange={(e) => setS({ ...s, fallback: { ...s.fallback, [c]: Number(e.target.value) } })} />
              </div>
            ))}
          </div>
        </div>

        {msg && <div className="alert alert-green mb-16">{msg}</div>}
        {err && <div className="alert alert-red mb-16">{err}</div>}

        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan settings crypto'}
        </button>
      </div>

      <div className="card">
        <strong>Pratinjau harga</strong>
        <p className="tiny text-muted mt-4">
          Paket Rp15.000 — jumlah koin yang diminta pembeli (dibulatkan ke atas).
        </p>
        <table className="table mt-16">
          <thead><tr><th>Koin</th><th>Kurs IDR</th><th style={{ textAlign: 'right' }}>Jumlah diminta</th></tr></thead>
          <tbody>
            {s.coins.map((c) => (
              <tr key={c}>
                <td className="mono tiny" data-label="Koin">{c.toUpperCase()}</td>
                <td className="mono tiny" data-label="Kurs">
                  {rate(c) ? Number(rate(c)).toLocaleString('id-ID') : '—'}
                </td>
                <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Jumlah">{estimate(c)}</td>
              </tr>
            ))}
            {!s.coins.length && (
              <tr><td colSpan={3} className="small text-dim" style={{ padding: 16 }}>Belum ada koin dipilih.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── providers & models ──────────────────────────── */

function AdminProviders() {
  const [providers, setProviders] = useState([]);
  const [models, setModels] = useState([]);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [testing, setTesting] = useState({});   // { [id]: true }
  const [results, setResults] = useState({});   // { [modelId]: hasil tes }
  const [upstreamModels, setUpstreamModels] = useState({}); // { [providerId]: string[] }
  const [bulk, setBulk] = useState(null);       // hasil tes semua
  const [runningAll, setRunningAll] = useState(false);
  const [editing, setEditing] = useState(null); // provider yang sedang diedit
  const [pForm, setPForm] = useState({ name: '', base_url: '', api_key: '', notes: '' });
  const [mForm, setMForm] = useState({ model_id: '', label: '', provider_id: '', upstream_name: '', description: '', context_len: '' });
  const [aliasEdit, setAliasEdit] = useState({});   // { [id]: alias baru }
  const [aliasErr, setAliasErr] = useState({});
  const [showP, setShowP] = useState(false);
  const [showM, setShowM] = useState(false);

  const load = async () => {
    const [p, m] = await Promise.all([api.admin.providers(), api.admin.models()]);
    setProviders(p.providers);
    setModels(m.models);
    setMForm((f) => ({ ...f, provider_id: f.provider_id || p.providers[0]?.id || '' }));
  };

  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  /* ── provider ── */

  const addProvider = async () => {
    setErr('');
    try {
      await api.admin.addProvider(pForm);
      setPForm({ name: '', base_url: '', api_key: '', notes: '' });
      setShowP(false);
      flash('Provider disimpan.');
      load();
    } catch (e) { setErr(e.message); }
  };

  const saveEdit = async () => {
    try {
      await api.admin.updateProvider(editing.id, editing);
      setEditing(null);
      flash('Provider diperbarui.');
      load();
    } catch (e) { setErr(e.message); }
  };

  const testProvider = async (p) => {
    setTesting((t) => ({ ...t, [p.id]: true }));
    try {
      const r = await api.admin.testProvider(p.id);
      setUpstreamModels((u) => ({ ...u, [p.id]: r.models || [] }));
      flash(r.ok
        ? `✓ ${p.name}: ${r.models_found} model ditemukan · ${r.latency_ms} ms`
        : `✗ ${p.name}: ${r.error}`);
      load();
    } catch (e) {
      flash(`✗ ${p.name}: ${e.message}`);
    } finally {
      setTesting((t) => ({ ...t, [p.id]: false }));
    }
  };

  const toggleProvider = async (p) => {
    await api.admin.updateProvider(p.id, { enabled: p.enabled ? 0 : 1 });
    load();
  };

  const delProvider = async (p) => {
    if (!confirm(`Hapus provider "${p.name}" beserta ${p.model_count} modelnya?`)) return;
    await api.admin.deleteProvider(p.id);
    load();
  };

  /* ── model ── */

  const openModelForm = async () => {
    setShowM((v) => !v);
    if (!showM && !mForm.model_id) {
      try {
        const { alias } = await api.admin.suggestAlias();
        setMForm((f) => ({ ...f, model_id: f.model_id || alias }));
      } catch { /* biarkan kosong */ }
    }
  };

  const simpanAlias = async (m) => {
    const next = (aliasEdit[m.id] || '').trim();
    if (!next || next === m.model_id) return;
    setAliasErr((e) => ({ ...e, [m.id]: '' }));
    try {
      await api.admin.renameAlias(m.model_id, next);
      setAliasEdit((a) => ({ ...a, [m.id]: '' }));
      flash(`Alias diganti: ${m.model_id} → ${next} (upstream tetap ${m.upstream_name}).`);
      load();
    } catch (e) {
      setAliasErr((x) => ({ ...x, [m.id]: e.message }));
    }
  };

  const addModel = async () => {
    setErr('');
    try {
      const body = { ...mForm };
      if (!body.context_len) delete body.context_len;
      await api.admin.addModel(body);
      setMForm({ model_id: '', label: '', provider_id: mForm.provider_id, upstream_name: '', description: '', context_len: '' });
      setShowM(false);
      flash('Model disimpan.');
      load();
    } catch (e) { setErr(e.message); }
  };

  const testModel = async (m) => {
    setTesting((t) => ({ ...t, [m.id]: true }));
    try {
      const r = await api.admin.testModel(m.model_id);
      setResults((x) => ({ ...x, [m.model_id]: r }));
      flash(r.ok ? `✓ ${m.model_id}: ${r.latency_ms} ms` : `✗ ${m.model_id}: ${r.error}`);
      load();
    } catch (e) {
      setResults((x) => ({ ...x, [m.model_id]: { ok: false, error: e.message } }));
      flash(`✗ ${m.model_id}: ${e.message}`);
    } finally {
      setTesting((t) => ({ ...t, [m.id]: false }));
    }
  };

  const testAll = async () => {
    setRunningAll(true);
    setBulk(null);
    try {
      const r = await api.admin.testAllModels();
      setBulk(r);
      flash(`Tes selesai: ${r.healthy}/${r.checked} model sehat.`);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunningAll(false);
    }
  };

  const toggleModel = async (m) => {
    await api.admin.updateModel(m.id, { enabled: m.enabled ? 0 : 1 });
    load();
  };

  const delModel = async (m) => {
    if (!confirm(`Hapus model "${m.model_id}"?`)) return;
    await api.admin.deleteModel(m.id);
    load();
  };

  /** Pasang model dari daftar upstream yang ditemukan saat tes provider. */
  const quickAdd = async (providerId, upstreamId) => {
    const p = providers.find((x) => x.id === providerId);
    try {
      await api.admin.addModel({
        model_id: upstreamId,
        label: upstreamId,
        provider_id: providerId,
        upstream_name: upstreamId,
        auto_sanitize: true,   // upstream sering "vendor/nama" → ID jadi "vendor-nama"
      });
      flash(upstreamId.includes('/')
        ? `Model ditambahkan: "${upstreamId}" → ID publik "${upstreamId.replace(/\\/g, '-').replace(/\//g, '-')}" (dari ${p?.name}).`
        : `Model "${upstreamId}" ditambahkan dari ${p?.name}.`);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const lastTest = (obj) => obj?.last_test || null;
  const pillFor = (t) => {
    if (!t) return <span className="pill">belum dites</span>;
    return t.ok
      ? <span className="pill pill-green">● sehat · {t.latency_ms} ms</span>
      : <span className="pill pill-red">● gagal</span>;
  };

  const belumTerdaftar = (providerId) => {
    const found = upstreamModels[providerId] || [];
    const ours = new Set(models.filter((m) => m.provider_id === providerId).map((m) => m.upstream_name || m.model_id));
    return found.filter((id) => !ours.has(id));
  };

  return (
    <>
      {err && <div className="alert alert-red mb-16">{err}
        <button className="btn btn-ghost btn-sm" onClick={() => setErr('')}>×</button>
      </div>}
      {toast && <div className="alert alert-green mb-16">{toast}</div>}

      {/* ── ringkasan kesehatan ── */}
      <div className="kpi-grid mb-24">
        <div className="card card-tight">
          <div className="tiny-mono">PROVIDER</div>
          <div className="mono mt-8" style={{ fontSize: 24 }}>{providers.length}</div>
          <div className="tiny text-dim">{providers.filter((p) => p.enabled).length} aktif</div>
        </div>
        <div className="card card-tight">
          <div className="tiny-mono">MODEL TERDAFTAR</div>
          <div className="mono mt-8" style={{ fontSize: 24 }}>{models.length}</div>
          <div className="tiny text-dim">{models.filter((m) => m.enabled).length} aktif untuk user</div>
        </div>
        <div className="card card-tight">
          <div className="tiny-mono">MODEL SEHAT</div>
          <div className="mono mt-8 text-green" style={{ fontSize: 24 }}>
            {models.filter((m) => lastTest(m)?.ok).length}
          </div>
          <div className="tiny text-dim">dari tes terakhir</div>
        </div>
        <div className="card card-tight">
          <div className="tiny-mono">BERMASALAH</div>
          <div className={`mono mt-8 ${models.filter((m) => lastTest(m) && !lastTest(m).ok).length ? 'text-red' : ''}`}
               style={{ fontSize: 24 }}>
            {models.filter((m) => lastTest(m) && !lastTest(m).ok).length}
          </div>
          <div className="tiny text-dim">perlu dicek</div>
        </div>
      </div>

      {bulk && (
        <div className={`alert mb-16 ${bulk.healthy === bulk.checked ? 'alert-green' : 'alert-amber'}`}>
          <strong>Tes semua model:</strong> {bulk.healthy}/{bulk.checked} sehat
          {bulk.results.filter((r) => !r.ok).length > 0 && (
            <span> · gagal: {bulk.results.filter((r) => !r.ok).map((r) => r.model_id).join(', ')}</span>
          )}
        </div>
      )}

      {/* ── PROVIDER ── */}
      <div className="row between mb-16 wrap gap-12">
        <div>
          <strong>Provider</strong>
          <p className="tiny text-dim">
            Endpoint upstream apa pun yang kompatibel OpenAI. Klik <em>tes koneksi</em> untuk
            memastikan masih hidup dan melihat model apa saja yang tersedia di sana.
          </p>
        </div>
        <div className="row gap-8">
          <button className="btn btn-sm" onClick={testAll} disabled={runningAll || !models.length}>
            {runningAll ? <span className="spinner" /> : '⚡'} tes semua model
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setShowP((v) => !v)}>
            {showP ? '× batal' : '+ tambah provider'}
          </button>
        </div>
      </div>

      {showP && (
        <div className="card mb-24">
          <div className="grid-2">
            <div className="field">
              <label className="label">Nama</label>
              <input className="input" value={pForm.name} placeholder="Provider Saya"
                     onChange={(e) => setPForm({ ...pForm, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Base URL</label>
              <input className="input" value={pForm.base_url} placeholder="https://api.contoh.com/v1"
                     onChange={(e) => setPForm({ ...pForm, base_url: e.target.value })} />
              <p className="tiny text-dim mt-8">Harus berakhir di <span className="mono">/v1</span> atau setara.</p>
            </div>
            <div className="field">
              <label className="label">API Key (opsional)</label>
              <input className="input" value={pForm.api_key} placeholder="sk-…" type="password"
                     onChange={(e) => setPForm({ ...pForm, api_key: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Catatan (opsional)</label>
              <input className="input" value={pForm.notes}
                     onChange={(e) => setPForm({ ...pForm, notes: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={addProvider}>Simpan provider</button>
        </div>
      )}

      <div className="stack gap-16 mb-32">
        {providers.map((p) => {
          const lt = lastTest(p);
          const sisa = belumTerdaftar(p.id);
          return (
            <div className="card" key={p.id}>
              <div className="row between wrap gap-12">
                <div className="grow" style={{ minWidth: 220 }}>
                  {editing?.id === p.id ? (
                    <div className="stack gap-8">
                      <input className="input" value={editing.name}
                             onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                      <input className="input mono tiny" value={editing.base_url}
                             onChange={(e) => setEditing({ ...editing, base_url: e.target.value })} />
                      <input className="input mono tiny" type="password"
                             placeholder="API key (biarkan kosong = tidak diubah)"
                             onChange={(e) => setEditing({ ...editing, api_key: e.target.value })} />
                      <div className="row gap-8">
                        <button className="btn btn-sm btn-primary" onClick={saveEdit}>simpan</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>batal</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="row gap-8 wrap">
                        <strong>{p.name}</strong>
                        <span className={`pill ${p.enabled ? 'pill-green' : 'pill-red'}`}>
                          {p.enabled ? 'aktif' : 'off'}
                        </span>
                        {pillFor(lt)}
                      </div>
                      <p className="mono tiny text-dim mt-8" style={{ wordBreak: 'break-all' }}>{p.base_url}</p>
                      <p className="tiny text-muted mt-8">
                        {p.model_enabled}/{p.model_count} model aktif
                        {p.has_key ? ' · API key tersimpan' : ' · tanpa API key'}
                        {lt?.at && ` · dites ${relative(lt.at)}`}
                      </p>
                      {lt && !lt.ok && (
                        <p className="tiny text-red mt-8" style={{ wordBreak: 'break-word' }}>
                          {lt.error}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {editing?.id !== p.id && (
                  <div className="row gap-4 wrap">
                    <button className="btn btn-sm" onClick={() => testProvider(p)} disabled={testing[p.id]}>
                      {testing[p.id] ? <span className="spinner" /> : '⟳'} tes koneksi
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditing({ ...p, api_key: '' })}>edit</button>
                    <button className="btn btn-sm" onClick={() => toggleProvider(p)}>
                      {p.enabled ? 'matikan' : 'aktifkan'}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => delProvider(p)}>hapus</button>
                  </div>
                )}
              </div>

              {/* daftar model upstream yang belum terdaftar */}
              {sisa.length > 0 && (
                <div className="mt-16" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
                  <p className="tiny-mono mb-8">
                    DITEMUKAN DI UPSTREAM · BELUM TERDAFTAR ({sisa.length})
                  </p>
                  <div className="row gap-8 wrap">
                    {sisa.slice(0, 12).map((id) => (
                      <button key={id} className="btn btn-sm" title="klik untuk menambahkan"
                              onClick={() => quickAdd(p.id, id)}>
                        + {id}
                      </button>
                    ))}
                    {sisa.length > 12 && <span className="tiny text-dim">+{sisa.length - 12} lagi</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!providers.length && (
          <div className="card"><p className="small text-dim">
            Belum ada provider. Tambahkan endpoint custom kamu — tidak ada batasan jumlah.
          </p></div>
        )}
      </div>

      {/* ── MODEL ── */}
      <div className="row between mb-16 wrap gap-12">
        <div>
          <strong>Model</strong>
          <p className="tiny text-dim">
            User hanya melihat <span className="text-green">alias publik</span>. Nama asli provider
            disimpan di server dan tidak pernah dikirim ke client — ganti alias kapan saja tanpa
            mengubah kode user. Kolom <em>kesehatan</em> menunjukkan hasil tes terakhir.
          </p>
        </div>
        <button className="btn btn-sm btn-primary" onClick={openModelForm} disabled={!providers.length}>
          {showM ? '× batal' : '+ tambah model'}
        </button>
      </div>

      {showM && (
        <div className="card mb-24">
          <div className="grid-2">
            <div className="field">
              <label className="label">Alias publik (yang dilihat user)</label>
              <div className="row gap-8">
                <input className="input" value={mForm.model_id} placeholder="clv-flash"
                       onChange={(e) => setMForm({ ...mForm, model_id: e.target.value })} />
                <button className="btn btn-sm nowrap" type="button"
                        onClick={async () => {
                          const { alias } = await api.admin.suggestAlias();
                          setMForm((f) => ({ ...f, model_id: alias }));
                        }}>
                  saran
                </button>
              </div>
              <p className="tiny text-dim mt-8">
                Nama netral yang dikirim ke user. Nama asli provider tidak pernah diekspos.
              </p>
            </div>
            <div className="field">
              <label className="label">Label tampilan</label>
              <input className="input" value={mForm.label} placeholder="Model Cepat"
                     onChange={(e) => setMForm({ ...mForm, label: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Provider</label>
              <select className="select" value={mForm.provider_id}
                      onChange={(e) => setMForm({ ...mForm, provider_id: e.target.value })}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Nama asli di provider (upstream)</label>
              <input className="input mono" value={mForm.upstream_name}
                     placeholder="deepseek-chat / gpt-4o-mini / …"
                     onChange={(e) => setMForm({ ...mForm, upstream_name: e.target.value })} />
              <p className="tiny text-dim mt-8">
                Hanya dipakai server untuk memanggil provider. Tidak pernah dikirim ke user.
              </p>
            </div>
            <div className="field">
              <label className="label">Context length (opsional)</label>
              <input className="input" value={mForm.context_len} placeholder="128000" type="number"
                     onChange={(e) => setMForm({ ...mForm, context_len: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Deskripsi (opsional)</label>
              <input className="input" value={mForm.description}
                     onChange={(e) => setMForm({ ...mForm, description: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={addModel}>Simpan model</button>
        </div>
      )}

      <div className="card card-flush">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Alias publik</th>
                <th>Nama asli (upstream)</th>
                <th>Provider</th>
                <th>Kesehatan</th>
                <th>Dites</th>
                <th>Untuk user</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const lt = lastTest(m);
                const r = results[m.model_id];
                return (
                  <tr key={m.id}>
                    <td data-label="Alias">
                      <div className="mono tiny text-green">{m.model_id}</div>
                      <div className="tiny text-dim">{m.label}</div>
                    </td>
                    <td data-label="Upstream">
                      <div className="mono tiny text-dim" style={{ wordBreak: 'break-all' }}>
                        {m.upstream_name}
                      </div>
                      <div className="row gap-4 mt-4">
                        <input className="input mono" style={{ fontSize: 11, padding: '3px 6px', maxWidth: 150 }}
                               placeholder="alias baru…"
                               value={aliasEdit[m.id] ?? ''}
                               onChange={(e) => setAliasEdit((a) => ({ ...a, [m.id]: e.target.value }))}
                               onKeyDown={(e) => e.key === 'Enter' && simpanAlias(m)} />
                        <button className="btn btn-sm" disabled={!aliasEdit[m.id]?.trim()}
                                onClick={() => simpanAlias(m)}>
                          ganti
                        </button>
                      </div>
                      {aliasErr[m.id] && <div className="tiny text-red mt-4">{aliasErr[m.id]}</div>}
                    </td>
                    <td className="tiny text-muted" data-label="Provider">{m.provider_name}</td>
                    <td data-label="Kesehatan">
                      {r ? (
                        <span className={`pill ${r.ok ? 'pill-green' : 'pill-red'}`}>
                          {r.ok ? `● ${r.latency_ms} ms` : '● gagal'}
                        </span>
                      ) : pillFor(lt)}
                      {r && !r.ok && (
                        <div className="tiny text-red mt-4" style={{ maxWidth: 260, wordBreak: 'break-word' }}>
                          {r.error}
                        </div>
                      )}
                      {r?.ok && r.reply && (
                        <div className="tiny text-dim mt-4" style={{ maxWidth: 260 }}>
                          “{r.reply.slice(0, 60)}”
                        </div>
                      )}
                    </td>
                    <td className="tiny text-dim" data-label="Dites">{lt?.at ? relative(lt.at) : '—'}</td>
                    <td data-label="Untuk user">
                      <span className={`pill ${m.enabled ? 'pill-green' : ''}`}>
                        {m.enabled ? 'ya' : 'off'}
                      </span>
                    </td>
                    <td>
                      <div className="row gap-4">
                        <button className="btn btn-sm" onClick={() => testModel(m)} disabled={testing[m.id]}>
                          {testing[m.id] ? <span className="spinner" /> : '⟳'} tes
                        </button>
                        <button className="btn btn-sm" onClick={() => toggleModel(m)}>
                          {m.enabled ? 'matikan' : 'aktifkan'}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => delModel(m)}>hapus</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!models.length && (
                <tr><td colSpan={7} className="text-dim small" style={{ padding: 20 }}>
                  Belum ada model. Tambahkan dari provider di atas.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="tiny text-dim mt-16">
        Tes model mengirim satu request chat pendek ke provider memakai nama upstream —
        sama seperti yang dialami user. Kalau gagal, biasanya nama model di provider berubah
        atau API key sudah tidak berlaku.
      </p>
    </>
  );
}
