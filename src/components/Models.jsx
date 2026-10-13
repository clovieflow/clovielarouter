import { useEffect, useState } from 'react';
import { api, rupiah, relative } from '../api';
import { navigate } from '../hooks';

/* ─────────────────────────── Model (katalog + coba) ─────────────────────────── */

export function Models({ user, models, config }) {
  const [selected, setSelected] = useState(models[0]?.id || '');
  const [prompt, setPrompt] = useState('Jelaskan apa itu API dalam satu kalimat.');
  const [maxTokens, setMaxTokens] = useState(256);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');

  const base = config?.api_base || `${window.location.origin}/v1`;
  const sub = user?.subscription;

  useEffect(() => {
    if (!selected && models[0]) setSelected(models[0].id);
  }, [models, selected]);

  const copy = (t, id) => {
    navigator.clipboard.writeText(t);
    setCopied(id);
    setTimeout(() => setCopied(''), 1500);
  };

  const run = async () => {
    setErr('');
    setResult(null);
    setRunning(true);
    try {
      const r = await api.playground(selected, prompt, maxTokens);
      setResult(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Model</h1>
          <p className="small text-muted mt-4">
            {models.length} model tersedia. Coba langsung di bawah, atau pakai lewat API.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/docs')}>dokumentasi →</button>
      </div>

      {!models.length && (
        <div className="alert alert-amber mb-24">
          Belum ada model aktif. Admin perlu menambahkannya di admin panel.
        </div>
      )}

      {/* katalog */}
      <div className="grid-3 mb-24">
        {models.map((m) => (
          <button
            key={m.id}
            className="card"
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              borderColor: selected === m.id ? 'var(--green)' : 'var(--border)',
            }}
            onClick={() => setSelected(m.id)}
          >
            <div className="row between">
              <strong style={{ fontSize: 14 }}>{m.label}</strong>
              {selected === m.id && <span className="pill pill-green">dipilih</span>}
            </div>
            <div className="row between mt-8">
              <span className="mono tiny text-green">{m.id}</span>
              <button className="btn btn-ghost btn-sm"
                      onClick={(e) => { e.stopPropagation(); copy(m.id, m.id); }}>
                {copied === m.id ? '✓' : 'copy'}
              </button>
            </div>
            {m.description && <p className="tiny text-muted mt-8">{m.description}</p>}
            {m.context_len && <p className="tiny-mono mt-8">context {m.context_len.toLocaleString('id-ID')}</p>}
          </button>
        ))}
      </div>

      {/* playground */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="row between mb-16">
            <strong>Coba model</strong>
            <span className="pill">{selected || '—'}</span>
          </div>

          <div className="field">
            <label className="label">Prompt</label>
            <textarea
              className="textarea"
              rows={6}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Tulis pertanyaanmu…"
              style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%', maxWidth: '100%' }}
            />
          </div>

          <div className="field">
            <label className="label">Max token: {maxTokens}</label>
            <input type="range" min="32" max="2048" step="32" value={maxTokens}
                   onChange={(e) => setMaxTokens(Number(e.target.value))}
                   style={{ width: '100%', accentColor: 'var(--green)' }} />
          </div>

          {!sub && (
            <div className="alert alert-amber mb-16">
              Langganan belum aktif.{' '}
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/checkout')}>
                Beli {config ? rupiah(config.price_idr) : 'Rp15.000'}
              </button>
            </div>
          )}

          <button className="btn btn-primary btn-block" onClick={run} disabled={running || !selected || !sub}>
            {running ? <span className="spinner" style={{ borderTopColor: '#04140c' }} /> : null}
            {running ? 'Mengirim…' : 'Jalankan →'}
          </button>
          <p className="tiny text-dim mt-8 center-text">
            Request ini tercatat di <span className="mono">Log</span> seperti request API biasa.
          </p>
        </div>

        <div className="card">
          <div className="row between mb-16">
            <strong>Hasil</strong>
            {result && <span className="pill pill-green">● {result.latency_ms} ms</span>}
          </div>

          {!result && !err && (
            <p className="small text-dim">
              Belum ada hasil. Pilih model, tulis prompt, lalu klik <em>Jalankan</em>.
            </p>
          )}

          {err && <div className="alert alert-red">{err}</div>}

          {result && (
            <>
              <div className="code wrap" style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', overflowWrap: 'anywhere' }}>
                {result.reply}
              </div>
              <div className="row between mt-16 tiny-mono">
                <span>request id</span>
                <span className="row gap-8">
                  {result.request_id?.slice(0, 20)}…
                  <button className="btn btn-ghost btn-sm"
                          onClick={() => copy(result.request_id, 'rid')}>
                    {copied === 'rid' ? '✓' : 'copy'}
                  </button>
                </span>
              </div>
              {result.usage && (
                <div className="row between mt-8 tiny-mono">
                  <span>token in / out</span>
                  <span>{result.usage.prompt_tokens} / {result.usage.completion_tokens}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* contoh pakai */}
      <div className="card mt-24">
        <div className="row between mb-16 wrap gap-12">
          <strong>Pakai model ini lewat API</strong>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/docs')}>panduan lengkap →</button>
        </div>
        <p className="tiny-mono mb-8">BASE URL</p>
        <div className="key-value" style={{ marginTop: 0 }}>{base}</div>
        <pre className="code mt-16" style={{ fontSize: 11.5 }}>{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${user?.api_key?.prefix || 'clv_...'}..." \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${selected || 'nama-model'}","messages":[{"role":"user","content":"Halo"}]}'`}</pre>
      </div>
    </>
  );
}

/* ─────────────────────────── Log ─────────────────────────── */

const fmtTok = (n) => (n == null ? '—' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',') + 'rb' : String(n));


export function Logs() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [model, setModel] = useState('');
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState(null);

  const load = async (opts = {}) => {
    const l = opts.limit ?? limit;
    const o = opts.offset ?? offset;
    const st = opts.status ?? status;
    const md = opts.model ?? model;
    setLoading(true);
    setErr('');
    try {
      const r = await api.logs({ limit: l, offset: o, status: st, model: md });
      setData(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load({ offset: 0 }); setOffset(0); }, [status, model]);

  const statusPill = (code) => {
    if (code >= 200 && code < 300) return <span className="pill pill-green">{code}</span>;
    if (code === 429) return <span className="pill pill-amber">{code}</span>;
    if (code >= 400) return <span className="pill pill-red">{code}</span>;
    return <span className="pill">{code ?? '—'}</span>;
  };

  const fmtTime = (s) => {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Log request</h1>
          <p className="small text-muted mt-4">
            {data ? `${data.filtered} dari ${data.total} request` : 'memuat…'}
          </p>
        </div>
        <button className="btn btn-sm" onClick={() => load()} disabled={loading}>
          {loading ? <span className="spinner" /> : '⟳'} muat ulang
        </button>
      </div>

      {/* filter */}
      <div className="card card-tight mb-16">
        <div className="row gap-12 wrap">
          <div style={{ minWidth: 150 }}>
            <label className="label">Status</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">semua</option>
              <option value="ok">berhasil (2xx)</option>
              <option value="error">gagal (4xx/5xx)</option>
            </select>
          </div>
          <div style={{ minWidth: 180 }}>
            <label className="label">Model</label>
            <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">semua model</option>
              {(data?.models || []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="label">Per halaman</label>
            <select className="select" value={limit}
                    onChange={(e) => { const l = Number(e.target.value); setLimit(l); load({ limit: l, offset: 0 }); setOffset(0); }}>
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {err && <div className="alert alert-red mb-16">{err}</div>}

      <div className="card card-flush">
        <div className="log-list">
          {(data?.logs || []).map((r) => {
            const tok = (r.tokens_in != null || r.tokens_out != null)
              ? `${fmtTok(r.tokens_in)} / ${fmtTok(r.tokens_out)} tok`
              : null;
            return (
              <button key={r.request_id} className="log-row" onClick={() => setDetail(r)}>
                <span className={`recent-dot ${r.status_code >= 400 ? 'red' : 'ok'}`} />
                <span className="log-main">
                  <span className="log-line1">
                    <span className="mono small">{r.model}</span>
                    <span className="log-id mono tiny">#{(r.request_id || '').slice(0, 10)}</span>
                  </span>
                  <span className="log-line2">
                    {fmtTime(r.created_at)}
                    {r.latency_ms ? ` · ${r.latency_ms} ms` : ''}
                    {tok ? ` · ${tok}` : ''}
                  </span>
                </span>
                {statusPill(r.status_code)}
                <span className="log-chevron">›</span>
              </button>
            );
          })}
          {data && !data.logs.length && (
            <div className="small text-dim" style={{ padding: 20 }}>
              Belum ada request{(status || model) ? ' yang cocok dengan filter' : ''}.
              {' '}Coba jalankan sesuatu di halaman <em>Model</em>.
            </div>
          )}
          {!data && <div style={{ padding: 20 }}><div className="skeleton" /></div>}
        </div>
      </div>

      {/* paginasi */}
      {data && data.filtered > limit && (
        <div className="row between wrap gap-12 mt-16">
          <button className="btn btn-sm" disabled={offset === 0}
                  onClick={() => { const o = Math.max(0, offset - limit); setOffset(o); load({ offset: o }); }}>
            ← sebelumnya
          </button>
          <span className="tiny-mono">
            {offset + 1}–{Math.min(offset + limit, data.filtered)} dari {data.filtered}
          </span>
          <button className="btn btn-sm" disabled={offset + limit >= data.filtered}
                  onClick={() => { const o = offset + limit; setOffset(o); load({ offset: o }); }}>
            berikutnya →
          </button>
        </div>
      )}

      {detail && <RequestDetail detail={detail} onClose={() => setDetail(null)} statusPill={statusPill} fmtTime={fmtTime} />}
    </>
  );
}


/* ─────────────────────────── Detail request ─────────────────────────── */

function RequestDetail({ detail, onClose, statusPill, fmtTime }) {
  const [copied, setCopied] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = (text, key) => {
    navigator.clipboard.writeText(String(text ?? ''));
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  const ok = detail.status_code < 400;
  const copyBtn = (val, key) => (
    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}
            onClick={() => copy(val, key)} title="copy">
      {copied === key ? '✓' : 'copy'}
    </button>
  );

  const field = (label, value, key, mono = true) => (
    <div className="detail-field">
      <div className="tiny-mono">{label}</div>
      <div className="row between gap-8 mt-4">
        <span className={mono ? 'mono small' : 'small'} style={{ wordBreak: 'break-all' }}>
          {value ?? '—'}
        </span>
        {value != null && key && copyBtn(value, key)}
      </div>
    </div>
  );

  const tokIn = detail.tokens_in ?? 0;
  const tokOut = detail.tokens_out ?? 0;
  const total = tokIn + tokOut && (detail.tokens_in != null || detail.tokens_out != null) ? tokIn + tokOut : null;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* header status */}
        <div className={`detail-head ${ok ? 'ok' : 'bad'}`}>
          <div className="row between">
            <div>
              <div className="tiny-mono" style={{ opacity: .8 }}>Request detail</div>
              <div className="mono mt-4" style={{ fontSize: 14 }}>#{(detail.request_id || '').slice(0, 18)}…</div>
            </div>
            <div className="row gap-8">
              {statusPill(detail.status_code)}
              <button className="btn btn-ghost btn-sm" onClick={onClose}>×</button>
            </div>
          </div>
          {/* ringkasan cepat */}
          <div className="detail-stats mt-16">
            <div>
              <div className="tiny" style={{ opacity: .75 }}>Latensi</div>
              <div className="mono" style={{ fontSize: 17 }}>{detail.latency_ms ? `${detail.latency_ms} ms` : '—'}</div>
            </div>
            <div>
              <div className="tiny" style={{ opacity: .75 }}>Token</div>
              <div className="mono" style={{ fontSize: 17 }}>{total ? total.toLocaleString('id-ID') : '—'}</div>
            </div>
            <div>
              <div className="tiny" style={{ opacity: .75 }}>Waktu</div>
              <div className="small" style={{ marginTop: 3 }}>{fmtTime(detail.created_at)}</div>
            </div>
          </div>
        </div>

        <div className="stack gap-16 mt-16">
          {field('Model', detail.model, 'model')}
          {field('Request ID', detail.request_id, 'id')}
          {detail.tokens_in != null && field('Token masuk', detail.tokens_in.toLocaleString('id-ID'), 'tin')}
          {detail.tokens_out != null && field('Token keluar', detail.tokens_out.toLocaleString('id-ID'), 'tout')}
        </div>

        <div className="row gap-8 mt-24">
          <button className="btn btn-block"
                  onClick={() => copy(`curl ${window.location.origin}/v1/chat/completions \\
  -H "Authorization: Bearer $CLOVIELA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${detail.model}", "messages": [{"role": "user", "content": "Halo"}]}'`)}>
            copy curl template
          </button>
        </div>
      </div>
    </div>
  );
}
