/**
 * Seed contoh: 1 provider custom + 2 model di Firestore.
 * Jalankan: node scripts/seed.js
 *
 * Provider & model TIDAK di-hardcode — ini cuma contoh awal.
 * Tambah/ubah provider apa pun dari admin panel (/admin → Provider & Model).
 */
import 'dotenv/config';
import * as store from '../server/store.js';

const existing = await store.listModels();
if (existing.length) {
  console.log('Sudah ada model, seed dilewati. Total:', existing.length);
  process.exit(0);
}

const prov = await store.createProvider({
  name: 'Provider Custom',
  base_url: 'https://api.contoh.dev/v1',
  api_key: 'sk-contoh',
  notes: 'contoh — ganti dari admin panel',
});

await store.createModel({
  model_id: 'model-cepat-1',
  label: 'Model Cepat 1',
  provider_id: prov.id,
  description: 'model contoh dari provider custom',
});

await store.createModel({
  model_id: 'model-kuat-1',
  label: 'Model Kuat 1',
  provider_id: prov.id,
  description: 'model contoh kedua',
});

const models = await store.listModels();
console.log(JSON.stringify(models.map((m) => ({
  model: m.model_id,
  provider: m.provider_name,
  enabled: m.enabled,
})), null, 1));
