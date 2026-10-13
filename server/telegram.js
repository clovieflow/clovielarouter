/**
 * Notifikasi Telegram — HANYA untuk admin (owner).
 * Dipakai saat: pembayaran masuk, user baru daftar, key di-revoke, dsb.
 */
const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = () => process.env.TELEGRAM_ADMIN_CHAT_ID || '';

export const telegramEnabled = () => !!(TOKEN() && CHAT_ID());

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export async function notifyAdmin(text) {
  if (!telegramEnabled()) return { skipped: true };
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID(),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) console.warn('[telegram]', json.description || res.status);
    return json;
  } catch (err) {
    console.warn('[telegram] failed:', err.message);
    return { ok: false };
  }
}

const rupiah = (n) =>
  'Rp' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

/** Template notif pembayaran masuk. */
export function paymentMessage({ email, name, amount, channel, trxId, status, days }) {
  const when = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const icon = status === 'paid' ? '✅' : status === 'pending' ? '⏳' : '⚠️';
  return [
    `${icon} <b>Pembayaran ${esc(status)}</b>`,
    '',
    `👤 ${esc(name)} · <code>${esc(email)}</code>`,
    `💳 ${esc(channel?.toUpperCase())} · <b>${rupiah(amount)}</b>`,
    days ? `📅 +${esc(days)} hari` : null,
    `🧾 <code>${esc(trxId)}</code>`,
    `🕐 ${when} WIB`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function signupMessage({ email, name }) {
  return [
    '🆕 <b>User baru daftar</b>',
    `👤 ${esc(name)} · <code>${esc(email)}</code>`,
    `🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
  ].join('\n');
}

export function revokeMessage({ email, prefix, reason }) {
  return [
    '🚫 <b>API key di-revoke</b>',
    `👤 <code>${esc(email)}</code>`,
    `🔑 ${esc(prefix)}…`,
    reason ? `📝 ${esc(reason)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
