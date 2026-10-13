import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = process.env.PAYMENKU_BASE || 'https://paymenku.com/api/v1';
const KEY = () => process.env.PAYMENKU_API_KEY || '';
const SANDBOX = () => KEY().startsWith('sk_test_');

async function call(path, { method = 'GET', body, idempotencyKey } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.message || `paymenku_${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

export const paymenkuEnabled = () => !!KEY();

export async function listChannels() {
  const { data } = await call('/payment-channels');
  return data || [];
}

/**
 * Buat transaksi pembayaran.
 * @returns {{trx_id, reference_id, amount, status, pay_url, payment_info}}
 */
export async function createTransaction({
  channel,
  amount,
  referenceId,
  customerName,
  customerEmail,
  customerPhone,
  returnUrl,
  orderItems,
}) {
  const { data } = await call('/transaction/create', {
    method: 'POST',
    idempotencyKey: referenceId,
    body: {
      channel_code: channel,
      amount,
      reference_id: referenceId,
      customer_name: customerName,
      customer_email: customerEmail,
      ...(customerPhone ? { customer_phone: customerPhone } : {}),
      return_url: returnUrl,
      ...(orderItems ? { order_items: orderItems } : {}),
    },
  });
  return data;
}

export async function checkStatus(referenceId) {
  const { data } = await call(`/check-status/${encodeURIComponent(referenceId)}`);
  return data;
}

/**
 * Verifikasi signature webhook Paymenku.
 * signature = HMAC-SHA256(timestamp + "." + raw_body, webhook_secret)
 */
export function verifyWebhook(rawBody, timestamp, signature) {
  const secret = process.env.PAYMENKU_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!timestamp || !signature) return false;

  // Tolak replay di luar 5 menit.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const A = Buffer.from(expected);
  const B = Buffer.from(String(signature));
  return A.length === B.length && timingSafeEqual(A, B);
}

export const paymenkuMode = () => (SANDBOX() ? 'sandbox' : 'live');
