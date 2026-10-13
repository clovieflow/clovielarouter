/**
 * Rate limiter in-memory — token bucket (RPM) + penghitung concurrency.
 *
 * Cocok untuk satu instance server (in-memory, tanpa service tambahan).
 * Kalau nanti jalan di beberapa server, ganti penyimpanannya ke Redis —
 * antarmuka fungsinya sengaja dibuat sederhana supaya mudah ditukar.
 *
 * Dua lapis:
 *   1. GLOBAL   — melindungi provider upstream (semua user berbagi kuota ini)
 *   2. PER USER — jaring pengaman supaya satu user tidak menghabiskan kuota global
 *                 (set 0 untuk mematikan)
 */

const buckets = new Map();     // key → { tokens, last }
const concurrent = new Map();  // key → jumlah request aktif
const stats = { blocked_rpm: 0, blocked_concurrent: 0, total: 0 };

/* ───────────────────────── token bucket (RPM) ───────────────────────── */

function takeToken(key, limit, windowMs = 60_000) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: limit, last: now };
    buckets.set(key, b);
  }

  // isi ulang proporsional dengan waktu yang berlalu
  const elapsed = now - b.last;
  if (elapsed > 0) {
    b.tokens = Math.min(limit, b.tokens + (elapsed / windowMs) * limit);
    b.last = now;
  }

  if (b.tokens < 1) {
    const waitMs = ((1 - b.tokens) / limit) * windowMs;
    return { ok: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)), remaining: 0 };
  }

  b.tokens -= 1;
  return { ok: true, remaining: Math.floor(b.tokens) };
}

/* ───────────────────────── concurrency ───────────────────────── */

function acquireSlot(key, max) {
  const cur = concurrent.get(key) || 0;
  if (cur >= max) return false;
  concurrent.set(key, cur + 1);
  return true;
}

function releaseSlot(key) {
  const cur = concurrent.get(key) || 0;
  if (cur <= 1) concurrent.delete(key);
  else concurrent.set(key, cur - 1);
}

/* ───────────────────────── config ───────────────────────── */

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export const limits = {
  // kuota global — melindungi provider
  globalRpm: num(process.env.GLOBAL_RPM, 60),
  globalConcurrent: num(process.env.GLOBAL_CONCURRENT, 5),
  // per user — 0 = matikan
  userRpm: num(process.env.USER_RPM, 30),
  userConcurrent: num(process.env.USER_CONCURRENT, 3),
};

export const limitsEnabled = () => limits.globalRpm > 0 || limits.userRpm > 0;

/* ───────────────────────── middleware ───────────────────────── */

/**
 * Dipasang di /v1/* — menolak dengan 429 (format OpenAI) kalau kuota habis.
 * Selalu melepas slot concurrency, termasuk saat koneksi terputus.
 */
export function rateLimit() {
  return (req, res, next) => {
    const userKey = `u:${req.apiUser || req.ip}`;
    const globalKey = 'g:all';
    stats.total++;

    // 1. kuota global
    if (limits.globalRpm > 0) {
      const g = takeToken(globalKey, limits.globalRpm);
      if (!g.ok) {
        stats.blocked_rpm++;
        return tooMany(res, limits.globalRpm, g.retryAfter, 'global');
      }
    }

    // 2. kuota per user
    let userRemaining = null;
    if (limits.userRpm > 0) {
      const u = takeToken(userKey, limits.userRpm);
      if (!u.ok) {
        stats.blocked_rpm++;
        return tooMany(res, limits.userRpm, u.retryAfter, 'user');
      }
      userRemaining = u.remaining;
    }

    // info kuota — dikirim di semua respons sukses
    const effectiveLimit = limits.userRpm > 0 ? limits.userRpm : limits.globalRpm;
    if (effectiveLimit > 0) {
      res.set('X-RateLimit-Limit', String(effectiveLimit));
      if (userRemaining !== null) res.set('X-RateLimit-Remaining', String(userRemaining));
      res.set('X-RateLimit-Scope', limits.userRpm > 0 ? 'user' : 'global');
    }

    // 3. concurrency global
    if (limits.globalConcurrent > 0 && !acquireSlot(globalKey, limits.globalConcurrent)) {
      stats.blocked_concurrent++;
      return busy(res, limits.globalConcurrent, 'global');
    }

    // 4. concurrency per user
    const perUserSlot = limits.userConcurrent > 0;
    if (perUserSlot && !acquireSlot(userKey, limits.userConcurrent)) {
      if (limits.globalConcurrent > 0) releaseSlot(globalKey);
      stats.blocked_concurrent++;
      return busy(res, limits.userConcurrent, 'user');
    }

    // pastikan slot dilepas apa pun yang terjadi
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (limits.globalConcurrent > 0) releaseSlot(globalKey);
      if (perUserSlot) releaseSlot(userKey);
    };

    res.on('finish', release);
    res.on('close', release);
    res.on('error', release);

    next();
  };
}

function tooMany(res, limit, retryAfter, scope) {
  res.set('Retry-After', String(retryAfter));
  res.set('X-RateLimit-Limit', String(limit));
  res.set('X-RateLimit-Remaining', '0');
  res.set('X-RateLimit-Scope', scope);
  return res.status(429).json({
    error: {
      message:
        scope === 'global'
          ? `Layanan sedang padat (batas ${limit} request/menit). Coba lagi dalam ${retryAfter} detik.`
          : `Terlalu banyak request dari akunmu (batas ${limit}/menit). Coba lagi dalam ${retryAfter} detik.`,
      type: 'rate_limit_exceeded',
      code: 'rate_limit',
      retry_after: retryAfter,
      scope,
    },
  });
}

function busy(res, limit, scope) {
  res.set('Retry-After', '2');
  res.set('X-RateLimit-Concurrent', String(limit));
  return res.status(429).json({
    error: {
      message:
        scope === 'global'
          ? `Layanan sedang menangani banyak request sekaligus (maks ${limit}). Coba lagi sebentar.`
          : `Kamu punya ${limit} request berjalan sekaligus — tunggu salah satu selesai.`,
      type: 'rate_limit_exceeded',
      code: 'concurrency_limit',
      retry_after: 2,
      scope,
    },
  });
}

/* ───────────────────────── info & pembersihan ───────────────────────── */

export function limitsInfo() {
  return {
    ...limits,
    enabled: limitsEnabled(),
    blocked_rpm: stats.blocked_rpm,
    blocked_concurrent: stats.blocked_concurrent,
    total_requests: stats.total,
  };
}

/** Snapshot singkat untuk halaman status/dashboard. */
export function currentLoad() {
  return {
    active: concurrent.get('g:all') || 0,
    capacity: limits.globalConcurrent,
  };
}

// buang bucket yang sudah penuh lagi (mencegah memory bocor)
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    // sudah lebih dari 2 menit tidak dipakai dan token penuh → buang
    const limit = key === 'g:all' ? limits.globalRpm : limits.userRpm;
    if (limit > 0 && now - b.last > 120_000 && b.tokens >= limit - 0.5) {
      buckets.delete(key);
    }
  }
}, 60_000).unref?.();

export const _internal = { buckets, concurrent, stats }; // untuk pengujian
