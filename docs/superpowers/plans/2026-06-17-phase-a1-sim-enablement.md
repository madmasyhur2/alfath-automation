# Phase A1 — SIM Backend Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the SIM-Madrasah backend capabilities the Telegram bot depends on — a bot-login endpoint, a `telegram_user_id` identity column, a Tugas-detail (history) model with auto-averaging, and a component-aware nilai save — without breaking existing web behavior.

**Architecture:** Pure additions to the existing Go (chi) + MySQL backend at `D:\Projects\sim-madrasah-alfath\backend`. New endpoints are methods on `*handlers.Handler` and wired in `cmd/server/main.go`. New columns/tables via versioned migrations `007`/`008`. The bot authenticates per-teacher via a shared-secret `bot-login` that returns a JWT in the response body (existing `/auth/login` only sets a cookie). `nilai.tugas` becomes a derived average of `nilai_tugas` rows; `nilai_akhir` is recomputed server-side after any component change.

**Tech Stack:** Go 1.x, chi router, `database/sql` + MySQL, bcrypt/JWT (`internal/auth`), `internal/httpx` JSON helpers. **No Go test harness exists in this repo** — every change is verified with exact `curl` commands against a locally-run server (`go run ./cmd/server`).

**Spec references:** `docs/superpowers/specs/2026-06-17-sim-integration-prd.md` §4, §5.1–5.3, §5.5, §6.4, §6.5. (This plan lives in the Al-Fath Automation repo; all code changes are made in the `sim-madrasah-alfath` repo.)

---

## Phase A roadmap (context)

- **A1 (this plan):** SIM backend enablement (bot-login, telegram_user_id, nilai_tugas, component-aware nilai). Unblocks the bot.
- **A2 (later plan):** Bot `src/` pure logic (TDD, `node:test`) + n8n rewiring to the SIM API; retire Google Sheets. Depends on A1.
- **A3 (later plan):** SIM web (Next.js) — `telegram_user_id` field in the user form + Tugas-breakdown display + web Tugas input via the detail table. Does not block the bot.

## File structure (touched in A1)

All paths under `D:\Projects\sim-madrasah-alfath\backend\`:

```
internal/config/config.go            # + BotSharedSecret field
.env.example, .env.production.example# + BOT_SHARED_SECRET
migrations/007_telegram.sql          # NEW: users.telegram_user_id
migrations/008_nilai_tugas.sql       # NEW: nilai_tugas table
internal/handlers/users.go           # support telegram_user_id (create/update/list)
internal/handlers/auth.go            # + BotLogin handler
internal/handlers/nilai.go           # component-aware SaveNilai + recalc helper
internal/handlers/nilai_tugas.go     # NEW: GetTugas, SaveTugasBatch + recalc
cmd/server/main.go                   # wire new routes
```

---

## Task 0: Setup — run the stack and a login helper for verification

This task establishes the verification environment used by every later task. No code changes.

- [ ] **Step 1: Apply existing migrations & ensure MySQL is up**

```bash
cd /d/Projects/sim-madrasah-alfath/backend
mysql -u root < migrations/001_init.sql
mysql -u root < migrations/002_seed.sql
mysql -u root < migrations/003_seed_alfath.sql
mysql -u root < migrations/004_spp.sql
mysql -u root < migrations/005_kitab.sql
mysql -u root < migrations/006_mapping_libur_status.sql
```
Expected: no errors. (Skip files already applied; `IF NOT EXISTS` makes them safe to re-run.)

- [ ] **Step 2: Configure env and start the server**

```bash
cp .env.example .env   # if not present; ensure DB creds are correct
go run ./cmd/server
```
Expected: log line `SIM-Madrasah backend berjalan di :8080 (env=development)`. Leave it running in a separate terminal.

- [ ] **Step 3: Log in as admin and save the session cookie**

`/auth/login` returns the JWT only via the `sim_token` cookie. `RequireAuth` accepts that cookie, so use a cookie jar for protected calls.

```bash
curl -s -c /tmp/sim_cookies.txt -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```
Expected: `{"user":{"id":1,"username":"admin","nama":"...","role":"admin"}}` and `/tmp/sim_cookies.txt` now contains `sim_token`.

- [ ] **Step 4: Confirm the cookie works on a protected route**

```bash
curl -s -b /tmp/sim_cookies.txt http://localhost:8080/api/v1/kelas?aktif=1
```
Expected: a JSON array of classes (e.g. includes `4A`/`4B` and the seeded data). This cookie jar is reused in later verification steps.

---

## Task 1: Config — add BOT_SHARED_SECRET

**Files:**
- Modify: `internal/config/config.go`
- Modify: `.env.example`, `.env.production.example`

- [ ] **Step 1: Add the field and loader**

In `internal/config/config.go`, add `BotSharedSecret string` to the `Config` struct (after `CookieSecure`), and in the returned `&Config{...}` add:
```go
BotSharedSecret: getEnv("BOT_SHARED_SECRET", ""),
```

- [ ] **Step 2: Document it in env examples**

Append to `.env.example`:
```
# Secret bersama untuk endpoint /auth/bot-login (dipakai n8n). Kosong = bot-login dimatikan.
BOT_SHARED_SECRET=
```
Append to `.env.production.example`:
```
# WAJIB diisi rabdom panjang (mis. openssl rand -hex 32) — dipakai n8n untuk bot-login
BOT_SHARED_SECRET=GANTI_DENGAN_HEX_ACAK_64_KARAKTER
```

- [ ] **Step 3: Set a dev value and restart**

Add `BOT_SHARED_SECRET=dev-bot-secret-123` to your local `.env`, then stop and re-run `go run ./cmd/server`.
Expected: server compiles and starts (no new behavior yet).

- [ ] **Step 4: Commit (in the sim-madrasah-alfath repo)**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/internal/config/config.go backend/.env.example backend/.env.production.example
git commit -m "feat(config): add BOT_SHARED_SECRET for bot-login"
```

---

## Task 2: Migration 007 — telegram_user_id on users

**Files:**
- Create: `migrations/007_telegram.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 007_telegram.sql — pemetaan akun guru ke Telegram (untuk bot-login)
USE sim_madrasah;
ALTER TABLE users ADD COLUMN telegram_user_id BIGINT NULL UNIQUE AFTER role;
```

- [ ] **Step 2: Apply it**

```bash
mysql -u root < migrations/007_telegram.sql
```
Expected: no error. (If re-running and the column exists, MySQL errors on duplicate column — that's fine to ignore on a second run.)

- [ ] **Step 3: Verify the column exists**

```bash
mysql -u root -e "USE sim_madrasah; SHOW COLUMNS FROM users LIKE 'telegram_user_id';"
```
Expected: one row, `Type = bigint`, `Null = YES`, `Key = UNI`.

- [ ] **Step 4: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/migrations/007_telegram.sql
git commit -m "feat(db): add users.telegram_user_id (007)"
```

---

## Task 3: users.go — read/write telegram_user_id

Admin must be able to set a teacher's `telegram_user_id` via the API (the web form comes in A3). `telegram_user_id` is nullable; sending `null` clears it.

**Files:**
- Modify: `internal/handlers/users.go`

- [ ] **Step 1: Add the field to the request and list structs**

In `userReq` add:
```go
TelegramUserID *int64 `json:"telegram_user_id"`
```
In `ListUsers`, change the query and struct to include it:
```go
rows, err := h.DB.Query(`SELECT id, username, nama, role, is_active, telegram_user_id FROM users ORDER BY username`)
```
```go
type u struct {
    ID             int64  `json:"id"`
    Username       string `json:"username"`
    Nama           string `json:"nama"`
    Role           string `json:"role"`
    IsActive       bool   `json:"is_active"`
    TelegramUserID *int64 `json:"telegram_user_id"`
}
```
```go
_ = rows.Scan(&x.ID, &x.Username, &x.Nama, &x.Role, &x.IsActive, &x.TelegramUserID)
```

- [ ] **Step 2: Persist it on create**

In `CreateUser`, change the INSERT to include the column (pass the pointer directly — `database/sql` writes NULL for a nil `*int64`):
```go
res, err := h.DB.Exec(
    `INSERT INTO users (username, password_hash, nama, role, telegram_user_id) VALUES (?, ?, ?, ?, ?)`,
    req.Username, hash, req.Nama, req.Role, req.TelegramUserID)
```

- [ ] **Step 3: Persist it on update**

In `UpdateUser`, change the first UPDATE to set it:
```go
if _, err := h.DB.Exec(`UPDATE users SET nama = ?, role = ?, is_active = ?, telegram_user_id = ? WHERE id = ?`,
    req.Nama, req.Role, active, req.TelegramUserID, id); err != nil {
```

- [ ] **Step 4: Rebuild, restart, and set a telegram id on the seeded `guru`**

Restart the server. Find the `guru` user id, then set its telegram id (use a real Telegram numeric id when you have one; `999000111` is fine for testing):
```bash
GURU_ID=$(curl -s -b /tmp/sim_cookies.txt http://localhost:8080/api/v1/users | \
  python -c "import sys,json;print([u['id'] for u in json.load(sys.stdin) if u['username']=='guru'][0])")
curl -s -b /tmp/sim_cookies.txt -X PUT http://localhost:8080/api/v1/users/$GURU_ID \
  -H 'Content-Type: application/json' \
  -d '{"nama":"Guru Uji","role":"guru","telegram_user_id":999000111}'
```
Expected: `{"message":"ok"}`.

- [ ] **Step 5: Verify it round-trips**

```bash
curl -s -b /tmp/sim_cookies.txt http://localhost:8080/api/v1/users
```
Expected: the `guru` entry now shows `"telegram_user_id":999000111`.

- [ ] **Step 6: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/internal/handlers/users.go
git commit -m "feat(users): read/write telegram_user_id"
```

---

## Task 4: bot-login endpoint

Exchange `{bot_secret, telegram_user_id}` for a JWT (returned in the body) of the matching active user. Public route, constant-time secret compare.

**Files:**
- Modify: `internal/handlers/auth.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Add the handler**

In `internal/handlers/auth.go`, add `"crypto/subtle"` to imports, then add:
```go
type botLoginReq struct {
    BotSecret      string `json:"bot_secret"`
    TelegramUserID int64  `json:"telegram_user_id"`
}

// POST /auth/bot-login — dipakai n8n: tukar secret+telegram_id → JWT guru (di body).
func (h *Handler) BotLogin(w http.ResponseWriter, r *http.Request) {
    var req botLoginReq
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TelegramUserID == 0 {
        httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "bot_secret dan telegram_user_id wajib")
        return
    }
    secret := h.Cfg.BotSharedSecret
    if secret == "" || subtle.ConstantTimeCompare([]byte(req.BotSecret), []byte(secret)) != 1 {
        httpx.Error(w, http.StatusUnauthorized, "BOT_UNAUTHORIZED", "Secret bot tidak valid")
        return
    }

    var (
        id         int64
        username   string
        nama, role string
        isActive   bool
    )
    err := h.DB.QueryRow(
        `SELECT id, username, nama, role, is_active FROM users WHERE telegram_user_id = ?`,
        req.TelegramUserID,
    ).Scan(&id, &username, &nama, &role, &isActive)
    if err == sql.ErrNoRows {
        httpx.Error(w, http.StatusForbidden, "NOT_REGISTERED", "Telegram ID belum terdaftar")
        return
    }
    if err != nil {
        httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", "Terjadi kesalahan server")
        return
    }
    if !isActive {
        httpx.Error(w, http.StatusForbidden, "USER_INACTIVE", "Akun dinonaktifkan")
        return
    }

    token, err := auth.GenerateToken(h.Cfg.JWTSecret, h.Cfg.JWTExpiryMin, id, username, role)
    if err != nil {
        httpx.Error(w, http.StatusInternalServerError, "TOKEN_ERROR", "Gagal membuat sesi")
        return
    }
    httpx.JSON(w, http.StatusOK, map[string]interface{}{
        "token": token,
        "user":  models.User{ID: id, Username: username, Nama: nama, Role: role},
    })
}
```
(`sql`, `auth`, `httpx`, `models` are already imported in `auth.go`.)

- [ ] **Step 2: Wire the public route**

In `cmd/server/main.go`, in the public group (right after `r.Post("/auth/logout", h.Logout)` inside `r.Route("/api/v1", ...)`), add:
```go
r.Post("/auth/bot-login", h.BotLogin)
```

- [ ] **Step 3: Rebuild & restart, then test a successful bot-login**

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/bot-login \
  -H 'Content-Type: application/json' \
  -d '{"bot_secret":"dev-bot-secret-123","telegram_user_id":999000111}'
```
Expected: `{"token":"<jwt>","user":{"id":...,"username":"guru","nama":"Guru Uji","role":"guru"}}`.

- [ ] **Step 4: Test the failure paths**

```bash
# wrong secret → 401 BOT_UNAUTHORIZED
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/api/v1/auth/bot-login \
  -H 'Content-Type: application/json' -d '{"bot_secret":"salah","telegram_user_id":999000111}'
# unknown telegram id → 403 NOT_REGISTERED
curl -s -X POST http://localhost:8080/api/v1/auth/bot-login \
  -H 'Content-Type: application/json' -d '{"bot_secret":"dev-bot-secret-123","telegram_user_id":111}'
```
Expected: first prints `401`; second prints `{"error":{"code":"NOT_REGISTERED",...}}`.

- [ ] **Step 5: Confirm the returned token authenticates**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/bot-login \
  -H 'Content-Type: application/json' \
  -d '{"bot_secret":"dev-bot-secret-123","telegram_user_id":999000111}' | \
  python -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/auth/me
```
Expected: `{"user":{"id":...,"username":"guru","role":"guru",...}}`.

- [ ] **Step 6: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/internal/handlers/auth.go backend/cmd/server/main.go
git commit -m "feat(auth): add /auth/bot-login (shared-secret → JWT in body)"
```

---

## Task 5: Migration 008 — nilai_tugas table

**Files:**
- Create: `migrations/008_nilai_tugas.sql`

- [ ] **Step 1: Write the migration** (verbatim from PRD §5.3)

```sql
-- 008_nilai_tugas.sql — riwayat Tugas ke-1..n (kolom nilai.tugas = rata-ratanya)
USE sim_madrasah;
CREATE TABLE IF NOT EXISTS nilai_tugas (
  id                BIGINT PRIMARY KEY AUTO_INCREMENT,
  santri_id         BIGINT NOT NULL,
  mata_pelajaran_id BIGINT NOT NULL,
  periode_id        BIGINT NOT NULL,
  ke                INT    NOT NULL,
  nilai             DECIMAL(5,2) NOT NULL,
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

- [ ] **Step 2: Apply and verify**

```bash
mysql -u root < migrations/008_nilai_tugas.sql
mysql -u root -e "USE sim_madrasah; SHOW COLUMNS FROM nilai_tugas;"
```
Expected: table created with the 9 columns above.

- [ ] **Step 3: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/migrations/008_nilai_tugas.sql
git commit -m "feat(db): add nilai_tugas detail table (008)"
```

---

## Task 6: Shared recalc helper for nilai_akhir

`nilai_akhir` must be recomputed from the **stored** components whenever any of them changes (Tugas average, UTS, or UAS). Centralize this so Task 7 and Task 8 reuse it.

**Files:**
- Modify: `internal/handlers/nilai.go`

- [ ] **Step 1: Add the helper**

At the bottom of `internal/handlers/nilai.go`, add (it must accept a `*sql.Tx`, so add `"database/sql"` to the imports):
```go
// recalcNilaiAkhir menulis ulang nilai_akhir baris nilai dari komponen tersimpan
// (Tugas 30% + UTS 30% + UAS 40%; komponen NULL dianggap 0). Baris harus sudah ada.
func recalcNilaiAkhir(tx *sql.Tx, santriID, mapelID, periodeID int64) error {
    _, err := tx.Exec(`
        UPDATE nilai
           SET nilai_akhir = ROUND(COALESCE(tugas,0)*0.30 + COALESCE(uts,0)*0.30 + COALESCE(uas,0)*0.40, 2)
         WHERE santri_id = ? AND mata_pelajaran_id = ? AND periode_id = ?`,
        santriID, mapelID, periodeID)
    return err
}
```

- [ ] **Step 2: Build to confirm it compiles**

```bash
cd /d/Projects/sim-madrasah-alfath/backend
go build ./...
```
Expected: no output (success). The helper is unused for now; Task 7 & 8 call it.

- [ ] **Step 3: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/internal/handlers/nilai.go
git commit -m "feat(nilai): add recalcNilaiAkhir helper"
```

---

## Task 7: Component-aware /nilai/batch (UTS/UAS without clobbering Tugas)

Current `SaveNilai` overwrites all three components. Make it merge: only components present (non-null) in the request change; then recompute `nilai_akhir` from stored values. This keeps existing web behavior (web sends all three) while letting the bot send only UTS or UAS.

**Files:**
- Modify: `internal/handlers/nilai.go` (`SaveNilai`)

- [ ] **Step 1: Replace the upsert + akhir logic**

In `SaveNilai`, replace the prepared statement and the per-item loop body. The new prepared statement merges via `COALESCE(VALUES(col), col)`:
```go
stmt, err := tx.Prepare(`
    INSERT INTO nilai (santri_id, mata_pelajaran_id, periode_id, tugas, uts, uas, nilai_akhir, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    ON DUPLICATE KEY UPDATE
        tugas = COALESCE(VALUES(tugas), tugas),
        uts   = COALESCE(VALUES(uts),   uts),
        uas   = COALESCE(VALUES(uas),   uas)`)
```
Then the loop (note: drop the old `akhir := models.HitungNilaiAkhir(...)` call and the `akhir` column write — `nilai_akhir` is set by `recalcNilaiAkhir`):
```go
saved := 0
for _, it := range batch.Items {
    if !validNilai(it.Tugas) || !validNilai(it.UTS) || !validNilai(it.UAS) {
        httpx.Error(w, http.StatusBadRequest, "INVALID_NILAI", "Nilai harus antara 0 dan 100")
        return
    }
    if _, err := stmt.Exec(it.SantriID, batch.MataPelajaranID, batch.PeriodeID,
        it.Tugas, it.UTS, it.UAS, userID); err != nil {
        httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
        return
    }
    if err := recalcNilaiAkhir(tx, it.SantriID, batch.MataPelajaranID, batch.PeriodeID); err != nil {
        httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
        return
    }
    saved++
}
```
(For brand-new rows, the INSERT seeds `nilai_akhir=0`, then `recalcNilaiAkhir` immediately corrects it within the same transaction.)

- [ ] **Step 2: Rebuild & restart, then seed a full nilai row, then patch only UTS**

Pick a real `kelas_id` / `mata_pelajaran_id` / `periode_id` / `santri_id` from your data (use `/kelas`, `/kelas/{id}/mapel`, `/periode`, `/santri?kelas_id=`). Example uses kelas 3, mapel 5, periode 1, santri 10 — replace with yours.
```bash
# write all three
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8080/api/v1/nilai/batch \
  -H 'Content-Type: application/json' \
  -d '{"kelas_id":3,"mata_pelajaran_id":5,"periode_id":1,"items":[{"santri_id":10,"tugas":80,"uts":70,"uas":90}]}'
# then send ONLY uts (tugas/uas omitted → null)
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8080/api/v1/nilai/batch \
  -H 'Content-Type: application/json' \
  -d '{"kelas_id":3,"mata_pelajaran_id":5,"periode_id":1,"items":[{"santri_id":10,"uts":60}]}'
```
Expected: both return `{"saved":1}`.

- [ ] **Step 3: Verify Tugas/UAS survived and akhir recomputed**

```bash
curl -s -b /tmp/sim_cookies.txt \
  "http://localhost:8080/api/v1/nilai?kelas_id=3&mata_pelajaran_id=5&periode_id=1"
```
Expected: the santri row shows `tugas=80, uts=60, uas=90`, and `nilai_akhir = 80*0.3 + 60*0.3 + 90*0.4 = 78.00` (NOT clobbered to `60*0.3=18`).

- [ ] **Step 4: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/internal/handlers/nilai.go
git commit -m "feat(nilai): make /nilai/batch component-aware (merge + recalc akhir)"
```

---

## Task 8: nilai_tugas endpoints (GET history/next_ke + POST batch)

**Files:**
- Create: `internal/handlers/nilai_tugas.go`
- Modify: `cmd/server/main.go`

- [ ] **Step 1: Create the handler file (GET)**

`internal/handlers/nilai_tugas.go`:
```go
package handlers

import (
    "encoding/json"
    "net/http"

    "sim-madrasah/backend/internal/httpx"
    "sim-madrasah/backend/internal/middleware"
)

// GET /nilai/tugas?kelas_id=&mata_pelajaran_id=&periode_id=
// Per santri: daftar {ke, nilai} + rata. Juga next_ke untuk auto-increment bot.
func (h *Handler) GetTugas(w http.ResponseWriter, r *http.Request) {
    kelasID := r.URL.Query().Get("kelas_id")
    mapelID := r.URL.Query().Get("mata_pelajaran_id")
    periodeID := r.URL.Query().Get("periode_id")
    if kelasID == "" || mapelID == "" || periodeID == "" {
        httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "kelas_id, mata_pelajaran_id, periode_id wajib")
        return
    }

    rows, err := h.DB.Query(`
        SELECT s.id, s.nama, nt.ke, nt.nilai
        FROM santri s
        LEFT JOIN nilai_tugas nt
          ON nt.santri_id = s.id AND nt.mata_pelajaran_id = ? AND nt.periode_id = ?
        WHERE s.kelas_id = ? AND s.is_active = 1
        ORDER BY s.nama, nt.ke`, mapelID, periodeID, kelasID)
    if err != nil {
        httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
        return
    }
    defer rows.Close()

    type tugasItem struct {
        Ke    int     `json:"ke"`
        Nilai float64 `json:"nilai"`
    }
    type santriTugas struct {
        SantriID int64       `json:"santri_id"`
        Nama     string      `json:"nama"`
        List     []tugasItem `json:"list"`
        Rata     *float64    `json:"rata"`
    }

    order := []int64{}
    bySantri := map[int64]*santriTugas{}
    maxKe := 0
    for rows.Next() {
        var sid int64
        var nama string
        var ke *int
        var nilai *float64
        _ = rows.Scan(&sid, &nama, &ke, &nilai)
        st, ok := bySantri[sid]
        if !ok {
            st = &santriTugas{SantriID: sid, Nama: nama, List: []tugasItem{}}
            bySantri[sid] = st
            order = append(order, sid)
        }
        if ke != nil && nilai != nil {
            st.List = append(st.List, tugasItem{Ke: *ke, Nilai: *nilai})
            if *ke > maxKe {
                maxKe = *ke
            }
        }
    }
    out := make([]*santriTugas, 0, len(order))
    for _, sid := range order {
        st := bySantri[sid]
        if n := len(st.List); n > 0 {
            sum := 0.0
            for _, t := range st.List {
                sum += t.Nilai
            }
            avg := float64(int(sum/float64(n)*100+0.5)) / 100
            st.Rata = &avg
        }
        out = append(out, st)
    }

    httpx.JSON(w, http.StatusOK, map[string]interface{}{
        "kelas_id": kelasID, "mata_pelajaran_id": mapelID, "periode_id": periodeID,
        "next_ke": maxKe + 1,
        "items":   out,
    })
}
```

- [ ] **Step 2: Add the POST batch handler (same file)**

Append to `internal/handlers/nilai_tugas.go`:
```go
type tugasBatchReq struct {
    KelasID         int64 `json:"kelas_id"`
    MataPelajaranID int64 `json:"mata_pelajaran_id"`
    PeriodeID       int64 `json:"periode_id"`
    Ke              *int  `json:"ke"` // opsional; kosong = next_ke
    Items           []struct {
        SantriID int64    `json:"santri_id"`
        Nilai    *float64 `json:"nilai"`
    } `json:"items"`
}

// POST /nilai/tugas/batch — simpan satu Tugas ke-N untuk satu kelas+mapel+periode,
// lalu re-average kolom nilai.tugas dan hitung ulang nilai_akhir.
func (h *Handler) SaveTugasBatch(w http.ResponseWriter, r *http.Request) {
    var req tugasBatchReq
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Body tidak valid")
        return
    }
    if req.MataPelajaranID == 0 || req.PeriodeID == 0 || len(req.Items) == 0 {
        httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "mata_pelajaran_id, periode_id, items wajib")
        return
    }
    for _, it := range req.Items {
        if it.Nilai == nil || *it.Nilai < 0 || *it.Nilai > 100 {
            httpx.Error(w, http.StatusBadRequest, "INVALID_NILAI", "Nilai tugas harus 0-100")
            return
        }
    }

    claims := middleware.ClaimsFrom(r)
    var userID interface{}
    if claims != nil {
        userID = claims.UserID
    }

    // Tentukan ke: pakai req.Ke bila ada; jika tidak, max(ke)+1 untuk kelas+mapel+periode.
    ke := 0
    if req.Ke != nil {
        ke = *req.Ke
    } else {
        _ = h.DB.QueryRow(`
            SELECT COALESCE(MAX(nt.ke),0)+1
            FROM nilai_tugas nt JOIN santri s ON s.id = nt.santri_id
            WHERE s.kelas_id = ? AND nt.mata_pelajaran_id = ? AND nt.periode_id = ?`,
            req.KelasID, req.MataPelajaranID, req.PeriodeID).Scan(&ke)
        if ke == 0 {
            ke = 1
        }
    }

    tx, err := h.DB.Begin()
    if err != nil {
        httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
        return
    }
    defer tx.Rollback()

    insTugas, err := tx.Prepare(`
        INSERT INTO nilai_tugas (santri_id, mata_pelajaran_id, periode_id, ke, nilai, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE nilai = VALUES(nilai)`)
    if err != nil {
        httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
        return
    }
    defer insTugas.Close()

    // Upsert baris nilai dengan tugas = rata-rata (dihitung di Go lalu di-pass sbg
    // parameter — MySQL tidak mengizinkan subquery di dalam VALUES(...)).
    upNilai, err := tx.Prepare(`
        INSERT INTO nilai (santri_id, mata_pelajaran_id, periode_id, tugas, nilai_akhir, created_by)
        VALUES (?, ?, ?, ?, 0, ?)
        ON DUPLICATE KEY UPDATE tugas = VALUES(tugas)`)
    if err != nil {
        httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
        return
    }
    defer upNilai.Close()

    saved := 0
    for _, it := range req.Items {
        // 1. upsert baris detail tugas
        if _, err := insTugas.Exec(it.SantriID, req.MataPelajaranID, req.PeriodeID, ke, it.Nilai, userID); err != nil {
            httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
            return
        }
        // 2. hitung rata-rata terbaru untuk santri tsb
        var avg float64
        if err := tx.QueryRow(
            `SELECT ROUND(AVG(nilai),2) FROM nilai_tugas WHERE santri_id=? AND mata_pelajaran_id=? AND periode_id=?`,
            it.SantriID, req.MataPelajaranID, req.PeriodeID).Scan(&avg); err != nil {
            httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
            return
        }
        // 3. upsert baris nilai dengan tugas = rata-rata
        if _, err := upNilai.Exec(it.SantriID, req.MataPelajaranID, req.PeriodeID, avg, userID); err != nil {
            httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
            return
        }
        // 4. hitung ulang nilai_akhir dari komponen tersimpan
        if err := recalcNilaiAkhir(tx, it.SantriID, req.MataPelajaranID, req.PeriodeID); err != nil {
            httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
            return
        }
        saved++
    }
    if err := tx.Commit(); err != nil {
        httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
        return
    }
    httpx.JSON(w, http.StatusOK, map[string]interface{}{"saved": saved, "ke": ke})
}
```

- [ ] **Step 3: Wire the routes**

In `cmd/server/main.go`, in the authenticated group right after the existing nilai routes (`r.Get("/nilai/leger", ...)` block), add:
```go
r.Get("/nilai/tugas", h.GetTugas)
r.Post("/nilai/tugas/batch", h.SaveTugasBatch)
```

- [ ] **Step 4: Rebuild & restart, then save Tugas ke-1 and ke-2**

Use a real kelas/mapel/periode/santri. Reuse kelas 3, mapel 5, periode 1, santri 10/11.
```bash
# Tugas ke-1 (auto, ke omitted)
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8080/api/v1/nilai/tugas/batch \
  -H 'Content-Type: application/json' \
  -d '{"kelas_id":3,"mata_pelajaran_id":5,"periode_id":1,"items":[{"santri_id":10,"nilai":80},{"santri_id":11,"nilai":70}]}'
# Tugas ke-2 (auto)
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8080/api/v1/nilai/tugas/batch \
  -H 'Content-Type: application/json' \
  -d '{"kelas_id":3,"mata_pelajaran_id":5,"periode_id":1,"items":[{"santri_id":10,"nilai":90}]}'
```
Expected: first returns `{"saved":2,"ke":1}`; second returns `{"saved":1,"ke":2}`.

- [ ] **Step 5: Verify history, next_ke, and the averaged nilai**

```bash
curl -s -b /tmp/sim_cookies.txt \
  "http://localhost:8080/api/v1/nilai/tugas?kelas_id=3&mata_pelajaran_id=5&periode_id=1"
```
Expected: `next_ke` = 3; santri 10 has `list:[{ke:1,nilai:80},{ke:2,nilai:90}]`, `rata:85`.
```bash
curl -s -b /tmp/sim_cookies.txt \
  "http://localhost:8080/api/v1/nilai?kelas_id=3&mata_pelajaran_id=5&periode_id=1"
```
Expected: santri 10 `tugas = 85.00`; `nilai_akhir` reflects 85 for the Tugas component (e.g. with the UTS=60,UAS=90 from Task 7: `85*0.3 + 60*0.3 + 90*0.4 = 79.50`).

- [ ] **Step 6: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/internal/handlers/nilai_tugas.go backend/cmd/server/main.go
git commit -m "feat(nilai): add /nilai/tugas history + /nilai/tugas/batch (avg + recalc)"
```

---

## Task 9: End-to-end checkpoint & regression check

- [ ] **Step 1: Confirm existing web behavior is intact (full three-component write still works)**

```bash
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8080/api/v1/nilai/batch \
  -H 'Content-Type: application/json' \
  -d '{"kelas_id":3,"mata_pelajaran_id":5,"periode_id":1,"items":[{"santri_id":11,"tugas":75,"uts":80,"uas":85}]}'
curl -s -b /tmp/sim_cookies.txt \
  "http://localhost:8080/api/v1/nilai?kelas_id=3&mata_pelajaran_id=5&periode_id=1"
```
Expected: santri 11 shows `tugas=75, uts=80, uas=85, nilai_akhir=80.50`. (Note: a subsequent `/nilai/tugas/batch` for santri 11 would override `tugas` with the detail average — that's the intended "Tugas via detail only" rule, PRD §6.5; flag for the A3 web change.)

- [ ] **Step 2: Confirm absensi is untouched (sanity)**

```bash
curl -s -b /tmp/sim_cookies.txt "http://localhost:8080/api/v1/absensi?kelas_id=3"
```
Expected: a normal roster+status payload (no errors) — confirms no collateral breakage.

- [ ] **Step 3: Final build & commit any stragglers**

```bash
cd /d/Projects/sim-madrasah-alfath/backend && go build ./...
cd /d/Projects/sim-madrasah-alfath && git add -A && git commit -m "chore: Phase A1 SIM enablement verified" --allow-empty
```

---

## Self-review notes (verified while writing)

- **Spec coverage (A1 portion):** bot-login (PRD §4, §5.2) → Task 4. `telegram_user_id` (§5.1) → Tasks 2–3. `nilai_tugas` + endpoints + re-average (§5.3, §6.5) → Tasks 5, 6, 8. Component-aware `/nilai/batch` (§5.5, §6.4) → Tasks 6, 7. Config secret (§8) → Task 1. The web-side of §5.1/§6.5 (form field + breakdown UI) is **A3**, intentionally out of A1.
- **No placeholders:** every code step shows complete Go/SQL; every verification step has an exact `curl`/`mysql` command and expected output.
- **Type/name consistency:** `recalcNilaiAkhir(tx, santriID, mapelID, periodeID)` defined in Task 6 and called identically in Tasks 7 and 8. `BotSharedSecret` (Task 1) used in `BotLogin` (Task 4). Route paths `/auth/bot-login`, `/nilai/tugas`, `/nilai/tugas/batch` match between handler comments and `main.go` wiring.
- **Verification model:** curl-against-running-server (no Go test harness exists in this repo — adding one for a handful of handlers would be disproportionate and off-pattern). The bot's pure logic in A2 uses `node:test` TDD as established.
- **Deviation flagged:** `nilai_akhir` is now always derived by `recalcNilaiAkhir` rather than the Go `models.HitungNilaiAkhir` path inside `SaveNilai`; both use the same 30/30/40 weights, so results match. The old `HitungNilaiAkhir` remains used elsewhere (unchanged).
```
