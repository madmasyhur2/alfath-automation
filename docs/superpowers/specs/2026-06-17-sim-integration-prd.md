# PRD — Integrasi Bot Telegram Al-Fath ↔ SIM-Madrasah

| | |
|---|---|
| **Produk** | Al-Fath Automation (Bot Telegram) — sumber data = SIM-Madrasah |
| **Versi Dokumen** | 1.0 |
| **Tanggal** | 2026-06-17 |
| **Status** | Draft — menunggu review |
| **Dokumen pasangan** | `2026-06-17-sim-backed-telegram-bot-design.md` (desain & alur) |
| **Sistem sumber** | `sim-madrasah-alfath` — Next.js · Go (chi) · MySQL |

> **Tujuan dokumen ini:** menjadi **kontrak integrasi** yang stabil antara bot
> Telegram (via n8n) dan SIM-Madrasah. Dokumen ini menurunkan kebutuhan dari
> **skema & API SIM yang sudah ada**, lalu mendefinisikan penambahan minimal pada
> SIM dan aturan pemetaan data yang harus dipatuhi agen pengimplementasi.
> Desain alur percakapan & arsitektur n8n ada di dokumen pasangan.

---

## 1. Ringkasan & Latar Belakang

Bot Al-Fath versi lama (sudah jadi & teruji) menulis ke **Google Sheets** dan
menampilkan dashboard via Looker Studio. Keputusan baru:

- **Sumber data tunggal pindah ke SIM-Madrasah (MySQL via REST API Go).** Sheets
  **dipensiunkan**. Setiap perubahan dari bot langsung tampil di web SIM, dan
  sebaliknya — satu sumber kebenaran.
- **Looker Studio dibatalkan** — dashboard SIM menjadi satu-satunya tampilan.
- Bot adalah **jalan "mudah"** untuk memasukkan data SIM: guru cukup lewat
  Telegram (absen, input nilai, dst.) tanpa harus login ke web SIM.

Bot **tidak** mengakses MySQL secara langsung. Semua baca/tulis lewat **REST API
SIM** agar validasi, business logic, transaksi, dan audit (`created_by`) SIM tetap
berlaku dan tidak terduplikasi.

---

## 2. Prinsip Integrasi

1. **API sebagai satu-satunya pintu.** n8n memanggil `https://<domain-sim>/api/v1/...`.
   Tidak ada query MySQL langsung dari n8n.
2. **Atribusi per-guru.** Setiap aksi tercatat atas nama akun SIM guru yang
   bersangkutan (`created_by`), bukan satu akun bersama. Lihat §4.
3. **SIM adalah sumber kebenaran skema.** Saat model bot lama berbeda dari SIM,
   **bot menyesuaikan SIM** (lihat aturan rekonsiliasi §6).
4. **Perubahan SIM seminimal mungkin tapi bersih.** Penambahan pada SIM
   (kolom/endpoint/tabel) didefinisikan eksplisit di §5; tidak ada perubahan diam-diam.
5. **Logika murni tetap teruji.** Pola lama dipertahankan: fungsi parsing/format/
   validasi murni hidup di `src/` dengan `node:test`; n8n Code node menyalinnya.

---

## 3. Entitas SIM yang Dipakai Bot

Diturunkan dari migrasi `001_init.sql`, `004_spp.sql`, `005_kitab.sql`,
`006_mapping_libur_status.sql`.

| Entitas | Tabel | Peran dalam bot |
|---|---|---|
| Pengguna (guru/admin) | `users` (`id, username, password_hash, nama, role, is_active`) | Identitas & atribusi. **+ kolom baru `telegram_user_id`** (§5.1) |
| Periode | `periode` (`id, nama, tahun_ajaran, semester, is_active`) | Periode penilaian; bot pakai **yang `is_active=1`** |
| Kelas | `kelas` (`id, nama, tingkat, wali_id, aktif`) | Pilihan kelas; `wali_id` = wali kelas (FK `users`) |
| Santri | `santri` (`id, nis, nama, jenis_kelamin, no_ortu, kelas_id, is_active`) | Roster; bot menampilkan **nama**, menyimpan **id numerik** |
| Mata pelajaran | `mata_pelajaran` (`id, kode, nama, kitab`) | Pilihan mapel untuk `/nilai` |
| Pemetaan mapel-kelas | `kelas_mapel` (`kelas_id, mata_pelajaran_id, kitab, urutan`) | Daftar mapel **per kelas** untuk `/nilai` |
| Absensi | `absensi` (`santri_id, tanggal, status, keterangan, created_by`) — unik `(santri_id, tanggal)` | Target `/absen` |
| Nilai | `nilai` (`santri_id, mata_pelajaran_id, periode_id, tugas, uts, uas, nilai_akhir, created_by`) — unik `(santri_id, mapel, periode)` | Target `/nilai` |
| Tugas rinci | **tabel baru `nilai_tugas`** (§5.3) | Riwayat Tugas ke-1..n |
| SPP | `spp` (`santri_id, tahun, bulan, lunas, nominal, tanggal_bayar, ...`) — unik `(santri_id, tahun, bulan)` | Fase C (toggle admin) |
| Hari libur | `hari_libur` (`tanggal, keterangan`) | Fase C (skip reminder di hari libur) |
| Catatan santri | **tabel baru `catatan`** (§5.4) | Fase B (`/catatan`) |
| Tugas/PR diumumkan | **tabel baru `tugas`** (§5.4) | Fase B (`/tugas`) |

**Status absensi SIM (enum):** `hadir`, `izin`, `sakit`, `alpha` — **tidak ada
"terlambat"**. **Bobot nilai akhir SIM:** `Tugas 30% + UTS 30% + UAS 40%`,
dihitung server.

---

## 4. Autentikasi & Otorisasi Bot

### 4.1 Mekanisme (login-bot)

SIM saat ini: `POST /auth/login` mengembalikan JWT **hanya via cookie `sim_token`**
(HttpOnly) — tidak praktis untuk n8n. Middleware `RequireAuth` **sudah menerima
`Authorization: Bearer <jwt>`** selain cookie. Maka:

- **FR-AUTH-1 — Kolom identitas.** Tambah `users.telegram_user_id BIGINT NULL
  UNIQUE` (§5.1). Inilah yang memetakan pengirim Telegram → akun SIM.
- **FR-AUTH-2 — Endpoint login-bot.** Tambah `POST /api/v1/auth/bot-login`:
  - Body: `{ "bot_secret": "<rahasia>", "telegram_user_id": 123456789 }`.
  - Validasi `bot_secret` == env `BOT_SHARED_SECRET` (konstanta-time compare). Bila
    salah → `401 BOT_UNAUTHORIZED`.
  - Cari `users` dengan `telegram_user_id` cocok & `is_active=1`. Bila tak ada →
    `403 NOT_REGISTERED`.
  - Sukses → terbitkan JWT (sama seperti `GenerateToken`) dan **kembalikan token di
    BODY** agar n8n bisa memakainya sebagai Bearer:
    ```json
    { "token": "<jwt>", "user": { "id": 7, "username": "ust_ahmad", "nama": "Ustadz Ahmad", "role": "guru" } }
    ```
  - Endpoint ini **tidak menyetel cookie** dan tidak terkena rate-limit login biasa
    (atau diberi rate-limit longgar tersendiri).
- **FR-AUTH-3 — Pemakaian token.** n8n menyertakan `Authorization: Bearer <token>`
  pada setiap panggilan berikutnya dalam sesi percakapan. Token kedaluwarsa
  mengikuti `JWT_EXPIRY_MINUTES` SIM (60–120 mnt) → n8n login-bot ulang bila perlu.
- **FR-AUTH-4 — Guard identitas.** Pengirim yang `telegram_user_id`-nya tidak
  terdaftar/akun nonaktif → balasan sopan "Maaf, Anda belum terdaftar." dan alur
  berhenti sebelum aksi apa pun.

### 4.2 Otorisasi (peran)

- **`/absen`** — boleh untuk **semua guru** atas **kelas mana pun** (mengikuti
  kebijakan SIM yang permisif: guru tidak dibatasi kelas ampu). Default kelas yang
  ditawarkan = kelas tempat guru menjadi `wali_id`, namun guru boleh menyebut kelas
  lain via `/absen [nama kelas]`.
- **`/nilai`** — semua guru, kelas/mapel mana pun (sesuai SIM).
- **`/spp` toggle & flow admin** (Fase C) — hanya `role='admin'` (SIM sudah membatasi
  endpoint SPP & master ke admin; bot mengikuti).
- Otorisasi sebenarnya **ditegakkan oleh SIM** (middleware `RequireRole`). Bot hanya
  menyembunyikan menu yang tidak relevan agar UX rapi; SIM tetap menolak bila tak berhak.

---

## 5. Penambahan pada SIM (definisi eksplisit)

> Semua perubahan ini adalah bagian dari pekerjaan dan harus konsisten dengan gaya
> kode SIM (handler → query, `httpx.JSON`/`httpx.Error`, migrasi `007_*.sql` dst.).

### 5.1 Migrasi: kolom telegram (Fase A)
```sql
-- 007_telegram.sql
USE sim_madrasah;
ALTER TABLE users ADD COLUMN telegram_user_id BIGINT NULL UNIQUE AFTER role;
```
- Admin mengisi `telegram_user_id` lewat CRUD user SIM (tambah field di form user web)
  atau seed. (Penambahan field form user web = pekerjaan kecil frontend, Fase A.)

### 5.2 Endpoint: login-bot (Fase A)
- `POST /api/v1/auth/bot-login` — lihat §4.1. Diletakkan di grup publik (tanpa
  `RequireAuth`), divalidasi via `BOT_SHARED_SECRET` (tambah ke `config` + `.env`).

### 5.3 Migrasi + endpoint: Tugas rinci (Fase A)
```sql
-- 008_nilai_tugas.sql
USE sim_madrasah;
CREATE TABLE IF NOT EXISTS nilai_tugas (
  id                BIGINT PRIMARY KEY AUTO_INCREMENT,
  santri_id         BIGINT NOT NULL,
  mata_pelajaran_id BIGINT NOT NULL,
  periode_id        BIGINT NOT NULL,
  ke                INT    NOT NULL,            -- Tugas ke-1, ke-2, ...
  nilai             DECIMAL(5,2) NOT NULL,      -- 0..100
  created_by        BIGINT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_nilai_tugas (santri_id, mata_pelajaran_id, periode_id, ke),
  CONSTRAINT fk_nt_santri  FOREIGN KEY (santri_id) REFERENCES santri(id) ON DELETE CASCADE,
  CONSTRAINT fk_nt_mapel   FOREIGN KEY (mata_pelajaran_id) REFERENCES mata_pelajaran(id),
  CONSTRAINT fk_nt_periode FOREIGN KEY (periode_id) REFERENCES periode(id),
  CONSTRAINT fk_nt_user    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
```
**Aturan turunan (WAJIB):**
- Setelah setiap tulis ke `nilai_tugas` untuk `(santri, mapel, periode)`, server
  **menghitung ulang** `nilai.tugas = AVG(nilai_tugas.nilai)` lalu
  `nilai.nilai_akhir = tugas·0.3 + uts·0.3 + uas·0.4` (memakai `HitungNilaiAkhir`).
  Operasi upsert baris `nilai` dalam satu transaksi.
- Kolom `nilai.tugas` menjadi **turunan** (rata-rata). Lihat §6.5 untuk konsekuensi
  pada input Tugas via web.

**Endpoint baru:**
| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/nilai/tugas?kelas_id=&mata_pelajaran_id=&periode_id=` | Per santri: daftar `{ke, nilai}` + `rata`. Juga kembalikan `next_ke` (= max(ke)+1, atau 1) untuk auto-increment bot |
| POST | `/nilai/tugas/batch` | Simpan satu Tugas ke-`ke` untuk satu kelas+mapel+periode (upsert per santri), lalu re-average. Body di bawah |

```json
// POST /nilai/tugas/batch
{
  "kelas_id": 3, "mata_pelajaran_id": 5, "periode_id": 1,
  "ke": 3,                                  // opsional; bila kosong = next_ke
  "items": [ { "santri_id": 10, "nilai": 80 }, { "santri_id": 11, "nilai": 75 } ]
}
// → 200 { "saved": 2, "ke": 3 }
```

### 5.4 Migrasi + endpoint: Catatan & Tugas (Fase B)
```sql
-- 009_catatan_tugas.sql (Fase B)
USE sim_madrasah;
CREATE TABLE IF NOT EXISTS catatan (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  santri_id BIGINT NOT NULL,
  tanggal DATE NOT NULL,
  teks VARCHAR(500) NOT NULL,
  created_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_catatan_santri FOREIGN KEY (santri_id) REFERENCES santri(id) ON DELETE CASCADE,
  CONSTRAINT fk_catatan_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_catatan_santri (santri_id), INDEX idx_catatan_tanggal (tanggal)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tugas (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  kelas_id BIGINT NOT NULL,
  mata_pelajaran_id BIGINT NULL,
  deskripsi VARCHAR(500) NOT NULL,
  tanggal_diberikan DATE NOT NULL,
  tenggat DATE NULL,
  created_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tugas_kelas FOREIGN KEY (kelas_id) REFERENCES kelas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tugas_mapel FOREIGN KEY (mata_pelajaran_id) REFERENCES mata_pelajaran(id),
  CONSTRAINT fk_tugas_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
```
Endpoint: `GET/POST /catatan`, `GET/POST /tugas` (detail body & query menyusul di
plan Fase B; di luar lingkup detail v-sekarang).

### 5.5 Perubahan handler nilai (komponen-aware, Fase A)
`POST /nilai/batch` saat ini meng-upsert `tugas/uts/uas` **sekaligus** — bila bot
hanya mengirim UTS, kolom Tugas/UAS akan tertimpa NULL. **Wajib diubah** menjadi
**komponen-aware**: hanya komponen yang dikirim (non-null) yang di-update; komponen
lain dipertahankan. Bot mengirim UTS/UAS lewat endpoint ini (lihat §6.4); Tugas
**tidak** lewat sini melainkan lewat `/nilai/tugas/batch` (§5.3).

---

## 6. Aturan Pemetaan & Rekonsiliasi Data

### 6.1 ID & tampilan
- Bot **selalu menampilkan nama** (santri/kelas/mapel), **menyimpan id numerik** SIM.
- Resolusi nama→id lewat API: `GET /kelas?aktif=1` (cocokkan `nama`),
  `GET /santri?kelas_id=` (roster), `GET /kelas/{id}/mapel` (mapel per kelas).
- Nama kelas dicocokkan **case-insensitive & trim** (mis. "4a" → kelas `4A`). Bila
  ambigu/tak ketemu → bot menampilkan daftar pilihan, tidak menebak.

### 6.2 Tanggal & zona waktu
- Zona waktu **Asia/Jakarta (WIB)**. `tanggal` absensi format `YYYY-MM-DD`, default
  hari ini (WIB). Sesuai perilaku `GetAbsensi`/`SaveAbsensi` SIM.

### 6.3 Absensi — status & "Terlambat"
- Status valid yang dikirim ke SIM: **`hadir` | `izin` | `sakit` | `alpha`**.
- **"Terlambat" dipetakan ke `hadir`** dengan `keterangan` diisi penanda, mis.
  `"Terlambat 18:10"`. Tidak menambah enum SIM, tidak mengubah math dashboard SIM.
- Tombol status di bot: **Hadir / Sakit / Izin / Alpha** (4 tombol). Default semua
  Hadir; guru hanya mengubah yang perlu (model exception tetap, kini lewat tombol).
- Simpan = `POST /absensi/batch` (upsert per `(santri, tanggal)`), satu transaksi.
  Bot **mengirim seluruh kelas** (termasuk yang Hadir) agar konsisten dengan UI batch SIM.

### 6.4 Nilai — UTS & UAS
- Model SIM: satu nilai per `(santri, mapel, periode)`. UTS & UAS masing-masing **satu
  nilai** (timpa bila diisi ulang).
- Entri UTS/UAS via `POST /nilai/batch` **komponen-aware** (§5.5): kirim hanya
  komponen terpilih. Rentang 0–100, boleh desimal, boleh kosong.
- `periode` = periode `is_active=1` (dari `GET /periode`). Bot tidak meminta periode
  ke guru kecuali tidak ada periode aktif (kasus tepi → minta admin set periode aktif).

### 6.5 Nilai — Tugas (riwayat ke-1..n)
- Entri Tugas via `POST /nilai/tugas/batch` (§5.3). Bot mengambil `next_ke` dari
  `GET /nilai/tugas` → menampilkan "Tugas ke-N", auto-increment.
- `nilai.tugas` = rata-rata otomatis baris `nilai_tugas`; feed ke `nilai_akhir`.
- **Riwayat ditampilkan di tiga lapis:** bot (`GET /nilai/tugas`), API, dan **web SIM**
  (rincian T1..Tn — penambahan frontend, Fase A).
- **Konsekuensi konsistensi dua-penulis:** input Tugas di **web SIM juga harus lewat
  tabel detail** (web menulis `nilai_tugas` lalu re-average), bukan langsung ke kolom
  `nilai.tugas`. Disepakati: kolom `nilai.tugas` bersifat read-only/turunan di seluruh
  sistem. UTS/UAS tetap kolom langsung.

### 6.6 Catatan & Tugas (Fase B)
- `/catatan`: pilih santri → teks → `POST /catatan` (`created_by` = guru).
- `/tugas`: pilih kelas (+ mapel opsional) → deskripsi → tenggat → `POST /tugas`.
- Detail lengkap di plan Fase B.

---

## 7. Ringkasan Endpoint API yang Dipakai Bot

Base: `/api/v1`. Auth: `Authorization: Bearer <jwt>` (kecuali `bot-login`).
Envelope sukses = objek/array langsung; error = `{ "error": { "code", "message" } }`.

| Fase | Method | Endpoint | Dipakai untuk |
|---|---|---|---|
| A | POST | `/auth/bot-login` *(baru)* | Tukar telegram_id+secret → JWT guru |
| A | GET | `/auth/me` | Verifikasi sesi (opsional) |
| A | GET | `/kelas?aktif=1` | Resolusi & daftar kelas |
| A | GET | `/santri?kelas_id=&q=` | Roster kelas |
| A | GET | `/kelas/{id}/mapel` | Mapel per kelas (`/nilai`) |
| A | GET | `/periode` | Ambil periode aktif |
| A | GET | `/absensi?kelas_id=&tanggal=` | Status absen saat ini (prefill) |
| A | POST | `/absensi/batch` | Simpan absensi kelas |
| A | GET | `/nilai?kelas_id=&mata_pelajaran_id=&periode_id=` | Nilai saat ini (prefill UTS/UAS) |
| A | POST | `/nilai/batch` *(jadi komponen-aware)* | Simpan UTS/UAS |
| A | GET | `/nilai/tugas?...` *(baru)* | Riwayat Tugas + `next_ke` |
| A | POST | `/nilai/tugas/batch` *(baru)* | Simpan Tugas ke-x |
| A | GET | `/santri/{id}/detail?periode_id=` | Rekap absen+nilai 1 santri (read-only) |
| A | GET | `/dashboard/summary?...` | Ringkasan (read-only, opsional) |
| B | GET/POST | `/catatan` *(baru)* | `/catatan` |
| B | GET/POST | `/tugas` *(baru)* | `/tugas` |
| C | GET | `/spp?...`, POST `/spp/toggle` | Toggle SPP (admin) |
| C | GET | `/hari-libur` | Skip reminder hari libur |

---

## 8. Kebutuhan Non-Fungsional

| Kategori | Kebutuhan |
|---|---|
| **Keamanan** | `BOT_SHARED_SECRET` panjang & rahasia (env, jangan di-commit). HTTPS wajib. JWT pendek + login-bot ulang. Tidak menyimpan password guru di n8n. |
| **Atribusi/Audit** | Semua tulis membawa `created_by` = akun guru (via JWT login-bot). |
| **Konsistensi** | Operasi simpan SIM transaksional (sudah). `nilai.tugas` turunan dari `nilai_tugas`. |
| **Ketersediaan** | Bila API SIM tak terjangkau, bot membalas pesan gagal yang jelas; tidak menyimpan separuh data. |
| **Lokalitas** | WIB. Antarmuka Bahasa Indonesia. |
| **Maintainability** | Logika murni di `src/` + `node:test`; n8n Code node = salinan. Migrasi SIM terversion (`007_`, `008_`, `009_`). |
| **Kompatibilitas** | Tidak merusak web SIM maupun perilaku API yang sudah ada (kecuali `/nilai/batch` yang dibuat komponen-aware secara backward-compatible). |

---

## 9. Lingkup & Fase

- **Fase A — Migrasi inti:** `telegram_user_id`, `bot-login`, `/nilai/batch`
  komponen-aware, `nilai_tugas` + endpoint + re-average, rincian Tugas di web SIM,
  serta bot: guard identitas, `/absen`, `/nilai` (Tugas/UTS/UAS), `/daftar`, `/menu`,
  lookup read-only. Pensiunkan Sheets. **Dapat dirilis & diuji mandiri.**
- **Fase B — Catatan & Tugas:** tabel + endpoint SIM; bot `/catatan`, `/tugas`.
- **Fase C — SPP & Reminder:** toggle SPP (admin); mesin reminder (nudge absensi,
  rekap mingguan, SPP, tugas-diberikan) membaca API SIM; hormati `hari_libur`.

Tiap fase punya **plan implementasi** tersendiri (lihat dokumen pasangan & writing-plans).

---

## 10. Di Luar Lingkup (Non-Goals)

- Akses MySQL langsung dari n8n.
- Migrasi data historis dari Google Sheets ke SIM (kecuali diminta terpisah).
- Pesan WhatsApp langsung ke orang tua (reminder tetap "draft untuk diteruskan guru").
- Mengubah model bobot nilai SIM (tetap 30/30/40).
- Self-registration guru via bot (akun & `telegram_user_id` dibuat admin).

---

## 11. Pertanyaan Terbuka (untuk dikonfirmasi saat review)

1. **Penegakan peran `/absen`:** v-sekarang permisif (semua guru, semua kelas) sesuai
   SIM. Perlukah dibatasi ke wali kelas saja? (Asumsi: tidak.)
2. **Web SIM input Tugas:** apakah form input Tugas di web SIM diubah sekarang (Fase A)
   agar menulis lewat `nilai_tugas`, atau cukup menampilkan rincian dulu & input Tugas
   hanya via bot sementara? (Asumsi PRD: ubah agar konsisten — §6.5.)
3. **Penyimpanan state percakapan n8n:** static data n8n vs tabel `bot_session` di
   MySQL. (Dibahas di dokumen desain; default: static data n8n.)
4. **Penanda "Terlambat":** format keterangan baku, mis. `"Terlambat HH:MM"`? (Asumsi: ya.)

---

*Dokumen ini adalah kontrak baseline. Perbarui seiring keputusan teknis & masukan stakeholder.*
