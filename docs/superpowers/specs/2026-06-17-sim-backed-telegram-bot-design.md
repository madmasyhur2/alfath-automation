# Desain — Bot Telegram Al-Fath berbasis SIM-Madrasah

| | |
|---|---|
| **Tanggal** | 2026-06-17 |
| **Status** | Draft — menunggu review |
| **Dokumen pasangan** | `2026-06-17-sim-integration-prd.md` (kontrak data & API) |
| **Menggantikan** | `2026-06-15-school-monitoring-telegram-bot-design.md` (versi Sheets) |

> Dokumen ini menjelaskan **arsitektur, alur percakapan, dan rancangan n8n** bot
> versi baru yang sumber datanya adalah SIM-Madrasah. Kontrak data/endpoint &
> penambahan SIM ada di PRD pasangan; di sini fokus pada *bagaimana* bot bekerja.

---

## 1. Konteks & Perubahan dari Versi Lama

Versi lama (sudah jadi & teruji): Telegram → n8n → **Google Sheets** → Looker Studio,
perintah **stateless satu-pesan** (mis. ketik `2 S demam`), status absensi H/T/S/I/A.

Versi baru:
- **Sumber data = SIM-Madrasah** (MySQL via REST API Go). **Sheets pensiun, Looker
  dibatalkan** (dashboard SIM dipakai). Lihat PRD §1.
- **Interaksi menjadi berbasis tombol (inline keyboard) & stateful** — guru menekan
  tombol, bukan menghafal sintaks. Konsekuensinya n8n harus menyimpan **state
  percakapan**.
- Status absensi mengikuti SIM: **Hadir/Sakit/Izin/Alpha**; "Terlambat" = Hadir +
  keterangan (PRD §6.3).
- Nilai mengikuti SIM: Tugas (riwayat ke-1..n, rata-rata) + UTS + UAS, nilai akhir
  dihitung SIM.

---

## 2. Arsitektur

```
┌────────────┐   updates    ┌───────────────────┐   HTTPS / Bearer JWT   ┌──────────────┐
│  Telegram  │ ───────────▶ │  n8n (self-host)  │ ─────────────────────▶ │ SIM Go API   │ ─▶ MySQL
│  Bot       │ ◀─────────── │  - trigger        │ ◀───────────────────── │  /api/v1     │     ▲
└────────────┘  send msg /  │  - identity guard │      JSON               └──────────────┘     │
                inline kbd   │  - router/switch  │                          SIM Next.js web ────┘
                            │  - state store    │      (sumber kebenaran tunggal)
                            │  - command flows  │
                            └───────────────────┘
```

- **Satu bot Telegram**, prompt Bahasa Indonesia. Satu-satunya pintu input guru.
- **n8n**: menerima update, **login-bot** untuk dapat JWT guru, memvalidasi pengirim,
  merutekan perintah, menjaga state percakapan, memanggil API SIM, membalas.
- **SIM API**: validasi, transaksi, perhitungan, audit (`created_by`).
- **Tidak ada akses MySQL langsung** dari n8n.

### 2.1 Komponen logis n8n
1. **Telegram Trigger** — `message` + `callback_query` (untuk tombol).
2. **Identity & session bootstrap** — `bot-login` (PRD §4.1) → simpan `{jwt, user}` di
   state percakapan; bila gagal → balasan "belum terdaftar".
3. **Router** — bedakan `message` (perintah `/...` atau force-reply) vs
   `callback_query` (penekanan tombol), arahkan ke flow yang sesuai + state aktif.
4. **State store** — lihat §4.
5. **Command flows** — `/absen`, `/nilai`, `/daftar`, `/menu`, lookups (Fase A);
   `/catatan`, `/tugas` (B); `/spp`, reminder (C).
6. **API client** — sub-pola pemanggilan SIM (set header Bearer, tangani error envelope).

---

## 3. Model Interaksi (Inline Keyboard + State)

Berbeda dari versi lama yang stateless, alur baru **multi-langkah**. Setiap langkah:
- bot mengirim pesan + inline keyboard;
- guru menekan tombol → `callback_query` membawa `callback_data` ringkas (mis.
  `absen:set:<idx>:sakit`);
- n8n memuat state percakapan, menerapkan perubahan, memperbarui pesan (editMessageText)
  atau mengirim langkah berikutnya;
- input teks bebas (keterangan, nilai) lewat **force-reply**.

**Prinsip:** `callback_data` Telegram **maks 64 byte** → pakai indeks roster pendek
(`idx`) + kode aksi, bukan nama/UUID panjang. State menyimpan pemetaan `idx → santri_id`.

---

## 4. Penyimpanan State Percakapan

Setiap chat punya satu **sesi aktif** berisi: perintah berjalan, langkah,
`{jwt, user}`, konteks terpilih (`kelas_id`, `mata_pelajaran_id`, `periode_id`,
`komponen`, `ke`), roster (`idx→santri_id→nama`), dan akumulasi input (status/nilai/
keterangan per santri).

**Pilihan implementasi (default → alternatif):**
- **Default: n8n static data** (workflow static data, key = `chat_id`). Tanpa tabel
  tambahan, cukup untuk satu instans n8n. TTL sederhana (mis. sesi kedaluwarsa 30 mnt).
- **Alternatif: tabel `bot_session` di MySQL** (bila n8n multi-instans / butuh durabilitas).
  *Tidak* mengganggu skema akademik SIM; bisa ditambah belakangan.

Keputusan final dikonfirmasi saat review (PRD §11.3). Desain flow di bawah tidak
bergantung pada pilihan ini — hanya pada adanya operasi `loadSession/saveSession`.

---

## 5. Alur Perintah (Fase A)

### 5.0 Pintu masuk umum
Setiap update → **bootstrap**: bila belum ada sesi/jwt, jalankan `bot-login`
(`telegram_user_id` dari `message.from.id`/`callback_query.from.id`). Gagal → tolak.

### 5.1 `/menu`
Tampilkan perintah sesuai peran (`user.role`): guru → `/absen`, `/nilai`, `/daftar`;
admin → + `/spp` (Fase C). Teks ringkas + (opsional) tombol.

### 5.2 `/daftar [nama kelas]`
1. Resolusi kelas (PRD §6.1). Tak jelas → tampilkan tombol pilihan kelas.
2. `GET /santri?kelas_id=` → tampilkan roster bernomor (`formatRoster`).

### 5.3 `/absen [nama kelas]` — absensi harian (berbasis tombol)
1. **Resolusi kelas.** Ada argumen → cocokkan; kosong → tawarkan kelas wali guru +
   tombol kelas lain. Tak ketemu/ambigu → daftar tombol kelas.
2. **Muat roster & prefill.** `GET /santri?kelas_id=` dan `GET /absensi?kelas_id=&tanggal=hari_ini`
   (agar status yang sudah ada tampil). Bangun state `idx→santri`, status awal =
   yang tersimpan atau **default `hadir`**.
3. **Render papan absensi.** Pesan menampilkan tiap santri + status terkini, dengan
   inline keyboard per santri: `[Hadir] [Sakit] [Izin] [Alpha]` (tombol aktif ditandai,
   mis. ✅). `callback_data = absen:set:<idx>:<status>`. Plus tombol global:
   `[➕ Keterangan] [💾 Simpan] [✖ Batal]`.
   - Untuk kelas besar, render **per-halaman** (mis. 8 santri/halaman) + tombol
     `[◀] [▶]`. (Hindari melebihi batas tombol Telegram.)
4. **Ubah status.** Tekan status → update state → `editMessageText` papan.
5. **Keterangan (opsional).** Tekan `➕ Keterangan` → bot kirim daftar santri non-Hadir
   sebagai tombol → pilih santri → **force-reply** "Keterangan untuk <nama>? (ketik
   atau /lewati)". Teks tersimpan ke state. *"Terlambat"* dicatat di sini:
   keterangan `"Terlambat 18:10"` pada santri berstatus Hadir (PRD §6.3).
6. **Simpan.** Tekan `💾 Simpan` → susun `POST /absensi/batch` (seluruh kelas, semua
   status + keterangan) → tampilkan ringkasan: `✅ Tersimpan. 27 Hadir, 1 Sakit, 1 Izin,
   1 Alpha.` Bersihkan sesi.
7. **Error API** → pesan jelas, state dipertahankan agar guru bisa coba simpan lagi.

### 5.4 `/nilai [Tugas|UTS|UAS]` — input nilai (berbasis tombol + force-reply)
1. **Komponen.** Dari argumen (`/nilai Tugas`); bila kosong → tombol `[Tugas][UTS][UAS]`.
2. **Pilih kelas** → tombol kelas (`GET /kelas?aktif=1`).
3. **Pilih mapel** → `GET /kelas/{id}/mapel` → tombol mapel kelas tsb.
4. **Periode** = `is_active=1` (`GET /periode`), otomatis. Tidak ada periode aktif →
   minta admin set (pesan jelas), stop.
5. **Tentukan `ke` (khusus Tugas).** `GET /nilai/tugas?...` → ambil `next_ke`; tampilkan
   "**Tugas ke-N**". (UTS/UAS lewati langkah ini.)
6. **Prefill (UTS/UAS).** `GET /nilai?...` untuk menampilkan nilai komponen saat ini.
7. **Entri nilai per santri.** Tampilkan roster bernomor; entri via **force-reply**
   menerima pasangan `no nilai` (mis. `1 85`, banyak baris sekaligus) — tervalidasi
   0–100 oleh parser teruji (`parseScores`). Tampilkan ringkasan + tombol
   `[💾 Simpan] [✖ Batal]`. (Alternatif tap-per-santri tersedia, tapi entri massal lebih cepat.)
8. **Simpan.**
   - **Tugas** → `POST /nilai/tugas/batch` (`ke` = N). SIM re-average → `nilai.tugas` &
     `nilai_akhir` diperbarui. Ringkasan menampilkan rata-rata baru.
   - **UTS/UAS** → `POST /nilai/batch` komponen-aware (hanya komponen itu).
   - Balasan: `✅ <komponen> tersimpan untuk <N> santri (<mapel> <kelas>).` Bersihkan sesi.
9. **Lihat riwayat Tugas** (read-only): perintah/flow ringan menampilkan
   `Budi: T1 80 · T2 75 · T3 90 → rata² 81.7` dari `GET /nilai/tugas`.

### 5.5 Lookups read-only
- Rekap 1 santri: pilih santri → `GET /santri/{id}/detail?periode_id=` → tampilkan
  rekap kehadiran + nilai.
- (Opsional) ringkasan kelas via `GET /dashboard/summary`.

---

## 6. Inventaris Logika Teruji (`src/` + `node:test`)

Pola lama dipertahankan: fungsi **murni** (tanpa I/O) hidup di `src/`, diuji
`node:test`, dan **disalin** ke n8n Code node. I/O (HTTP/Telegram/state) ada di node n8n.

| Modul | Fungsi | Uji |
|---|---|---|
| `src/format/roster.js` | `formatRoster(roster)` *(dipertahankan)* | sudah ada |
| `src/format/keyboard.js` | `buildAbsenKeyboard(roster, statusMap, page)`, `buildPickKeyboard(items, action)` | render `inline_keyboard` + `callback_data` valid (≤64B), paginasi |
| `src/parsers/scores.js` | `parseScores(text, roster)` → `{entries:[{santri_id,nilai}], errors}` | rentang 0–100, desimal, nomor tak dikenal, duplikat, kosong |
| `src/parsers/callback.js` | `parseCallbackData(data)` → `{cmd, action, idx, value}` | format & batas |
| `src/logic/absen.js` | `applyStatus(state, idx, status)`, `summarize(statusMap, roster)` | reducer status, hitung ringkasan H/S/I/A, penanda Terlambat |
| `src/logic/absen.js` | `toAbsensiBatch(state)` | bentuk body `/absensi/batch` benar |
| `src/logic/nilai.js` | `nextKe(history)`, `previewAverage(history, ke, nilai)` | auto-increment, pratinjau rata-rata |
| `src/format/summary.js` | `formatAbsenSummary`, `formatNilaiSummary`, `formatTugasHistory` | string balasan |

Parser absensi lama berbasis-teks (`parseAttendanceMessage`) **digantikan** oleh model
tombol+state; boleh dipertahankan untuk kompatibilitas tapi tidak dipakai alur baru.

---

## 7. Keamanan & Privasi

- **AuthN** = `telegram_user_id` terdaftar di `users` + `BOT_SHARED_SECRET` pada
  `bot-login`. **AuthZ** = peran SIM (`RequireRole`) + penyembunyian menu di bot.
- `BOT_SHARED_SECRET` di env n8n & SIM, tidak di-commit. HTTPS wajib. JWT pendek.
- Tidak menyimpan password guru di n8n. Token hidup di state sesi (sementara).
- Semua tulis teratribusi `created_by` guru → audit SIM utuh.
- Data akademik mengikuti kebijakan akses SIM; SPP hanya admin (Fase C).

---

## 8. Penanganan Error & Kasus Tepi

- API SIM error → balasan jelas (mis. "Gagal menyimpan, coba lagi") + state
  dipertahankan untuk retry; tidak menulis separuh (batch SIM transaksional).
- Token kedaluwarsa di tengah sesi → `bot-login` ulang transparan, ulangi panggilan.
- Kelas/mapel/periode tak ditemukan/ambigu → tampilkan pilihan, jangan menebak.
- Sesi kedaluwarsa/`/batal` → bersihkan state, minta mulai ulang.
- Tidak ada periode aktif → instruksikan admin mengaktifkan periode.
- Pengirim tak terdaftar → tolak sopan sebelum aksi apa pun.

---

## 9. Fase Implementasi

- **Fase A — Migrasi inti (plan pertama):** penambahan SIM (PRD §5.1–5.3, 5.5) +
  rincian Tugas di web SIM, lalu bot: bootstrap/guard, `/absen`, `/nilai`
  (Tugas/UTS/UAS), `/daftar`, `/menu`, lookups; pensiunkan Sheets. Rilis & uji mandiri.
- **Fase B — Catatan & Tugas:** PRD §5.4; bot `/catatan`, `/tugas`.
- **Fase C — SPP & Reminder:** toggle SPP admin; mesin reminder membaca API SIM,
  hormati `hari_libur`; draft untuk diteruskan guru (tanpa WA API).

Tiap fase = satu plan (writing-plans) dengan langkah kode (TDD untuk `src/`) dan langkah
GUI (n8n editor / web SIM) yang masing-masing punya verifikasi.

---

## 10. Keputusan Terbuka

Lihat PRD §11: penegakan peran `/absen`, input Tugas via web SIM (Fase A vs nanti),
state store (static data vs tabel), format penanda "Terlambat".

---

*Desain ini turunan dari PRD integrasi. Perbarui bersama PRD bila keputusan berubah.*
