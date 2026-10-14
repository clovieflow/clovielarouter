/**
 * localdb.js — backend data lokal: SQLite dengan API ala Firestore.
 *
 * Kenapa pindah dari Firestore: kuota harian (Spark) jebol karena polling
 * status pembayaran — begitu jebol, SEMUA baca mati sampai reset tengah
 * malam PT, produksi ikut mati. SQLite di VPS: tanpa kuota, tanpa biaya,
 * satu file yang gampang di-backup.
 *
 * Yang diimplementasi cuma subset API Firestore yang dipakai server
 * (lihat store.js + index.js), BUKAN emulator lengkap:
 *   collection().doc().get()/set({merge})/create()/update()/delete()
 *   collection().where(f,'==',v)[.where()].orderBy(f,dir).limit(n).get()
 *   collection().add(data), collectionGroup(name), batch(), runTransaction()
 *
 * Skema: satu tabel `docs(coll, id, data JSON)`;
 *   coll = path penuh, mis. 'users' atau 'users/<uid>/subscriptions'.
 *   Index ekspresi untuk field yang benar-benar dipakai di where/orderBy.
 *
 * Semantik yang sengaja disamakan dengan Firestore:
 *   - `set(data, {merge:true})` = merge dangkal (field top-level diganti).
 *   - nilai `undefined` dibuang saat simpan (setara ignoreUndefinedProperties).
 *   - `create()` gagal kalau dokumen sudah ada; `update()` gagal kalau belum ada.
 *   - id dokumen tidak boleh mengandung '/'.
 *
 * Catatan atomisitas: `runTransaction`/`batch` membungkus BEGIN..COMMIT.
 * Semua operasi tulis di dalamnya harus sinkron (tanpa await I/O asing) —
 * seluruh pemakaian di store.js memang begitu.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS docs (
  coll TEXT NOT NULL,
  id   TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (coll, id)
);
CREATE INDEX IF NOT EXISTS docs_uid      ON docs(coll, json_extract(data, '$.user_id'));
CREATE INDEX IF NOT EXISTS docs_status   ON docs(coll, json_extract(data, '$.status'));
CREATE INDEX IF NOT EXISTS docs_keyhash  ON docs(coll, json_extract(data, '$.key_hash'));
CREATE INDEX IF NOT EXISTS docs_provider ON docs(coll, json_extract(data, '$.provider_id'));
CREATE INDEX IF NOT EXISTS docs_enabled  ON docs(coll, json_extract(data, '$.enabled'));
`;

/** Buka (dan siapkan) file SQLite. `:memory:` juga boleh (untuk test). */
export function openLocalDb(path = process.env.DB_PATH || 'data/cloviela.db') {
  const file = path === ':memory:' ? path : resolve(path);
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec(SCHEMA_SQL);
  return sqlite;
}

/* ── util ─────────────────────────────────────────────────────── */

const segs = (p) => String(p).split('/').filter(Boolean);
const lastSeg = (p) => segs(p).at(-1);
const parentOf = (p) => segs(p).slice(0, -1).join('/');
const isoNow = () => new Date().toISOString();
const newId = () => randomBytes(10).toString('hex'); // 20 char, ala Firestore

/** Date/Timestamp server → ISO string; undefined → null (biar bisa di-bind). */
const normalize = (v) => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  return v;
};

/** Boolean → 1/0: better-sqlite3 tidak menerima boolean, json_extract memberi 1/0. */
const bind = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** Buang field undefined (setara `ignoreUndefinedProperties: true`). */
const clean = (data) => {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    const n = normalize(v);
    if (n !== undefined) out[k] = n;
  }
  return out;
};

const matches = (d, [field, op, value]) => {
  const a = d?.[field];
  switch (op) {
    case '==': return a === value;
    case '!=': return a !== value;
    case '>': return a > value;
    case '>=': return a >= value;
    case '<': return a < value;
    case '<=': return a <= value;
    case 'in': return Array.isArray(value) && value.includes(a);
    case 'array-contains': return Array.isArray(a) && a.includes(value);
    case 'array-contains-any': return Array.isArray(a) && Array.isArray(value) && a.some((x) => value.includes(x));
    default: throw new Error(`[localdb] operator where tidak didukung: ${op}`);
  }
};

/* ── API ──────────────────────────────────────────────────────── */

/**
 * @param {{ path?: string, sqlite?: import('better-sqlite3').Database }} [opts]
 * @returns db bergaya Firestore + `.sqlite` (handle mentah) untuk skrip migrasi.
 */
export function createLocalDb({ path, sqlite: given } = {}) {
  const sqlite = given || openLocalDb(path);

  const stmt = {
    get: sqlite.prepare('SELECT data FROM docs WHERE coll = ? AND id = ?'),
    all: sqlite.prepare('SELECT coll, id, data FROM docs WHERE coll = ?'),
    put: sqlite.prepare(
      'INSERT INTO docs (coll, id, data) VALUES (?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data'
    ),
    del: sqlite.prepare('DELETE FROM docs WHERE coll = ? AND id = ?'),
  };

  /* Antrean tulis: BEGIN..COMMIT tidak boleh tumpang tindih. */
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const run = () => fn();
    const p = chain.then(run, run);
    chain = p.then(() => {}, () => {});
    return p;
  };
  const atomic = (fn) =>
    exclusive(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn();
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        try { sqlite.exec('ROLLBACK'); } catch { /* sudah rollback */ }
        throw e;
      }
    });

  const readJson = (coll, id) => stmt.get.get(coll, id)?.data;

  const writeJson = (coll, id, data, merge) => {
    if (String(id).includes('/')) {
      throw new Error(`[localdb] id dokumen tidak boleh mengandung '/': ${id}`);
    }
    const cur = merge && readJson(coll, id) !== undefined ? JSON.parse(readJson(coll, id)) : null;
    stmt.put.run(coll, id, JSON.stringify(cur ? { ...cur, ...clean(data) } : clean(data)));
  };

  class DocSnapshot {
    constructor(coll, id, json) { this._coll = coll; this.id = id; this._json = json; }
    get exists() { return this._json !== undefined; }
    data() { return this._json === undefined ? undefined : JSON.parse(this._json); }
    get ref() { return new DocRef(`${this._coll}/${this.id}`); }
  }

  class QuerySnapshot {
    constructor(docs) { this.docs = docs; }
    get size() { return this.docs.length; }
    get empty() { return this.docs.length === 0; }
    forEach(fn) { this.docs.forEach(fn); }
    [Symbol.iterator]() { return this.docs[Symbol.iterator](); }
  }

  class DocRef {
    constructor(path) { this.path = path; }
    get id() { return lastSeg(this.path); }
    get coll() { return parentOf(this.path); }
    get parent() { return new CollectionRef(this.coll); }
    async get() { return new DocSnapshot(this.coll, this.id, readJson(this.coll, this.id)); }
    async set(data, opts = {}) { writeJson(this.coll, this.id, data, !!opts.merge); }
    async update(data) {
      if (readJson(this.coll, this.id) === undefined) {
        throw Object.assign(new Error(`[localdb] update: dokumen tidak ada (${this.path})`), { code: 'not-found' });
      }
      writeJson(this.coll, this.id, data, true);
    }
    async create(data) {
      if (readJson(this.coll, this.id) !== undefined) {
        throw Object.assign(new Error(`[localdb] create: dokumen sudah ada (${this.path})`), { code: 'already-exists' });
      }
      writeJson(this.coll, this.id, data, false);
    }
    async delete() { stmt.del.run(this.coll, this.id); }
  }

  class Query {
    constructor(coll, { group = null, conds = [], order = null, lim = null } = {}) {
      this.coll = coll;
      this.group = group;
      this.conds = conds;
      this.order = order;
      this.lim = lim;
    }
    where(field, op, value) {
      return new Query(this.coll, { group: this.group, conds: [...this.conds, [field, op, value]], order: this.order, lim: this.lim });
    }
    orderBy(field, dir = 'asc') {
      return new Query(this.coll, { group: this.group, conds: this.conds, order: { field, dir }, lim: this.lim });
    }
    limit(n) {
      return new Query(this.coll, { group: this.group, conds: this.conds, order: this.order, lim: n });
    }
    async get() {
      const where = [];
      const params = [];
      if (this.group) {
        where.push('(coll = ? OR coll LIKE ?)');
        params.push(this.group, `%/${this.group}`);
      } else {
        where.push('coll = ?');
        params.push(this.coll);
      }
      // Prefilter di SQL untuk '==' (kena index), keputusan akhir di JS
      // supaya semantiknya persis (tipe & operator apa pun).
      for (const [field, op, value] of this.conds) {
        if (op === '==') {
          where.push('json_extract(data, ?) = ?');
          params.push(`$.${field}`, bind(normalize(value)));
        }
      }
      let sql = `SELECT coll, id, data FROM docs WHERE ${where.join(' AND ')}`;
      if (this.order) {
        sql += ` ORDER BY json_extract(data, ?) ${this.order.dir === 'desc' ? 'DESC' : 'ASC'}`;
        params.push(`$.${this.order.field}`);
      }
      if (this.lim != null) {
        sql += ' LIMIT ?';
        params.push(this.lim);
      }
      const docs = sqlite
        .prepare(sql)
        .all(...params)
        .filter((row) => this.conds.every((c) => matches(JSON.parse(row.data), c)))
        .map((row) => new DocSnapshot(row.coll, row.id, row.data));
      return new QuerySnapshot(docs);
    }
  }

  class CollectionRef extends Query {
    constructor(path) { super(path); }
    get id() { return lastSeg(this.coll); }
    get parent() { return new DocRef(parentOf(this.coll)); }
    doc(id) {
      if (this.group) throw new Error('[localdb] doc() tidak tersedia di collectionGroup');
      return new DocRef(`${this.coll}/${id ?? newId()}`);
    }
    async add(data) {
      const ref = this.doc();
      await ref.set(data);
      return ref;
    }
  }

  class WriteBatch {
    constructor() { this.ops = []; }
    set(ref, data, opts) { this.ops.push(() => ref.set(data, opts)); return this; }
    update(ref, data) { this.ops.push(() => ref.update(data)); return this; }
    delete(ref) { this.ops.push(() => ref.delete()); return this; }
    commit() { return atomic(async () => { for (const op of this.ops) await op(); }); }
  }

  const db = {
    /** Firestore: ignoreUndefinedProperties dsb — di sini tidak relevan. */
    settings() {},
    collection(path) { return new CollectionRef(path); },
    collectionGroup(name) { return new Query(null, { group: name }); },
    batch() { return new WriteBatch(); },
    runTransaction(fn) {
      return atomic(() => {
        const tx = {
          get: (ref) => ref.get(),
          set: (ref, data, opts) => ref.set(data, opts),
          update: (ref, data) => ref.update(data),
          delete: (ref) => ref.delete(),
        };
        return fn(tx);
      });
    },
    /** Handle mentah — dipakai skrip migrasi/impor. */
    sqlite,
  };

  return db;
}

export { isoNow as nowIso };
