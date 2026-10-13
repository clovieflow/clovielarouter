# Aturan produksi (WAJIB dipatuhi sesi ini & selanjutnya)

- Jangan `git push`, deploy, restart systemd, atau ubah `.env` produksi sebelum user meminta EKSPLISIT ("deploy", "push ke produksi", dsb.).
- Jangan tulis ke Firestore produksi tanpa izin — termasuk seed data uji, hapus data, upsert user (login via token produksi ke server lokal juga menulis!).
- Verifikasi lokal: build hijau + baca CSS/markup CUKUP. Token produksi (scripts/get-token.mjs) JANGAN dipakai untuk browsing lokal lagi.
- Setelah ubahan lokal selesai: laporkan hasil, lalu TUNGGU perintah user untuk deploy.
