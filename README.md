# video-autopost

Template video 9:16 (Remotion) → render di Docker → upload otomatis ke YouTube Shorts dan Instagram Reels.

```
jobs/pending/*.json ──► render MP4 (Remotion di Docker) ──► YouTube  ──► jobs/done/
                                                       └──► Instagram
```

Cara kerjanya: tiap file JSON di `jobs/pending/` adalah satu video. Pipeline mengambil job tertua, merender, mengunggah ke target yang diminta, lalu memindahkan job ke `jobs/done/`. Kalau gagal, job dicoba lagi di run berikutnya (maksimal `MAX_ATTEMPTS`, lalu pindah ke `jobs/failed/`). Platform yang sudah berhasil tidak diunggah ulang.

## Status pengujian

Sudah dites: typecheck, render video 1080x1920, antrean job, retry, folder failed, dan logika upload Instagram (dengan server tiruan). **Belum dites ke API YouTube dan Instagram sungguhan**, karena butuh kredensialmu. Tes dulu dengan `private` (YouTube) dan akun uji.

## 1. Uji di lokal

```bash
npm install
npm run studio                  # preview + edit props lewat browser di localhost:3000
npm run render:test             # render contoh ke out/test.mp4
```

## 2. Uji render lewat Docker (lokal atau VPS)

```bash
cp .env.example .env
docker compose build            # pertama kali agak lama (mengunduh Chrome)
cp jobs/example.job.json jobs/pending/tes1.json   # target "mock": tidak upload ke mana pun
docker compose run --rm app
ls out jobs/done                # job pindah ke done
```

Hanya render tanpa upload: `docker compose run --rm app node scripts/pipeline.mjs --render-only`

Setelah mengubah kode di `src/`, jalankan `docker compose build` lagi. Musik/gambar di `public/` tidak perlu build ulang.

## 3. Kredensial YouTube

1. Google Cloud Console → buat project → aktifkan **YouTube Data API v3**.
2. OAuth consent screen: *External*, tambahkan scope `youtube.upload`, tambahkan emailmu sebagai test user.
3. Buat **OAuth Client ID** tipe *Desktop app*. Isi `YT_CLIENT_ID` dan `YT_CLIENT_SECRET` di `.env`.
4. Di komputer lokal: `npm run youtube:auth`, buka URL yang muncul, izinkan, lalu salin refresh token ke `YT_REFRESH_TOKEN`.
5. Ubah status consent screen dari *Testing* ke *In production* **sebelum** langkah 4. Di mode Testing, refresh token kedaluwarsa dalam 7 hari. Kalau sudah terlanjur, ulangi langkah 4 setelah status diubah.
6. **Audit:** video dari project API yang belum diaudit YouTube terkunci `private` apa pun nilai `YT_PRIVACY`. Ajukan audit lewat form YouTube API Services (Audit and Quota Extension) sebelum berharap video publik. Cek juga biaya kuota `videos.insert` di Cloud Console → Quotas, karena sumber yang kutemukan berbeda-beda.

## 4. Kredensial Instagram

Akun harus Professional (Creator/Business). Pilih salah satu jalur lewat `IG_LOGIN_TYPE`:

**`instagram` (default)**: Business Login for Instagram, tidak perlu Facebook Page.
- Buat app di Meta for Developers, tambahkan produk Instagram, minta permission `instagram_business_basic` dan `instagram_business_content_publish`.
- Buat token long-lived (60 hari), isi `IG_ACCESS_TOKEN`. Pipeline memperbaruinya otomatis (disimpan di `data/ig-token.json`).
- `npm run ig:whoami` menampilkan `IG_USER_ID` untuk diisi di `.env`.
- Video harus berada di URL yang bisa diunduh server Meta. Karena itu isi bagian `S3_*` (Cloudflare R2 / AWS S3 / lainnya). Bucket tidak perlu publik, pipeline memakai presigned URL dan menghapus file setelah selesai.

**`facebook`**: Facebook Login for Business, butuh Facebook Page.
- Permission `instagram_basic` dan `instagram_content_publish`, token Page di `IG_ACCESS_TOKEN`, ID akun Instagram di `IG_USER_ID`.
- Video diunggah langsung ke Meta (resumable upload), tanpa S3.

Batas Instagram: 100 post via API per 24 jam. Sebelum percaya penuh, tes dulu dengan akun uji.

## 5. Format job

```json
{
  "props": { "title": "...", "subtitle": "...", "points": ["...", "..."], "cta": "..." },
  "youtube": { "title": "...", "description": "...", "tags": ["..."] },
  "instagram": { "caption": "..." },
  "targets": ["youtube", "instagram"]
}
```

- `props` wajib (`title` dan `points`). Opsional: `subtitle`, `cta`, `accent`, `backgroundFrom`, `backgroundTo`, `audioSrc` (nama file di `public/`).
- `targets` opsional, default dari `DEFAULT_TARGETS`. Pilihan: `youtube`, `instagram`, `mock`.
- Durasi video = 3 detik intro + 4 detik per poin + 3 detik outro. Batas default 90 detik (`MAX_VIDEO_SECONDS`).

## 6. Jadwal otomatis di VPS

```bash
mkdir -p logs && crontab -e     # tempel isi deploy/crontab.example (ganti path-nya)
```

Cek hasil: `tail -f logs/cron.log`. Isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` kalau ingin notifikasi sukses/gagal.

## Urutan uji yang aman

1. `mock` di Docker (langkah 2) → 2. `targets: ["youtube"]` dengan `YT_PRIVACY=private` → 3. `targets: ["instagram"]` ke akun uji → 4. gabungkan → 5. pasang cron.

## Troubleshooting

| Gejala | Penyebab umum |
|---|---|
| `invalid_grant` di YouTube | Refresh token kedaluwarsa (consent screen masih *Testing*) atau dicabut. Jalankan ulang `youtube:auth`. |
| Video YouTube selalu private | Project API belum diaudit. |
| `quotaExceeded` | Kuota harian habis, reset tengah malam Pacific Time. |
| Render crash / kehabisan memori | Naikkan RAM VPS, tambah swap, atau kecilkan `RENDER_CONCURRENCY`. |
| Instagram `ERROR` saat polling | Cek format video dan URL publik/presigned bisa diakses dari luar. |
| Run tidak jalan karena lock | Ada run lain, atau hapus `data/pipeline.lock` kalau run sebelumnya mati mendadak (lock lama >3 jam otomatis dihapus). |
