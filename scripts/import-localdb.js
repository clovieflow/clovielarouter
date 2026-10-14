/**
 * Impor hasil `scripts/export-firestore.js` ke SQLite (server/localdb.js).
 *
 *   node scripts/import-localdb.js firestore-export.json [DB_PATH]
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

const file = process.argv[2] || 'firestore-export.json';
const dbPath = process.argv[3] || process.env.DB_PATH || 'data/cloviela.db';

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

let total = 0;
let dropped = 0;
const importAll = sqlite.transaction(() => {
  for (const [coll, rows] of Object.entries(dump.collections || {})) {
    const gone = dropProvisional.run(coll).changes; // buang hasil rekonstruksi utk koleksi ini
    dropped += gone;
    let n = 0;
    for (const row of rows) {
      put.run(coll, String(row.id), JSON.stringify(row.data ?? {}));
      n++;
      total++;
    }
    console.log(`  ${coll}: ${n}${gone ? ` (+${gone} provisional dibuang)` : ''}`);
  }
  const dangling = dropDanglingIndex.run().changes;
  if (dangling) console.log(`  index yatim dibersihkan: ${dangling}`);
});
importAll();

console.log(`✓ impor selesai → ${dbPath} (${total} dokumen, ekspor dari ${dump.exported_at})`);
