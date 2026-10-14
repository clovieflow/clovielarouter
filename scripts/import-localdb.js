/**
 * Impor hasil `scripts/export-firestore.js` ke SQLite (server/localdb.js).
 *
 *   node scripts/import-localdb.js firestore-export.json [DB_PATH] [--dry]
 *
 *   --dry  pratinjau saja: hitung dokumen baru vs yang akan diganti,
 *          tanpa menulis apa pun ke database.
 *
 * Aturan tulis:
 *   - upsert per dokumen (coll,id) — data yang dibuat setelah pindah ke
 *     SQLite (user baru) tetap aman karena tidak ada di ekspor;
 *   - baris `provisional: true` (hasil rekonstruksi Paymenku) DIBUANG lebih
 *     dulu untuk koleksi yang ada di ekspor — digantikan data Firestore;
 *   - index (trx_index/ref_index) yang menunjuk pembayaran provisional yang
 *     sudah hilang ikut dibersihkan.
 */
import { readFileSync, existsSync } from 'node:fs';
import { openLocalDb } from '../server/localdb.js';

const args = process.argv.slice(2).filter((a) => a !== '--dry');
const DRY = process.argv.includes('--dry');
const file = args[0] || 'firestore-export.json';
const dbPath = args[1] || process.env.DB_PATH || 'data/cloviela.db';

if (!existsSync(file)) {
  console.error(`✗ file ekspor tidak ada: ${file}`);
  process.exit(1);
}

const dump = JSON.parse(readFileSync(file, 'utf8'));
const sqlite = openLocalDb(dbPath);

const put = sqlite.prepare(
  'INSERT INTO docs (coll, id, data) VALUES (?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data'
);
const dropProvisional = sqlite.prepare(
  "DELETE FROM docs WHERE coll = ? AND json_extract(data, '$.provisional') = 1"
);
const dropDanglingIndex = sqlite.prepare(`
  DELETE FROM docs
   WHERE coll IN ('trx_index', 'ref_index')
     AND json_extract(data, '$.paymentId') LIKE 'prov_%'
     AND NOT EXISTS (
       SELECT 1 FROM docs p
        WHERE p.coll LIKE '%/payments' AND p.id = json_extract(docs.data, '$.paymentId')
     )
`);

const exists = sqlite.prepare('SELECT 1 FROM docs WHERE coll = ? AND id = ?');
let total = 0;
let replaced = 0;
let dropped = 0;

const importAll = sqlite.transaction(() => {
  for (const [coll, rows] of Object.entries(dump.collections || {})) {
    const gone = DRY ? 0 : dropProvisional.run(coll).changes; // buang hasil rekonstruksi utk koleksi ini
    dropped += gone;
    let n = 0;
    let rep = 0;
    for (const row of rows) {
      const id = String(row.id);
      if (exists.get(coll, id)) rep++;
      if (!DRY) put.run(coll, id, JSON.stringify(row.data ?? {}));
      n++;
      total++;
    }
    replaced += rep;
    console.log(`  ${coll}: ${n}${rep ? ` (${rep} menimpa yang sudah ada)` : ''}${gone ? ` (+${gone} provisional dibuang)` : ''}`);
  }
  if (!DRY) {
    const dangling = dropDanglingIndex.run().changes;
    if (dangling) console.log(`  index yatim dibersihkan: ${dangling}`);
  }
});
importAll();

if (DRY) {
  console.log(`\n[pratinjau] ${total} dokumen akan diimpor, ${replaced} di antaranya menimpa data sekarang, ${dropped} provisional dibuang.`);
  console.log('Tidak ada yang ditulis. Jalankan tanpa --dry kalau sudah yakin.');
  process.exit(0);
}

console.log(`✓ impor selesai → ${dbPath} (${total} dokumen, ekspor dari ${dump.exported_at})`);
