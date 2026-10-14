/**
 * Impor hasil `scripts/export-firestore.js` ke SQLite (server/localdb.js).
 *
 *   node scripts/import-localdb.js firestore-export.json [DB_PATH]
 *
 * Upsert per dokumen (coll,id) — TIDAK menghapus apa pun. Data yang dibuat
 * setelah server pindah ke SQLite (user baru, pembayaran baru) tetap aman.
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

let total = 0;
const importAll = sqlite.transaction(() => {
  for (const [coll, rows] of Object.entries(dump.collections || {})) {
    let n = 0;
    for (const row of rows) {
      put.run(coll, String(row.id), JSON.stringify(row.data ?? {}));
      n++;
      total++;
    }
    console.log(`  ${coll}: ${n}`);
  }
});
importAll();

console.log(`✓ impor selesai → ${dbPath} (${total} dokumen, ekspor dari ${dump.exported_at})`);
