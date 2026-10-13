import 'dotenv/config';
import { auth } from '../server/firebase.js';

const rec = await auth.getUserByEmail('clovvalencied@gmail.com');
const ct = await auth.createCustomToken(rec.uid);
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: ct, returnSecureToken: true }),
});
const { idToken } = await r.json();
console.log(idToken);
