// Playground test untuk admin — jalankan di VPS: node scripts/admin-pg.mjs
import 'dotenv/config';
import { auth } from '../server/firebase.js';
import { readFileSync, writeFileSync } from 'node:fs';

const rec = await auth.getUserByEmail('clovvalencied@gmail.com');
const ct = await auth.createCustomToken(rec.uid);
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: ct, returnSecureToken: true }),
});
const { idToken } = await r.json();

const pg = await fetch('http://127.0.0.1:8787/api/playground', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ model: 'glm-5.3-flash', prompt: 'Jelaskan apa itu API dalam 1 kalimat.', max_tokens: 350 }),
});
const data = await pg.json();
console.log(JSON.stringify(data, null, 1));
