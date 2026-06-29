# Phase B — Catatan & Tugas Design

**Status:** Approved 2026-06-29. Supersedes the deferred details in PRD §5.4 and §6.6
(`2026-06-17-sim-integration-prd.md`). Builds on Phase A (A1 backend, A2 bot, A3 web).

**Goal:** Add two new teacher data-entry surfaces to the SIM-backed Telegram bot —
`/catatan` (free-text notes per santri) and `/tugas` (homework/PR announcements per
kelas) — backed by two new SIM tables and four REST endpoints.

**Scope:** Backend SIM (Go) + Bot (n8n + `src/` logic). **No web UI** — catatan/tugas
are read back via the bot and API only. Reminders that consume `tugas` are Phase C.

**Split into two implementation plans** (same rationale as A1/A2 — different repos,
different verification models):
- **B1 — Backend SIM:** migration `009` + 4 endpoints, curl-verified.
- **B2 — Bot:** `src/` pure logic (node:test TDD) + n8n rewiring of `AlFath Bot v2`.

---

## 1. Locked design decisions (2026-06-29)

| Decision | Choice |
|---|---|
| Surfaces | Backend + Bot only. No web view in Phase B. |
| `/catatan` read-back | **Write + lihat ringkas** — show last 5 notes when a santri is picked, then prompt for the new note. |
| `/tugas` read-back | **Buat saja** (create-only) from the bot. `GET /tugas` exists for Phase C reminders. |
| Tugas `deskripsi` | **Required**, non-empty, ≤500 chars (matches `NOT NULL` schema; reminders need text). |
| Tugas `mata_pelajaran_id` | **Required from the bot.** DB column stays `NULL`-able per PRD (future flexibility), bot enforces selection. |
| Tugas `tenggat` | **Optional** — `YYYY-MM-DD` or `/lewati` to skip. |
| Tugas `tanggal_diberikan` | Defaults to today (WIB). |
| Catatan `tanggal` | Defaults to today (WIB). |
| Date input format | `YYYY-MM-DD` only (consistent with rest of system). No natural-language date parsing (YAGNI). |

---

## 2. Backend SIM (Plan B1)

All paths under `D:\Projects\sim-madrasah-alfath\backend\`. New endpoints are methods on
`*handlers.Handler`, wired in `cmd/server/main.go`, JWT-protected (Bearer). Verified with
`curl` against a locally-run server (no Go test harness — same model as A1).

### 2.1 Migration `migrations/009_catatan_tugas.sql`

Verbatim from PRD §5.4:

```sql
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

### 2.2 Endpoints

| Method | Endpoint | Request | Response | Bot? |
|---|---|---|---|---|
| POST | `/catatan` | `{santri_id, teks, tanggal?}` — `tanggal` default today WIB; `created_by` from JWT | `{id, santri_id, tanggal, teks, created_by, created_at}` | ✅ write |
| GET | `/catatan?santri_id=&limit=` | `santri_id` required; `limit` default 5 | `[{id, santri_id, tanggal, teks, created_by, created_at}]` ordered `tanggal DESC, id DESC` | ✅ recent |
| POST | `/tugas` | `{kelas_id, mata_pelajaran_id, deskripsi, tanggal_diberikan?, tenggat?}` — `tanggal_diberikan` default today; `created_by` from JWT | `{id, ...}` | ✅ create |
| GET | `/tugas?kelas_id=&aktif=` | `kelas_id` required; `aktif=1` → only `tenggat IS NULL OR tenggat >= CURDATE()` | `[{id, kelas_id, mata_pelajaran_id, mapel_nama, deskripsi, tanggal_diberikan, tenggat, ...}]` | ❌ Phase C |

**Validation (both POST):**
- `teks` / `deskripsi`: required, trimmed non-empty, ≤500 chars → `400 BAD_REQUEST` otherwise.
- `santri_id` / `kelas_id` / `mata_pelajaran_id`: required, must exist (FK enforces) → `400`/`500` on violation.
- `tanggal` / `tenggat` / `tanggal_diberikan`: if present, must parse as `YYYY-MM-DD`.

`created_by` is taken from the JWT claims (`middleware.ClaimsFrom(r)`), same pattern as
`SaveTugasBatch` in A1 — so the bot's per-teacher identity is recorded.

---

## 3. Bot — `/catatan` flow (Plan B2)

Stateful inline-keyboard flow, same shape as `/absen`. Session key `sess_<chatId>` in
n8n workflow static data.

1. **`/catatan [kelas?]`** → `GET /kelas?aktif=1`. Arg matches a class name (case-insensitive, trim) → use it; else send `buildPickKeyboard(list, 'catatan', 'kelas', 'nama', 'id')`.
2. **Pick kelas** (`catatan:kelas:<id>` or matched arg) → `GET /santri?kelas_id=` → send santri buttons `catatan:santri:<santri_id>`.
3. **Pick santri** (`catatan:santri:<id>`) → `GET /catatan?santri_id=&limit=5` → reply with `formatCatatanList(nama, list)` **and** a `force_reply` prompt: `Tulis catatan baru untuk <nama>:`.
4. **Reply text** (a normal message; handled in the force-reply branch where `sess.cmd==='catatan'` and `sess.awaitCatatan` is set) → `POST /catatan {santri_id, teks}` → `formatCatatanSaved(nama)` → clear session.

Session shape: `{ cmd:'catatan', kelas_id, santri_id, santri_nama, awaitCatatan:true }`.

---

## 4. Bot — `/tugas` flow (Plan B2)

Stateful, with **two sequential force-replies** (deskripsi → tenggat). Extends the
single force-reply pattern used for `/absen` keterangan.

1. **`/tugas [kelas?]`** → resolve kelas (arg or `buildPickKeyboard(list, 'tugas', 'kelas', 'nama', 'id')`).
2. **Pick kelas** (`tugas:kelas:<id>`) → `GET /kelas/{id}/mapel` → send mapel buttons `tugas:mapel:<mata_pelajaran_id>` (**required** — no skip).
3. **Pick mapel** (`tugas:mapel:<id>`) → store in session, set `awaitField='deskripsi'`, `force_reply` prompt: `Deskripsi tugas? (mis. "Kerjakan LKS hal. 12")`.
4. **Reply deskripsi** → validate non-empty; store; set `awaitField='tenggat'`, `force_reply` prompt: `Tenggat? (YYYY-MM-DD, atau /lewati)` with placeholder `2026-07-05`.
5. **Reply tenggat** → `parseTenggat(text)`: `/lewati` → null; valid `YYYY-MM-DD` → date; malformed → re-prompt with format hint. Then `POST /tugas {kelas_id, mata_pelajaran_id, deskripsi, tenggat?}` → `formatTugasSaved(mapel, kelas, tenggat)` → clear session.

Session shape: `{ cmd:'tugas', kelas_id, kelas_nama, mapel_id, mapel_nama, deskripsi?, awaitField:'deskripsi'|'tenggat' }`.

The shared force-reply handler (`CheckForcereply` / `SwitchFR`, built in A2 Task 11/12)
is extended to route on `sess.cmd` (`absen` keterangan, `nilai` scores, **`catatan` text,
`tugas` deskripsi/tenggat**).

---

## 5. Pure logic `src/` (Plan B2, TDD)

New/extended modules, each developed with `node:test` (zero I/O), then copied verbatim
into n8n Code nodes (single source of truth = `src/`):

- **`src/parsers/tanggal.js`** — `parseTenggat(text)` → `{ date: string|null, error?: string }`.
  - `/lewati` (any case, trimmed) → `{ date: null }`.
  - `YYYY-MM-DD` matching a real calendar date → `{ date: 'YYYY-MM-DD' }`.
  - anything else → `{ error: 'Format tanggal harus YYYY-MM-DD, atau /lewati.' }`.
- **`src/format/summary.js`** (append 3 functions):
  - `formatCatatanList(nama, list)` → header + bulleted recent notes, or "Belum ada catatan." when empty.
  - `formatCatatanSaved(nama)` → `✅ Catatan untuk <nama> tersimpan.`
  - `formatTugasSaved(mapel, kelas, tenggat)` → `✅ Tugas <mapel> <kelas> tersimpan.` + ` (tenggat <date>)` when set.

Reused from A2 (no change): `parseCallbackData`, `buildPickKeyboard`, `formatRoster`.

---

## 6. Error handling & guards

- HTTP Request nodes use **Never Error** + IF guard (A2 pattern); failed save → user-facing
  message, no silent abort.
- Identity guard (`bot-login` → `Registered?`) and the `Dispatch` switch already exist;
  Phase B adds `catatan` and `tugas` outputs to `Dispatch` and the matching sub-flows.
- Expired/missing session on a callback → `Sesi habis. Mulai lagi dengan /catatan [kelas].`
- Empty `teks`/`deskripsi` → re-prompt. Malformed `tenggat` → re-prompt with format hint.

---

## 7. Out of scope (Phase B)

- Web UI for catatan/tugas (admin/kepala viewing) — not in this phase.
- Editing/deleting catatan or tugas from the bot.
- Reminders consuming `tugas` (the `tugas-diberikan` nudge) — **Phase C**.
- Natural-language date parsing for `tenggat`.
- SPP and hari-libur handling — **Phase C**.
