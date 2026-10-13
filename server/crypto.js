/**
 * Pembayaran crypto di Solana — SOL, USDC, USDT.
 *
 * Cara kerja (standar Solana Pay):
 *  1. Server bikin "reference" = 32 byte acak (base58) yang unik per order.
 *  2. QR diisi URI `solana:<alamat>?amount=..&spl-token=..&reference=..`
 *     Wallet (Phantom/Solflare/Backpack) otomatis menyertakan reference
 *     sebagai account read-only di transaksi.
 *  3. Server cek on-chain: `getSignaturesForAddress(reference)` → ketemu
 *     transaksi yang menyebut reference itu → cek jumlah yang diterima.
 *
 * Tidak butuh private key sama sekali: reference cuma penanda unik.
 */
import { randomBytes } from 'node:crypto';

const RPC = () => process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/* ── base58 (tanpa dependency) ── */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex') || '0x0');
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out || '1';
}

/** Koin yang didukung. `mint` kosong = SOL native. */
export const COINS = {
  sol: { code: 'sol', name: 'Solana (SOL)', symbol: 'SOL', mint: null, decimals: 4, cg: 'solana' },
  usdc: {
    code: 'usdc', name: 'USD Coin (USDC)', symbol: 'USDC', decimals: 2, cg: 'usd-coin',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  usdt: {
    code: 'usdt', name: 'Tether (USDT)', symbol: 'USDT', decimals: 2, cg: 'tether',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
};

export const COIN_CODES = Object.keys(COINS);

/* ── rate IDR dari CoinGecko (cache 5 menit) ── */
let rateCache = { at: 0, data: null };
const RATE_TTL = 5 * 60 * 1000;

export async function rates() {
  if (rateCache.data && Date.now() - rateCache.at < RATE_TTL) return rateCache.data;

  const ids = Object.values(COINS).map((c) => c.cg).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=idr`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`rate_${res.status}`);
  const json = await res.json();

  const out = {};
  for (const c of Object.values(COINS)) {
    const idr = json?.[c.cg]?.idr;
    if (idr) out[c.code] = Number(idr);
  }
  if (!Object.keys(out).length) throw new Error('rate_kosong');

  rateCache = { at: Date.now(), data: out };
  return out;
}

/* ── settings (disimpan di Firestore oleh store.js) ── */

export const DEFAULTS = {
  enabled: false,
  address: '',                       // alamat Solana penerima (satu untuk semua koin)
  coins: ['usdc', 'usdt', 'sol'],
  // selisih harga: 1.0 = harga normal, 1.03 = 3% lebih mahal (jaga fluktuasi)
  markup: 1.0,
  // kalau rate CoinGecko gagal, pakai ini (IDR per 1 koin)
  fallback: { sol: 0, usdc: 0, usdt: 0 },
};

export function normalizeSettings(raw = {}) {
  const s = { ...DEFAULTS, ...raw };
  s.enabled = !!s.enabled;
  s.address = String(s.address || '').trim();
  s.coins = Array.isArray(s.coins) ? s.coins.filter((c) => COINS[c]) : DEFAULTS.coins;
  if (!s.coins.length) s.coins = DEFAULTS.coins;
  s.markup = Number(s.markup) > 0 ? Number(s.markup) : 1;
  s.fallback = { ...DEFAULTS.fallback, ...(raw.fallback || {}) };
  return s;
}

/** Siap dipakai? butuh alamat wallet + minimal satu koin aktif. */
export const isReady = (s) => !!s.enabled && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.address) && s.coins.length > 0;

/** Koin yang boleh dibayar sekarang (untuk endpoint publik). */
export function publicCoins(s) {
  return s.coins.map((c) => ({ code: c, name: COINS[c].name, symbol: COINS[c].symbol }));
}

/* ── harga ── */

/** Konversi IDR → jumlah koin. Dibulatkan KE ATAS biar tidak kurang bayar. */
export async function amountFor(coin, amountIdr, settings) {
  const c = COINS[coin];
  if (!c) throw new Error('coin_tidak_dikenal');

  let idrPerCoin = 0;
  try {
    idrPerCoin = (await rates())[coin] || 0;
  } catch {
    idrPerCoin = Number(settings?.fallback?.[coin] || 0);
  }
  if (!idrPerCoin) idrPerCoin = Number(settings?.fallback?.[coin] || 0);
  if (!idrPerCoin) throw new Error('rate_tidak_tersedia');

  const total = (Number(amountIdr) * (settings?.markup || 1)) / idrPerCoin;
  const f = 10 ** c.decimals;
  const amount = Math.ceil(total * f) / f;

  return { amount, rate_idr: idrPerCoin, symbol: c.symbol, decimals: c.decimals };
}

/* ── order ── */

/** Reference unik per order — 32 byte acak, base58. */
export const newReference = () => base58(randomBytes(32));

/**
 * URI Solana Pay yang di-scan wallet.
 * @see https://docs.solanapay.com/spec
 */
export function payUri({ address, amount, coin, reference, label, message }) {
  const c = COINS[coin];
  const q = new URLSearchParams();
  q.set('amount', String(amount));
  if (c?.mint) q.set('spl-token', c.mint);
  q.set('reference', reference);
  if (label) q.set('label', label);
  if (message) q.set('message', message);
  return `solana:${address}?${q.toString()}`;
}

/* ── verifikasi on-chain ── */

async function rpc(method, params) {
  const res = await fetch(RPC(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(json.error.message || 'rpc_error');
  return json.result;
}

/**
 * Cek apakah order sudah dibayar.
 * @returns {{paid: boolean, signature?: string, received?: number, reason?: string}}
 */
export async function verifyPayment(order) {
  const c = COINS[order.coin];
  if (!c) return { paid: false, reason: 'coin_tidak_dikenal' };

  const sigs = await rpc('getSignaturesForAddress', [order.reference, { limit: 5 }]);
  if (!Array.isArray(sigs) || !sigs.length) return { paid: false, reason: 'belum_ada_transaksi' };

  for (const s of sigs) {
    if (s.err) continue;
    const tx = await rpc('getTransaction', [
      s.signature,
      { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    if (!tx?.meta || tx.meta.err) continue;

    const received = c.mint
      ? splReceived(tx, order.address, c.mint)
      : solReceived(tx, order.address);

    if (received >= order.amount * 0.99) {
      return { paid: true, signature: s.signature, received };
    }
  }
  return { paid: false, reason: 'nominal_belum_cocok' };
}

/** Selisih saldo SOL milik penerima di transaksi ini. */
function solReceived(tx, address) {
  const keys = tx.transaction?.message?.accountKeys || [];
  const idx = keys.findIndex((k) => (k.pubkey || k) === address);
  if (idx < 0) return 0;
  const pre = tx.meta.preBalances?.[idx] ?? 0;
  const post = tx.meta.postBalances?.[idx] ?? 0;
  return (post - pre) / 1e9;
}

/** Selisih saldo token SPL milik penerima untuk mint tertentu. */
function splReceived(tx, address, mint) {
  const pre = tx.meta.preTokenBalances || [];
  const post = tx.meta.postTokenBalances || [];
  const find = (list) => list.find((b) => b.owner === address && b.mint === mint);
  const p = find(post);
  if (!p) return 0;
  const before = find(pre)?.uiTokenAmount?.uiAmount || 0;
  return (p.uiTokenAmount?.uiAmount || 0) - before;
}
