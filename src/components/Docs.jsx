import { useEffect, useState } from 'react';
import { api, rupiah } from '../api';
import { navigate } from '../hooks';

/**
 * Halaman dokumentasi — cara pakai API dari nol:
 * base URL, autentikasi, contoh per bahasa, streaming, error, parameter.
 */

const TABS = [
  { id: 'mulai', label: 'Mulai cepat' },
  { id: 'auth', label: 'Autentikasi' },
  { id: 'chat', label: 'Chat completion' },
  { id: 'stream', label: 'Streaming' },
  { id: 'python', label: 'Python' },
  { id: 'node', label: 'Node.js' },
  { id: 'curl', label: 'curl' },
  { id: 'model', label: 'Daftar model' },
  { id: 'limits', label: 'Rate limit' },
  { id: 'error', label: 'Error' },
];

export function Docs({ user, config, models }) {
  const [tab, setTab] = useState('mulai');
  const [copied, setCopied] = useState('');

  const base = config?.api_base || `${window.location.origin}/v1`;
  const keyExample = user?.api_key ? `${user.api_key.prefix}••••` : 'clv_xxxxxxxxxxxx';
  const modelExample = models[0]?.id || 'nama-model';

  const copy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 1500);
  };

  const Code = ({ id, children, label }) => (
    <div className="card card-flush mt-16">
      <div className="code-head">
        <span className="tiny-mono">{label || 'contoh'}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => copy(children, id)}>
          {copied === id ? '✓ tersalin' : 'copy'}
        </button>
      </div>
      <pre className="code" style={{ border: 'none', borderRadius: 0, margin: 0 }}>{children}</pre>
    </div>
  );

  const H = ({ children }) => <h3 className="mt-32" style={{ fontSize: 18 }}>{children}</h3>;
  const P = ({ children }) => <p className="small text-muted mt-8" style={{ lineHeight: 1.7 }}>{children}</p>;

  return (
    <div className="shell" style={{ padding: '32px 24px 80px' }}>
      <div className="row between wrap gap-16 mb-24">
        <div>
          <h1 style={{ fontSize: 26 }}>Dokumentasi API</h1>
          <p className="small text-muted mt-4">
            API kompatibel OpenAI — ganti <span className="mono">base_url</span>, kode lama langsung jalan.
          </p>
        </div>
        {!user && (
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/login')}>
            Masuk untuk dapat API key →
          </button>
        )}
      </div>

      {/* kartu kunci: base url + key */}
      <div className="grid-2 mb-24">
        <div className="card">
          <p className="tiny-mono">BASE URL</p>
          <div className="key-value row between gap-12" style={{ marginTop: 10 }}>
            <span>{base}</span>
            <button className="btn btn-sm" onClick={() => copy(base, 'base')}>
              {copied === 'base' ? '✓' : 'copy'}
            </button>
          </div>
          <p className="tiny text-dim mt-8">
            Semua endpoint di bawah relatif terhadap base URL ini.
          </p>
        </div>
        <div className="card">
          <p className="tiny-mono">API KEY</p>
          <div className="key-value row between gap-12" style={{ marginTop: 10 }}>
            <span>{keyExample}</span>
            {user?.api_key
              ? <button className="btn btn-sm" onClick={() => navigate('/dashboard/keys')}>kelola</button>
              : <button className="btn btn-sm" onClick={() => navigate('/checkout')}>beli paket</button>}
          </div>
          <p className="tiny text-dim mt-8">
            Kirim sebagai header <span className="mono">Authorization: Bearer &lt;key&gt;</span>.
          </p>
        </div>
      </div>

      {/* tab navigasi */}
      <div className="row gap-8 wrap mb-24">
        {TABS.map((t) => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : ''}`}
                  onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── MULAI CEPAT ── */}
      {tab === 'mulai' && (
        <>
          <H>1. Beli paket &amp; ambil API key</H>
          <P>
            Login dengan Google, bayar {config ? rupiah(config.price_idr) : 'Rp15.000'} lewat QRIS.
            Setelah pembayaran terkonfirmasi, langganan aktif {config?.plan_days || 7} hari dan
            API key langsung terbit — ambil di <strong>Dashboard → API Keys</strong>.
          </P>
          <P>Key hanya ditampilkan sekali saat dibuat. Simpan di tempat aman (mis. <span className="mono">.env</span>).</P>

          <H>2. Ganti base_url di kodemu</H>
          <P>
            Semua SDK OpenAI-compatible bisa langsung dipakai. Yang berubah hanya dua hal:
            <span className="mono"> base_url</span> dan <span className="mono">api_key</span>.
          </P>
          <Code id="quick" label="3 baris perubahan">{`# dari
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."

# jadi
base_url = "${base}"
api_key  = "clv_..."`}</Code>

          <H>3. Kirim request pertama</H>
          <Code id="first" label="curl">{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${keyExample}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelExample}",
    "messages": [{"role": "user", "content": "Halo!"}]
  }'`}</Code>

          <H>Kalau bingung, mulai dari mana?</H>
          <div className="grid-3 mt-16">
            {[
              { t: 'Punya kode OpenAI', d: 'Ganti base_url + api_key. Selesai.', go: 'auth' },
              { t: 'Pakai Python/Node', d: 'Lihat contoh lengkap per bahasa.', go: 'python' },
              { t: 'Mau respons streaming', d: 'Aktifkan stream: true.', go: 'stream' },
            ].map((c) => (
              <button key={c.t} className="card" style={{ textAlign: 'left', cursor: 'pointer' }}
                      onClick={() => setTab(c.go)}>
                <strong style={{ fontSize: 14 }}>{c.t}</strong>
                <p className="tiny text-muted mt-8">{c.d} →</p>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── AUTH ── */}
      {tab === 'auth' && (
        <>
          <H>Cara autentikasi</H>
          <P>
            Setiap request wajib menyertakan API key di header <span className="mono">Authorization</span>
            dengan format <span className="mono">Bearer &lt;key&gt;</span>. Tidak ada parameter tambahan.
          </P>
          <Code id="hdr" label="header">{`Authorization: Bearer clv_a1b2c3d4e5f6...
Content-Type: application/json`}</Code>

          <H>Aturan yang berlaku</H>
          <table className="table mt-16">
            <tbody>
              <tr>
                <td className="small">Satu key = satu akun</td>
                <td className="tiny text-muted">Key terikat ke langgananmu, bukan per-project.</td>
              </tr>
              <tr>
                <td className="small">Bisa regenerate</td>
                <td className="tiny text-muted">
                  Kalau key bocor, klik <em>Regenerate</em> — key lama langsung mati, langganan tetap jalan.
                </td>
              </tr>
              <tr>
                <td className="small">Hanya di server</td>
                <td className="tiny text-muted">
                  Jangan taruh key di kode frontend/browser. Pakai environment variable.
                </td>
              </tr>
              <tr>
                <td className="small">Rate limit fair-use</td>
                <td className="tiny text-muted">
                  Ada batas per detik supaya layanan stabil. Kena limit → HTTP 429.
                </td>
              </tr>
            </tbody>
          </table>

          <H>Simpan key dengan aman</H>
          <Code id="env" label=".env">{`# .env — jangan di-commit ke git
CLOVIELA_API_KEY=clv_a1b2c3d4e5f6...

# .gitignore
.env`}</Code>
        </>
      )}

      {/* ── CHAT ── */}
      {tab === 'chat' && (
        <>
          <H>POST /chat/completions</H>
          <P>Endpoint utama untuk chat. Menerima format OpenAI standar dan mengembalikan jawaban model.</P>

          <Code id="chatbody" label="request body">{`{
  "model": "${modelExample}",
  "messages": [
    {"role": "system", "content": "Kamu asisten yang ringkas."},
    {"role": "user",   "content": "Jelaskan apa itu API dalam 1 kalimat."}
  ],
  "temperature": 0.7,
  "max_tokens": 500
}`}</Code>

          <H>Parameter</H>
          <table className="table mt-16">
            <thead>
              <tr><th>Field</th><th>Wajib</th><th>Keterangan</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono tiny" data-label="Field">model</td>
                <td className="tiny" data-label="Wajib">ya</td>
                <td className="tiny text-muted">Nama model dari <span className="mono">/models</span>.</td>
              </tr>
              <tr>
                <td className="mono tiny" data-label="Field">messages</td>
                <td className="tiny" data-label="Wajib">ya</td>
                <td className="tiny text-muted">
                  Daftar pesan: <span className="mono">role</span> = system / user / assistant.
                </td>
              </tr>
              <tr>
                <td className="mono tiny" data-label="Field">stream</td>
                <td className="tiny" data-label="Wajib">tidak</td>
                <td className="tiny text-muted">Set <span className="mono">true</span> untuk respons bertahap.</td>
              </tr>
              <tr>
                <td className="mono tiny" data-label="Field">temperature</td>
                <td className="tiny" data-label="Wajib">tidak</td>
                <td className="tiny text-muted">0–2. Makin tinggi makin kreatif.</td>
              </tr>
              <tr>
                <td className="mono tiny" data-label="Field">max_tokens</td>
                <td className="tiny" data-label="Wajib">tidak</td>
                <td className="tiny text-muted">Batas panjang jawaban.</td>
              </tr>
            </tbody>
          </table>

          <H>Respons</H>
          <Code id="chatres" label="200 OK">{`{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "${modelExample}",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "API adalah ..."},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 24, "completion_tokens": 18, "total_tokens": 42}
}`}</Code>
          <P>
            Ambil jawabannya di <span className="mono">choices[0].message.content</span>.
            Header <span className="mono">X-Request-Id</span> ikut dikembalikan — pakai itu kalau
            perlu lapor masalah.
          </P>
        </>
      )}

      {/* ── STREAMING ── */}
      {tab === 'stream' && (
        <>
          <H>Respons streaming (SSE)</H>
          <P>
            Untuk chat yang muncul bertahap, set <span className="mono">stream: true</span>.
            Server mengirim potongan data (<span className="mono">text/event-stream</span>) sampai
            ada penanda <span className="mono">[DONE]</span>.
          </P>

          <Code id="streamcurl" label="curl">{`curl -N ${base}/chat/completions \\
  -H "Authorization: Bearer ${keyExample}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelExample}",
    "messages": [{"role":"user","content":"Hitung 1 sampai 5"}],
    "stream": true
  }'`}</Code>

          <H>Bentuk datanya</H>
          <Code id="streamraw" label="output mentah">{`data: {"choices":[{"delta":{"content":"1"}}]}

data: {"choices":[{"delta":{"content":", 2"}}]}

data: {"choices":[{"delta":{"content":", 3"}}]}

data: [DONE]`}</Code>
          <P>
            Tiap baris diawali <span className="mono">data: </span>. Gabungkan
            <span className="mono"> delta.content</span> sampai ketemu <span className="mono">[DONE]</span>.
          </P>
        </>
      )}

      {/* ── PYTHON ── */}
      {tab === 'python' && (
        <>
          <H>Python — pakai SDK OpenAI resmi</H>
          <Code id="pyinstall" label="install">{`pip install openai`}</Code>

          <H>Chat biasa</H>
          <Code id="pybasic" label="main.py">{`import os
from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key=os.environ["CLOVIELA_API_KEY"],
)

resp = client.chat.completions.create(
    model="${modelExample}",
    messages=[
        {"role": "system", "content": "Kamu asisten ringkas."},
        {"role": "user", "content": "Apa itu API?"},
    ],
)

print(resp.choices[0].message.content)
print("token terpakai:", resp.usage.total_tokens)`}</Code>

          <H>Streaming</H>
          <Code id="pystream" label="stream.py">{`stream = client.chat.completions.create(
    model="${modelExample}",
    messages=[{"role": "user", "content": "Tulis pantun singkat."}],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)`}</Code>

          <H>Pakai library lain (mis. LangChain)</H>
          <P>
            Apa pun yang menerima <span className="mono">base_url</span> + API key bisa dipakai.
            Tidak perlu library khusus.
          </P>
        </>
      )}

      {/* ── NODE ── */}
      {tab === 'node' && (
        <>
          <H>Node.js — SDK OpenAI resmi</H>
          <Code id="npminstall" label="install">{`npm install openai`}</Code>

          <H>Chat biasa</H>
          <Code id="nodebasic" label="index.js">{`import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${base}',
  apiKey: process.env.CLOVIELA_API_KEY,
});

const resp = await client.chat.completions.create({
  model: '${modelExample}',
  messages: [
    { role: 'system', content: 'Kamu asisten ringkas.' },
    { role: 'user', content: 'Apa itu API?' },
  ],
});

console.log(resp.choices[0].message.content);`}</Code>

          <H>Streaming</H>
          <Code id="nodestream" label="stream.js">{`const stream = await client.chat.completions.create({
  model: '${modelExample}',
  messages: [{ role: 'user', content: 'Tulis puisi pendek.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}`}</Code>

          <H>Tanpa SDK (fetch bawaan)</H>
          <Code id="nodefetch" label="fetch">{`const res = await fetch('${base}/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.CLOVIELA_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: '${modelExample}',
    messages: [{ role: 'user', content: 'Halo' }],
  }),
});

const data = await res.json();
console.log(data.choices[0].message.content);`}</Code>
        </>
      )}

      {/* ── CURL ── */}
      {tab === 'curl' && (
        <>
          <H>Uji cepat dari terminal</H>
          <P>Paling cepat untuk memastikan key dan model bekerja sebelum masuk ke kode.</P>

          <Code id="curl1" label="chat dasar">{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${keyExample}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${modelExample}",
    "messages": [{"role": "user", "content": "Halo!"}]
  }'`}</Code>

          <H>Lihat HTTP status &amp; latensi</H>
          <Code id="curl2" label="debug">{`curl -w "\\nstatus: %{http_code}  waktu: %{time_total}s\\n" \\
  ${base}/chat/completions \\
  -H "Authorization: Bearer ${keyExample}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${modelExample}","messages":[{"role":"user","content":"ping"}]}'`}</Code>

          <H>Simpan key sebagai variabel shell</H>
          <Code id="curl3" label="bash">{`export CLOVIELA_API_KEY="clv_..."

curl ${base}/chat/completions \\
  -H "Authorization: Bearer $CLOVIELA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${modelExample}","messages":[{"role":"user","content":"Halo"}]}'`}</Code>
        </>
      )}

      {/* ── MODELS ── */}
      {tab === 'model' && (
        <>
          <H>GET /models</H>
          <P>Melihat model apa saja yang bisa kamu pakai. Daftarnya bisa berubah — ambil ulang saat runtime.</P>

          <Code id="modelscurl" label="curl">{`curl ${base}/models \\
  -H "Authorization: Bearer ${keyExample}"`}</Code>

          <Code id="modelsres" label="respons">{`{
  "object": "list",
  "data": [
    ${models.slice(0, 3).map((m) => `{ "id": "${m.id}", "object": "model", "owned_by": "cloviela" }`).join(',\n    ') || '{ "id": "nama-model", "object": "model", "owned_by": "cloviela" }'}
  ]
}`}</Code>

          <H>Model yang tersedia sekarang</H>
          <table className="table mt-16">
            <thead><tr><th>Model ID</th><th>Keterangan</th></tr></thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td className="mono tiny" data-label="Model">
                    {m.id}
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }}
                            onClick={() => copy(m.id, m.id)}>
                      {copied === m.id ? '✓' : 'copy'}
                    </button>
                  </td>
                  <td className="tiny text-muted" data-label="Ket.">{m.description || m.label}</td>
                </tr>
              ))}
              {!models.length && (
                <tr><td colSpan={2} className="tiny text-dim" style={{ padding: 16 }}>
                  Belum ada model aktif. Hubungi admin.
                </td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {/* ── RATE LIMIT ── */}
      {tab === 'limits' && (
        <>
          <H>Batas pemakaian</H>
          <P>
            Setiap akun punya batas supaya layanan tetap stabil untuk semua orang. Batas dihitung
            per akun (semua API key-mu berbagi kuota yang sama).
          </P>

          <table className="table mt-24">
            <thead><tr><th>Batas</th><th style={{ textAlign: 'right' }}>Nilai</th><th>Artinya</th></tr></thead>
            <tbody>
              <tr>
                <td className="small" data-label="Batas">Request per menit</td>
                <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Nilai">
                  {config?.limits?.user_rpm || 30} RPM
                </td>
                <td className="tiny text-muted" data-label="Artinya">
                  Kuota diisi ulang bertahap tiap detik, bukan reset tiap menit — jadi request
                  tetap bisa jalan lancar walau sudah banyak dipakai.
                </td>
              </tr>
              <tr>
                <td className="small" data-label="Batas">Request bersamaan</td>
                <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Nilai">
                  {config?.limits?.user_concurrent || 3}
                </td>
                <td className="tiny text-muted" data-label="Artinya">
                  Jumlah request yang boleh diproses pada saat yang sama.
                </td>
              </tr>
            </tbody>
          </table>

          <H>Kalau kena batas</H>
          <P>Server membalas <span className="mono">HTTP 429</span> dengan informasi yang jelas:</P>
          <Code id="rlres" label="respons 429">{`{
  "error": {
    "message": "Terlalu banyak request dari akunmu (batas 30/menit). Coba lagi dalam 2 detik.",
    "type": "rate_limit_exceeded",
    "code": "rate_limit",
    "retry_after": 2,
    "scope": "user"
  }
}`}</Code>

          <H>Header yang dikirim</H>
          <table className="table mt-16">
            <thead><tr><th>Header</th><th>Keterangan</th></tr></thead>
            <tbody>
              <tr><td className="mono tiny" data-label="Header">Retry-After</td>
                  <td className="tiny text-muted">Detik yang perlu ditunggu sebelum mencoba lagi.</td></tr>
              <tr><td className="mono tiny" data-label="Header">X-RateLimit-Limit</td>
                  <td className="tiny text-muted">Batas yang berlaku.</td></tr>
              <tr><td className="mono tiny" data-label="Header">X-RateLimit-Remaining</td>
                  <td className="tiny text-muted">Sisa kuota di jendela saat ini.</td></tr>
              <tr><td className="mono tiny" data-label="Header">X-RateLimit-Scope</td>
                  <td className="tiny text-muted"><span className="mono">user</span> atau <span className="mono">global</span>.</td></tr>
            </tbody>
          </table>

          <H>Cara menangani di kode</H>
          <P>
            Cara paling aman: hormati header <span className="mono">Retry-After</span> dan ulangi
            request. Contoh dengan backoff otomatis:
          </P>
          <Code id="rlpy" label="python">{`import time, openai
from openai import APIStatusError

def tanya(prompt, percobaan=4):
    for i in range(percobaan):
        try:
            return client.chat.completions.create(
                model="${modelExample}",
                messages=[{"role": "user", "content": prompt}],
            )
        except APIStatusError as e:
            if e.status_code == 429 and i < percobaan - 1:
                tunggu = int(e.response.headers.get("Retry-After", 2))
                time.sleep(tunggu)
                continue
            raise`}</Code>

          <Code id="rlnode" label="node">{`async function tanya(prompt, percobaan = 4) {
  for (let i = 0; i < percobaan; i++) {
    const res = await fetch('${base}/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${process.env.CLOVIELA_API_KEY}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: '${modelExample}',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (res.status === 429 && i < percobaan - 1) {
      const tunggu = Number(res.headers.get('retry-after') || 2);
      await new Promise((r) => setTimeout(r, tunggu * 1000));
      continue;
    }
    return res.json();
  }
}`}</Code>

          <H>Tips supaya tidak sering kena batas</H>
          <ul className="feature-list mt-16">
            <li><span className="tick">•</span> Jalankan request secara berurutan, bukan sekaligus ratusan.</li>
            <li><span className="tick">•</span> Batasi jumlah worker/thread paralel di kodemu.</li>
            <li><span className="tick">•</span> Simpan hasil yang sudah didapat — jangan panggil ulang untuk hal yang sama.</li>
            <li><span className="tick">•</span> Kalau untuk produksi dengan volume tinggi, hubungi admin untuk penyesuaian.</li>
          </ul>
        </>
      )}

      {/* ── ERROR ── */}
      {tab === 'error' && (
        <>
          <H>Daftar error</H>
          <P>Semua error mengembalikan JSON dengan bentuk yang sama:</P>
          <Code id="errshape" label="bentuk error">{`{
  "error": {
    "message": "API key tidak valid.",
    "code": "invalid_key"
  }
}`}</Code>

          <table className="table mt-24">
            <thead><tr><th>Status</th><th>Code</th><th>Artinya</th><th>Solusi</th></tr></thead>
            <tbody>
              <tr>
                <td className="mono tiny" data-label="Status">401</td>
                <td className="mono tiny" data-label="Code">missing_key</td>
                <td className="tiny" data-label="Artinya">Header Authorization tidak ada</td>
                <td className="tiny text-muted" data-label="Solusi">Tambahkan <span className="mono">Bearer &lt;key&gt;</span></td>
              </tr>
              <tr>
                <td className="mono tiny" data-label="Status">401</td>
                <td className="mono tiny" data-label="Code">invalid_key</td>
                <td className="tiny" data-label="Artinya">Key salah / sudah di-revoke</td>
                <td className="tiny text-muted" data-label="Solusi">Ambil key baru di dashboard</td>
              </tr>
              <tr>
                <td className="mono tiny">402</td>
                <td className="mono tiny" data-label="Code">subscription_inactive</td>
                <td className="tiny" data-label="Artinya">Langganan habis / belum bayar</td>
                <td className="tiny text-muted" data-label="Solusi">Perpanjang paket</td>
              </tr>
              <tr>
                <td className="mono tiny">404</td>
                <td className="mono tiny" data-label="Code">model_not_found</td>
                <td className="tiny" data-label="Artinya">Nama model tidak dikenal</td>
                <td className="tiny text-muted" data-label="Solusi">Cek <span className="mono">/models</span></td>
              </tr>
              <tr>
                <td className="mono tiny">429</td>
                <td className="mono tiny" data-label="Code">rate_limit</td>
                <td className="tiny" data-label="Artinya">Melebihi kuota per menit</td>
                <td className="tiny text-muted" data-label="Solusi">
                  Tunggu sesuai <span className="mono">Retry-After</span> → lihat tab Rate limit
                </td>
              </tr>
              <tr>
                <td className="mono tiny">429</td>
                <td className="mono tiny" data-label="Code">concurrency_limit</td>
                <td className="tiny" data-label="Artinya">Terlalu banyak request bersamaan</td>
                <td className="tiny text-muted" data-label="Solusi">Tunggu salah satu selesai, lalu ulangi</td>
              </tr>
              <tr>
                <td className="mono tiny">502</td>
                <td className="mono tiny" data-label="Code">upstream_unreachable</td>
                <td className="tiny" data-label="Artinya">Provider sedang bermasalah</td>
                <td className="tiny text-muted" data-label="Solusi">Coba lagi; kalau terus, lapor admin</td>
              </tr>
            </tbody>
          </table>

          <H>Menangani error di kode</H>
          <Code id="errhandle" label="python">{`from openai import APIStatusError

try:
    resp = client.chat.completions.create(...)
except APIStatusError as e:
    if e.status_code == 402:
        print("Langganan habis — perpanjang dulu.")
    elif e.status_code == 429:
        time.sleep(2)  # lalu coba lagi
    else:
        print("Error:", e.response.json())`}</Code>
        </>
      )}

      <div className="card mt-32">
        <div className="row between wrap gap-16">
          <div>
            <strong>Siap mulai?</strong>
            <p className="small text-muted mt-4">
              {user?.subscription
                ? `Langgananmu aktif ${user.subscription.days_left} hari lagi.`
                : 'Beli paket dulu untuk mendapatkan API key.'}
            </p>
          </div>
          <div className="row gap-8">
            <button className="btn btn-primary btn-sm" onClick={() => navigate(user ? '/dashboard/keys' : '/checkout')}>
              {user ? 'ambil API key →' : 'beli paket →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Halaman Status — ringkas, untuk cek layanan hidup. */
export function StatusPage({ config, models }) {
  const [health, setHealth] = useState(null);
  useEffect(() => { api.health().then(setHealth).catch(() => {}); }, []);

  return (
    <div className="shell-narrow" style={{ padding: '48px 24px' }}>
      <h1 style={{ fontSize: 26 }}>Status layanan</h1>
      <p className="small text-muted mt-8">Kondisi terkini API dan gateway pembayaran.</p>

      <div className="grid-2 mt-24">
        <div className="card">
          <div className="row between">
            <strong>API Router</strong>
            <span className={`pill ${health?.ok ? 'pill-green' : 'pill-red'}`}>
              {health ? (health.ok ? '● operational' : '● gangguan') : 'memuat…'}
            </span>
          </div>
          <p className="tiny text-dim mt-8">
            Base URL: <span className="mono">{config?.api_base || '—'}</span>
          </p>
        </div>
        <div className="card">
          <div className="row between">
            <strong>Pembayaran (QRIS)</strong>
            <span className={`pill ${health?.payment === 'live' ? 'pill-green' : health?.payment === 'sandbox' ? 'pill-amber' : 'pill-red'}`}>
              {health?.payment === 'live' ? '● live' : health?.payment === 'sandbox' ? '● sandbox' : '● nonaktif'}
            </span>
          </div>
          <p className="tiny text-dim mt-8">Diproses otomatis lewat Paymenku</p>
        </div>
      </div>

      <div className="card mt-16">
        <strong>Batas & beban saat ini</strong>
        <table className="table mt-16">
          <thead><tr><th>Batas</th><th style={{ textAlign: 'right' }}>Nilai</th></tr></thead>
          <tbody>
            <tr>
              <td className="small" data-label="Batas">Per akun — request/menit</td>
              <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Nilai">
                {health?.limits?.userRpm ?? '—'}
              </td>
            </tr>
            <tr>
              <td className="small" data-label="Batas">Per akun — bersamaan</td>
              <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Nilai">
                {health?.limits?.userConcurrent ?? '—'}
              </td>
            </tr>
            <tr>
              <td className="small" data-label="Batas">Kapasitas layanan</td>
              <td className="mono tiny" style={{ textAlign: 'right' }} data-label="Nilai">
                {health?.load ? `${health.load.active}/${health.load.capacity} slot terpakai` : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card mt-16">
        <strong>Model tersedia</strong>
        <div className="stack gap-8 mt-16">
          {models.map((m) => (
            <div key={m.id} className="row between small">
              <span className="mono tiny">{m.id}</span>
              <span className="pill pill-green">● ok</span>
            </div>
          ))}
          {!models.length && <span className="small text-dim">Belum ada model aktif.</span>}
        </div>
      </div>
    </div>
  );
}
