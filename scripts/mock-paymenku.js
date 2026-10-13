/**
 * Mock Paymenku API — untuk development tanpa API key asli.
 *
 * Cara pakai:
 *   1) node scripts/mock-paymenku.js          (listen :9099)
 *   2) set di .env:  PAYMENKU_BASE=http://localhost:9099
 *   3) setelah checkout, bayar transaksinya:
 *      curl -X POST localhost:9099/__pay -d '{"trx_id":"IDP…"}'
 *      → mock mengirim webhook "paid" ke server (pakai secret yang sama)
 */
import http from 'node:http';
import { createHmac } from 'node:crypto';

const PORT = process.env.MOCK_PORT || 9099;
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || 'http://localhost:8787/api/webhook/paymenku';
const SECRET = process.env.PAYMENKU_WEBHOOK_SECRET || 'whsec_test_123';

const trx = new Map();
let seq = 1000;

const CHANNELS = [
  { code: 'qris', name: 'QRIS', type: 'qris', group: 'QRIS', fee_flat: 200, fee_percent: 0.7, min_amount: 1000, max_amount: 10000000 },
  { code: 'bca_va', name: 'BCA Virtual Account', type: 'va', group: 'Virtual Account', fee_flat: 4000, fee_percent: 0, min_amount: 10000, max_amount: 50000000 },
  { code: 'bni_va', name: 'BNI Virtual Account', type: 'va', group: 'Virtual Account', fee_flat: 4000, fee_percent: 0, min_amount: 10000, max_amount: 50000000 },
  { code: 'dana', name: 'DANA', type: 'ewallet', group: 'E-Wallet', fee_flat: 200, fee_percent: 2, min_amount: 1000, max_amount: 10000000 },
  { code: 'ovo', name: 'OVO', type: 'ewallet', group: 'E-Wallet', fee_flat: 200, fee_percent: 2, min_amount: 1000, max_amount: 10000000 },
];

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
    });
  });

async function fireWebhook(t) {
  const payload = JSON.stringify({
    event: 'payment.status_updated',
    trx_id: t.trx_id,
    reference_id: t.reference_id,
    status: 'paid',
    amount: t.amount.toFixed(2),
    total_fee: '205.00',
    amount_received: (t.amount - 205).toFixed(2),
    payment_channel: t.channel_code,
    customer_name: t.customer_name,
    customer_email: t.customer_email,
    paid_at: new Date().toISOString(),
    created_at: t.created_at,
    is_sandbox: true,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac('sha256', SECRET).update(`${ts}.${payload}`).digest('hex');
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PaymenKu-Timestamp': ts,
      'X-PaymenKu-Signature': sig,
    },
    body: payload,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/v1/payment-channels') {
    return json(res, 200, { status: 'success', data: CHANNELS });
  }

  if (url.pathname === '/api/v1/transaction/create' && req.method === 'POST') {
    const b = await readBody(req);
    const id = `IDP${Date.now()}${seq++}`;
    const t = {
      trx_id: id,
      reference_id: b.reference_id,
      amount: Number(b.amount),
      channel_code: b.channel_code,
      customer_name: b.customer_name,
      customer_email: b.customer_email,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    trx.set(id, t);

    const info =
      b.channel_code === 'qris'
        ? { qr_url: `http://localhost:${PORT}/__qr/${id}.png`, qr_string: '00020101021226680016COM.MOCK', expiration_date: new Date(Date.now() + 36e5).toISOString() }
        : b.channel_code.includes('_va')
        ? { bank: b.channel_code.split('_')[0].toUpperCase(), va_number: '3816' + Math.floor(Math.random() * 1e10), expiration_date: new Date(Date.now() + 864e5).toISOString() }
        : { transaction_status: 'pending', checkout_url: `http://localhost:${PORT}/__pay/${id}`, expiration_date: new Date(Date.now() + 36e5).toISOString() };

    return json(res, 200, {
      status: 'success',
      data: {
        trx_id: id,
        reference_id: b.reference_id,
        amount: t.amount.toFixed(2),
        status: 'pending',
        pay_url: `http://localhost:${PORT}/__pay/${id}`,
        payment_info: info,
      },
    });
  }

  const chk = url.pathname.match(/^\/api\/v1\/check-status\/(.+)$/);
  if (chk) {
    const t = [...trx.values()].find((x) => x.reference_id === decodeURIComponent(chk[1]));
    if (!t) return json(res, 404, { status: 'error', message: 'not found' });
    return json(res, 200, { status: 'success', data: { trx_id: t.trx_id, reference_id: t.reference_id, status: t.status, amount: t.amount.toFixed(2) } });
  }

  // dev helper: tandai lunas + kirim webhook
  if (url.pathname === '/__pay' && req.method === 'POST') {
    const b = await readBody(req);
    const t = b.trx_id ? trx.get(b.trx_id) : [...trx.values()].at(-1);
    if (!t) return json(res, 404, { error: 'trx tidak ada' });
    t.status = 'paid';
    const out = await fireWebhook(t);
    return json(res, 200, { paid: t.trx_id, webhook: out });
  }

  if (url.pathname.startsWith('/__qr/')) {
    // QR dummy 1x1 png transparan
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(png);
  }

  if (url.pathname.startsWith('/__pay/')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<html><body style="font-family:monospace;background:#070708;color:#ededed;padding:40px">
      <h2>Mock halaman pembayaran</h2><p>${url.pathname.split('/').pop()}</p>
      <p>Lunasi: <code>curl -X POST localhost:${PORT}/__pay -d '{"trx_id":"${url.pathname.split('/').pop()}"}'</code></p>
    </body></html>`);
  }

  json(res, 404, { status: 'error', message: 'not found' });
});

server.listen(PORT, () => {
  console.log(`mock paymenku → http://localhost:${PORT}`);
  console.log(`webhook target → ${WEBHOOK_URL}`);
});
