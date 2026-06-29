# Phase B1 — Catatan & Tugas Backend (SIM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the SIM-Madrasah backend capabilities for Phase B — two new tables (`catatan`, `tugas`) and four REST endpoints (`POST/GET /catatan`, `POST/GET /tugas`) — so the bot can record per-santri notes and per-kelas homework announcements.

**Architecture:** Pure additions to the existing Go (chi) + MySQL backend at `D:\Projects\sim-madrasah-alfath\backend`. New handlers are methods on `*handlers.Handler` in two new files, wired into the authenticated group in `cmd/server/main.go`. New tables via migration `009`. `created_by` comes from JWT claims (`middleware.ClaimsFrom`), so per-teacher identity is recorded. Dates are returned as clean `YYYY-MM-DD` strings via `DATE_FORMAT` so scanning is DSN-independent.

**Tech Stack:** Go 1.x, chi router, `database/sql` + MySQL, `internal/httpx` JSON helpers, `internal/middleware` claims. **No Go test harness exists in this repo** — every change is verified with exact `curl` commands against a locally-run server (`go run ./cmd/server`).

**Depends on:** Phase A1 (bot-login, JWT auth) deployed. **Spec references:** `docs/superpowers/specs/2026-06-29-phase-b-catatan-tugas-design.md` §2.

## Global Constraints

- All code changes are made in the **`sim-madrasah-alfath`** repo (commits there). This plan file lives in the Al-Fath Automation repo.
- `teks` / `deskripsi`: required, trimmed non-empty, ≤500 characters.
- `mata_pelajaran_id` on `tugas` is **nullable at the endpoint** (the bot enforces selection, not the API).
- Dates accepted/returned as `YYYY-MM-DD` (WIB). `tanggal` / `tanggal_diberikan` default to today when omitted.
- Endpoints are JWT-protected (Bearer), placed in the authenticated group (all logged-in roles, not admin-only).
- Reuse the existing error contract: `httpx.Error(w, status, CODE, message)` and `httpx.JSON(w, status, payload)`.

---

## File structure (touched in B1)

All paths under `D:\Projects\sim-madrasah-alfath\backend\`:

```
migrations/009_catatan_tugas.sql     # NEW: catatan + tugas tables
internal/handlers/catatan.go         # NEW: CreateCatatan, GetCatatan
internal/handlers/tugas.go           # NEW: CreateTugas, GetTugasList
cmd/server/main.go                   # wire 4 new routes
```

> Handler names: the nilai-Tugas history handlers already use `GetTugas`/`SaveTugasBatch`, so the new homework-`tugas` handlers are named **`CreateTugas`** and **`GetTugasList`** to avoid collision.

---

## Task 0: Setup — run the stack (verification environment)

This task establishes the verification environment. No code changes. (Identical to A1 Task 0; skip if your server + cookie jar are already running.)

- [ ] **Step 1: Ensure MySQL is up and migrations 001–008 applied**

```bash
cd /d/Projects/sim-madrasah-alfath/backend
# (re-running applied migrations is safe; IF NOT EXISTS / existing columns just warn)
```

- [ ] **Step 2: Start the server**

```bash
cd /d/Projects/sim-madrasah-alfath/backend
go run ./cmd/server
```
Expected: log line `SIM-Madrasah backend berjalan di :8090 (env=...)`. Leave running in a separate terminal. (Port is whatever `APP_PORT` is set to — A1 used 8090 in production; dev may differ. Use your actual port in the curls below; examples use `8090`.)

- [ ] **Step 3: Log in as admin and save the cookie jar**

```bash
curl -s -c /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```
Expected: `{"user":{...,"role":"admin"}}` and `/tmp/sim_cookies.txt` now holds `sim_token`.

- [ ] **Step 4: Grab a santri id and a kelas id for later tests**

```bash
curl -s -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/kelas?aktif=1"
# pick a kelas id, then:
curl -s -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/santri?kelas_id=<KELAS_ID>"
```
Expected: a class list and a santri roster. Note one `kelas_id`, one `santri_id`, and (via `GET /kelas/<id>/mapel`) one `mata_pelajaran_id` for the POST tests below.

---

## Task 1: Migration 009 — catatan + tugas tables

**Files:**
- Create: `migrations/009_catatan_tugas.sql`

- [ ] **Step 1: Write the migration** (verbatim from design §2.1 / PRD §5.4)

```sql
-- 009_catatan_tugas.sql — Fase B: catatan per santri + tugas/PR per kelas
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

- [ ] **Step 2: Apply it**

```bash
cd /d/Projects/sim-madrasah-alfath/backend
mysql -u root sim_madrasah < migrations/009_catatan_tugas.sql
```
Expected: no error.

- [ ] **Step 3: Verify the tables exist**

```bash
mysql -u root -e "USE sim_madrasah; SHOW COLUMNS FROM catatan; SHOW COLUMNS FROM tugas;"
```
Expected: `catatan` shows 6 columns (id, santri_id, tanggal, teks, created_by, created_at); `tugas` shows 8 (id, kelas_id, mata_pelajaran_id, deskripsi, tanggal_diberikan, tenggat, created_by, created_at).

- [ ] **Step 4: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/migrations/009_catatan_tugas.sql
git commit -m "feat(db): add catatan + tugas tables (009)"
```

---

## Task 2: catatan endpoints (POST create + GET recent)

**Files:**
- Create: `internal/handlers/catatan.go`
- Modify: `cmd/server/main.go`

**Interfaces:**
- Produces: `func (h *Handler) CreateCatatan(w http.ResponseWriter, r *http.Request)` and `func (h *Handler) GetCatatan(w http.ResponseWriter, r *http.Request)`, wired at `POST /catatan` and `GET /catatan`.

- [ ] **Step 1: Create the handler file**

`internal/handlers/catatan.go`:
```go
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sim-madrasah/backend/internal/httpx"
	"sim-madrasah/backend/internal/middleware"
)

type catatanReq struct {
	SantriID int64  `json:"santri_id"`
	Teks     string `json:"teks"`
	Tanggal  string `json:"tanggal"` // opsional; kosong = hari ini
}

// POST /catatan — simpan satu catatan untuk satu santri (created_by = guru dari JWT).
func (h *Handler) CreateCatatan(w http.ResponseWriter, r *http.Request) {
	var req catatanReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Body tidak valid")
		return
	}
	teks := strings.TrimSpace(req.Teks)
	if req.SantriID == 0 || teks == "" {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "santri_id dan teks wajib")
		return
	}
	if len([]rune(teks)) > 500 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Teks maksimal 500 karakter")
		return
	}
	tanggal := strings.TrimSpace(req.Tanggal)
	if tanggal == "" {
		tanggal = time.Now().Format("2006-01-02")
	} else if _, err := time.Parse("2006-01-02", tanggal); err != nil {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Format tanggal harus YYYY-MM-DD")
		return
	}

	claims := middleware.ClaimsFrom(r)
	var userID interface{}
	if claims != nil {
		userID = claims.UserID
	}

	res, err := h.DB.Exec(
		`INSERT INTO catatan (santri_id, tanggal, teks, created_by) VALUES (?, ?, ?, ?)`,
		req.SantriID, tanggal, teks, userID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	id, _ := res.LastInsertId()
	httpx.JSON(w, http.StatusCreated, map[string]interface{}{
		"id": id, "santri_id": req.SantriID, "tanggal": tanggal, "teks": teks,
	})
}

// GET /catatan?santri_id=&limit= — catatan terbaru satu santri (limit default 5).
func (h *Handler) GetCatatan(w http.ResponseWriter, r *http.Request) {
	santriID := r.URL.Query().Get("santri_id")
	if santriID == "" {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "santri_id wajib")
		return
	}
	limit := 5
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 50 {
			limit = n
		}
	}

	rows, err := h.DB.Query(`
		SELECT id, santri_id, DATE_FORMAT(tanggal,'%Y-%m-%d'), teks,
		       created_by, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s')
		FROM catatan
		WHERE santri_id = ?
		ORDER BY tanggal DESC, id DESC
		LIMIT ?`, santriID, limit)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type catatanRow struct {
		ID        int64  `json:"id"`
		SantriID  int64  `json:"santri_id"`
		Tanggal   string `json:"tanggal"`
		Teks      string `json:"teks"`
		CreatedBy *int64 `json:"created_by"`
		CreatedAt string `json:"created_at"`
	}
	out := []catatanRow{}
	for rows.Next() {
		var c catatanRow
		_ = rows.Scan(&c.ID, &c.SantriID, &c.Tanggal, &c.Teks, &c.CreatedBy, &c.CreatedAt)
		out = append(out, c)
	}
	httpx.JSON(w, http.StatusOK, out)
}
```

- [ ] **Step 2: Wire the routes**

In `cmd/server/main.go`, inside the authenticated group (right after the `r.Post("/nilai/tugas/batch", h.SaveTugasBatch)` line), add:
```go
			// Catatan (Fase B)
			r.Get("/catatan", h.GetCatatan)
			r.Post("/catatan", h.CreateCatatan)
```

- [ ] **Step 3: Build & restart**

```bash
cd /d/Projects/sim-madrasah-alfath/backend
go build ./...
```
Expected: no output (success). Restart `go run ./cmd/server`.

- [ ] **Step 4: Test create + read-back**

Use the `santri_id` from Task 0. The cookie jar provides JWT auth (the bot will use Bearer; the cookie works the same on protected routes).
```bash
# create two notes
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/catatan \
  -H 'Content-Type: application/json' \
  -d '{"santri_id":<SANTRI_ID>,"teks":"Aktif bertanya di kelas hari ini."}'
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/catatan \
  -H 'Content-Type: application/json' \
  -d '{"santri_id":<SANTRI_ID>,"teks":"Lupa membawa buku tugas.","tanggal":"2026-06-28"}'
# read back
curl -s -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/catatan?santri_id=<SANTRI_ID>&limit=5"
```
Expected: each POST returns `{"id":..,"santri_id":..,"tanggal":"...","teks":".."}` with status 201; the GET returns a 2-element array, newest first (today's note before the 2026-06-28 one), each with `created_by` = the admin's user id.

- [ ] **Step 5: Test validation failures**

```bash
# empty teks → 400
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/catatan \
  -H 'Content-Type: application/json' -d '{"santri_id":<SANTRI_ID>,"teks":"   "}'
# missing santri_id → 400
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/catatan \
  -H 'Content-Type: application/json' -d '{"teks":"hai"}'
# GET without santri_id → 400
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/catatan"
```
Expected: `400`, `400`, `400`.

- [ ] **Step 6: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/internal/handlers/catatan.go backend/cmd/server/main.go
git commit -m "feat(catatan): add POST/GET /catatan endpoints"
```

---

## Task 3: tugas endpoints (POST create + GET list)

**Files:**
- Create: `internal/handlers/tugas.go`
- Modify: `cmd/server/main.go`

**Interfaces:**
- Produces: `func (h *Handler) CreateTugas(w http.ResponseWriter, r *http.Request)` and `func (h *Handler) GetTugasList(w http.ResponseWriter, r *http.Request)`, wired at `POST /tugas` and `GET /tugas`.

- [ ] **Step 1: Create the handler file**

`internal/handlers/tugas.go`:
```go
package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"sim-madrasah/backend/internal/httpx"
	"sim-madrasah/backend/internal/middleware"
)

type tugasReq struct {
	KelasID          int64   `json:"kelas_id"`
	MataPelajaranID  *int64  `json:"mata_pelajaran_id"`  // nullable di DB; bot mewajibkan
	Deskripsi        string  `json:"deskripsi"`
	TanggalDiberikan string  `json:"tanggal_diberikan"`  // opsional; kosong = hari ini
	Tenggat          *string `json:"tenggat"`            // opsional; null = tanpa tenggat
}

// POST /tugas — umumkan satu tugas/PR untuk satu kelas (created_by = guru dari JWT).
func (h *Handler) CreateTugas(w http.ResponseWriter, r *http.Request) {
	var req tugasReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Body tidak valid")
		return
	}
	deskripsi := strings.TrimSpace(req.Deskripsi)
	if req.KelasID == 0 || deskripsi == "" {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "kelas_id dan deskripsi wajib")
		return
	}
	if len([]rune(deskripsi)) > 500 {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Deskripsi maksimal 500 karakter")
		return
	}
	tglDiberikan := strings.TrimSpace(req.TanggalDiberikan)
	if tglDiberikan == "" {
		tglDiberikan = time.Now().Format("2006-01-02")
	} else if _, err := time.Parse("2006-01-02", tglDiberikan); err != nil {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Format tanggal_diberikan harus YYYY-MM-DD")
		return
	}

	// tenggat: opsional. Nil atau string kosong → NULL. Bila diisi → validasi.
	var tenggat interface{}
	if req.Tenggat != nil && strings.TrimSpace(*req.Tenggat) != "" {
		t := strings.TrimSpace(*req.Tenggat)
		if _, err := time.Parse("2006-01-02", t); err != nil {
			httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "Format tenggat harus YYYY-MM-DD")
			return
		}
		tenggat = t
	}

	claims := middleware.ClaimsFrom(r)
	var userID interface{}
	if claims != nil {
		userID = claims.UserID
	}

	res, err := h.DB.Exec(
		`INSERT INTO tugas (kelas_id, mata_pelajaran_id, deskripsi, tanggal_diberikan, tenggat, created_by)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		req.KelasID, req.MataPelajaranID, deskripsi, tglDiberikan, tenggat, userID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	id, _ := res.LastInsertId()
	httpx.JSON(w, http.StatusCreated, map[string]interface{}{
		"id": id, "kelas_id": req.KelasID, "mata_pelajaran_id": req.MataPelajaranID,
		"deskripsi": deskripsi, "tanggal_diberikan": tglDiberikan, "tenggat": tenggat,
	})
}

// GET /tugas?kelas_id=&aktif= — daftar tugas satu kelas (aktif=1 → belum lewat tenggat).
func (h *Handler) GetTugasList(w http.ResponseWriter, r *http.Request) {
	kelasID := r.URL.Query().Get("kelas_id")
	if kelasID == "" {
		httpx.Error(w, http.StatusBadRequest, "BAD_REQUEST", "kelas_id wajib")
		return
	}
	where := "t.kelas_id = ?"
	if r.URL.Query().Get("aktif") == "1" {
		where += " AND (t.tenggat IS NULL OR t.tenggat >= CURDATE())"
	}

	rows, err := h.DB.Query(`
		SELECT t.id, t.kelas_id, t.mata_pelajaran_id, COALESCE(mp.nama,''),
		       t.deskripsi, DATE_FORMAT(t.tanggal_diberikan,'%Y-%m-%d'),
		       DATE_FORMAT(t.tenggat,'%Y-%m-%d'),
		       DATE_FORMAT(t.created_at,'%Y-%m-%d %H:%i:%s')
		FROM tugas t
		LEFT JOIN mata_pelajaran mp ON mp.id = t.mata_pelajaran_id
		WHERE `+where+`
		ORDER BY t.tanggal_diberikan DESC, t.id DESC`, kelasID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type tugasRow struct {
		ID               int64   `json:"id"`
		KelasID          int64   `json:"kelas_id"`
		MataPelajaranID  *int64  `json:"mata_pelajaran_id"`
		MapelNama        string  `json:"mapel_nama"`
		Deskripsi        string  `json:"deskripsi"`
		TanggalDiberikan string  `json:"tanggal_diberikan"`
		Tenggat          *string `json:"tenggat"`
		CreatedAt        string  `json:"created_at"`
	}
	out := []tugasRow{}
	for rows.Next() {
		var t tugasRow
		_ = rows.Scan(&t.ID, &t.KelasID, &t.MataPelajaranID, &t.MapelNama,
			&t.Deskripsi, &t.TanggalDiberikan, &t.Tenggat, &t.CreatedAt)
		out = append(out, t)
	}
	httpx.JSON(w, http.StatusOK, out)
}
```

- [ ] **Step 2: Wire the routes**

In `cmd/server/main.go`, right after the catatan routes added in Task 2, add:
```go
			// Tugas/PR (Fase B)
			r.Get("/tugas", h.GetTugasList)
			r.Post("/tugas", h.CreateTugas)
```

- [ ] **Step 3: Build & restart**

```bash
cd /d/Projects/sim-madrasah-alfath/backend
go build ./...
```
Expected: no output. Restart the server.

- [ ] **Step 4: Test create (with & without optional fields) + list**

Use the `kelas_id` and `mata_pelajaran_id` from Task 0.
```bash
# full: mapel + tenggat
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/tugas \
  -H 'Content-Type: application/json' \
  -d '{"kelas_id":<KELAS_ID>,"mata_pelajaran_id":<MAPEL_ID>,"deskripsi":"Kerjakan LKS halaman 12-13.","tenggat":"2026-07-05"}'
# no tenggat, no mapel (general task) — endpoint allows null mapel
curl -s -b /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/tugas \
  -H 'Content-Type: application/json' \
  -d '{"kelas_id":<KELAS_ID>,"deskripsi":"Bawa perlengkapan kerja bakti besok."}'
# list all + active-only
curl -s -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/tugas?kelas_id=<KELAS_ID>"
curl -s -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/tugas?kelas_id=<KELAS_ID>&aktif=1"
```
Expected: both POSTs return 201 with the echoed row (first has `tenggat:"2026-07-05"` + `mata_pelajaran_id` set; second has `tenggat:null`, `mata_pelajaran_id:null`). The unfiltered list shows both, newest first; the `aktif=1` list shows both (the future tenggat and the null-tenggat one are both active). `mapel_nama` is populated for the first, `""` for the second.

- [ ] **Step 5: Test validation failures**

```bash
# empty deskripsi → 400
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/tugas \
  -H 'Content-Type: application/json' -d '{"kelas_id":<KELAS_ID>,"deskripsi":"  "}'
# bad tenggat format → 400
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/sim_cookies.txt -X POST http://localhost:8090/api/v1/tugas \
  -H 'Content-Type: application/json' -d '{"kelas_id":<KELAS_ID>,"deskripsi":"x","tenggat":"5 Juli"}'
# GET without kelas_id → 400
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/tugas"
```
Expected: `400`, `400`, `400`.

- [ ] **Step 6: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add backend/internal/handlers/tugas.go backend/cmd/server/main.go
git commit -m "feat(tugas): add POST/GET /tugas endpoints"
```

---

## Task 4: End-to-end checkpoint & regression

- [ ] **Step 1: Confirm the four routes respond and auth is enforced**

```bash
# unauthenticated → 401 on each protected route
for m in "GET /catatan?santri_id=1" "POST /catatan" "GET /tugas?kelas_id=1" "POST /tugas"; do
  set -- $m
  curl -s -o /dev/null -w "$1 $2 → %{http_code}\n" -X "$1" "http://localhost:8090/api/v1/${2#*/}"
done
```
Expected: each prints `→ 401` (no cookie/Bearer → `RequireAuth` blocks).

- [ ] **Step 2: Confirm existing endpoints untouched (sanity)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/nilai/tugas?kelas_id=<KELAS_ID>&mata_pelajaran_id=<MAPEL_ID>&periode_id=1"
curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/sim_cookies.txt "http://localhost:8090/api/v1/absensi?kelas_id=<KELAS_ID>"
```
Expected: both `200` — the new files added no collateral breakage (handler names `CreateTugas`/`GetTugasList` don't collide with nilai's `GetTugas`/`SaveTugasBatch`).

- [ ] **Step 3: Final build & commit any stragglers**

```bash
cd /d/Projects/sim-madrasah-alfath/backend && go build ./...
cd /d/Projects/sim-madrasah-alfath && git add -A && git commit -m "chore: Phase B1 catatan/tugas backend verified" --allow-empty
```

---

## Self-review notes (verified while writing)

- **Spec coverage (design §2):** migration `009` (catatan+tugas) → Task 1. `POST /catatan` + `GET /catatan?santri_id=&limit=` → Task 2. `POST /tugas` + `GET /tugas?kelas_id=&aktif=` → Task 3. Validation rules (teks/deskripsi required ≤500, dates YYYY-MM-DD, mapel nullable at endpoint, defaults today) → Tasks 2–3 Steps 1. `created_by` from JWT → both POST handlers. Auth-protected, all-roles group → main.go wiring.
- **No placeholders:** every handler is complete Go; every verification step has an exact `curl` with `<PLACEHOLDER>` ids the engineer fills from Task 0, and an expected status/shape.
- **Name consistency:** new homework handlers are `CreateTugas`/`GetTugasList` (distinct from nilai-history `GetTugas`/`SaveTugasBatch` in `riwayat_tugas.go`). Routes `/catatan`, `/tugas` match handler comments and main.go. `created_by` taken via `middleware.ClaimsFrom(r)` exactly as in `absensi.go`/`riwayat_tugas.go`.
- **Verification model:** curl-against-running-server (no Go test harness in this repo — consistent with A1). Dates returned via `DATE_FORMAT` so scanning into `string`/`*string` is DSN-independent (no reliance on `parseTime`).
- **Deviation flagged:** `GET /tugas` is built now though the Phase B bot never calls it — PRD §5.4 lists it and Phase C reminders need it; building it in the same file is cheaper than a later revisit.
```
