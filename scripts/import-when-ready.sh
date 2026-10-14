#!/usr/bin/env bash
# Ekspor data Firestore begitu kuota hariannya pulih, lalu impor ke SQLite.
#
# Dipakai saat migrasi dari Firestore: kuota Spark (50k baca/hari) yang habis
# baru pulih tengah malam PT (07:00 UTC). Skrip ini menunggu sendiri, jadi
# bisa ditinggal jalan:
#
#   FIREBASE_SERVICE_ACCOUNT_PATH=/path/sa.json \
#     setsid nohup bash scripts/import-when-ready.sh data/firestore-export.json &
#
# Aman dijalankan berulang: kalau file ekspor sudah ada, langsung ke impor.
# Log ditulis ke data/import.log (di dalam dir skrip ini) + stdout.
set -uo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-data/firestore-export.json}"
LOG="data/import.log"
mkdir -p data
exec >>"$LOG" 2>&1

echo "[$(date -u +%FT%TZ)] import-when-ready mulai — target ekspor: $OUT"

if [ ! -s "$OUT" ]; then
  node scripts/export-firestore.js "$OUT" --watch || {
    echo "[$(date -u +%FT%TZ)] ekspor GAGAL — berhenti"
    exit 1
  }
else
  echo "[$(date -u +%FT%TZ)] ekspor sudah ada, langsung impor"
fi

node scripts/import-localdb.js "$OUT" || {
  echo "[$(date -u +%FT%TZ)] impor GAGAL"
  exit 1
}

# Isi celah: pembayaran yang terjadi SETELAH snapshot Firestore (hanya ada di
# Paymenku) tidak ikut terimpor — rekonstruksi ulang menambahkannya kembali.
node scripts/rebuild-from-paymenku.js --apply || echo "[$(date -u +%FT%TZ)] rebuild Paymenku dilewati (gagal)" 

echo "[$(date -u +%FT%TZ)] SELESAI — data Firestore sudah masuk SQLite"
