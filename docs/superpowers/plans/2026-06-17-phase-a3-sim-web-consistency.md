# Phase A3 — SIM Web Consistency (frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the SIM-Madrasah Next.js web app into consistency with the bot-driven data model: let admins set a teacher's `telegram_user_id`, and make the Tugas column reflect the new per-Tugas history (T1…Tn average) — entering Tugas via the detail table so it never clobbers the bot's average.

**Architecture:** Frontend-only changes in `D:\Projects\sim-madrasah-alfath\frontend`. The users CRUD is config-driven via `components/MasterCrud.tsx` (add one field). The nilai page (`app/(app)/nilai/page.tsx`) is a single self-contained client component: make `tugas` read-only (derived average + T1…Tn breakdown), send only UTS/UAS on the main Save (relying on A1's component-aware `/nilai/batch`), and add a "Kelola Tugas" panel that writes `/nilai/tugas/batch`.

**Tech Stack:** Next.js (App Router, client components), the `api()` helper in `lib/api.ts` (cookie auth). **No frontend test harness exists** — verification is manual via `npm run dev` in a browser, cross-checked against the API. Does NOT block the bot (A2).

**Depends on:** Phase A1 endpoints (`users.telegram_user_id`, `/nilai/tugas`, `/nilai/tugas/batch`, component-aware `/nilai/batch`). **Spec references:** PRD §5.1, §6.5; review decision §11.2.

---

## File structure (touched in A3)

All under `D:\Projects\sim-madrasah-alfath\frontend\`:

```
app/(app)/master/users/page.tsx   # + telegram_user_id column & field
app/(app)/nilai/page.tsx          # Tugas read-only + breakdown + Tugas manager; main save = UTS/UAS only
```

---

## Task 0: Run the web app for verification

- [ ] **Step 1: Start backend (A1 applied) + frontend**

Backend running per A1 Task 0 (`go run ./cmd/server` on :8080). Then:
```bash
cd /d/Projects/sim-madrasah-alfath/frontend
cp .env.local.example .env.local   # if missing; ensure NEXT_PUBLIC_API_BASE points at the backend
npm install
npm run dev
```
Expected: Next.js dev server on http://localhost:3000.

- [ ] **Step 2: Log in as admin in the browser**

Open http://localhost:3000 → log in `admin` / `admin123`. Confirm the sidebar shows Master → User and Nilai.

---

## Task 1: Add telegram_user_id to the user form

**Files:**
- Modify: `app/(app)/master/users/page.tsx`

- [ ] **Step 1: Add the column and field**

Replace the file with:
```tsx
"use client";

import MasterCrud from "@/components/MasterCrud";

export default function UsersMaster() {
  return (
    <MasterCrud
      title="User"
      basePath="/users"
      columns={[
        { key: "username", label: "Username" },
        { key: "nama", label: "Nama" },
        { key: "role", label: "Role" },
        { key: "telegram_user_id", label: "Telegram ID", render: (r) => r.telegram_user_id ?? "-" },
        { key: "is_active", label: "Status", render: (r) => (r.is_active ? "Aktif" : "Nonaktif") },
      ]}
      fields={[
        { key: "username", label: "Username", required: true, disabledOnEdit: true },
        { key: "nama", label: "Nama", required: true },
        {
          key: "role", label: "Role", type: "select", required: true,
          options: [
            { value: "admin", label: "Admin" },
            { value: "guru", label: "Guru" },
            { value: "kepala", label: "Kepala" },
          ],
        },
        { key: "password", label: "Password", type: "password", required: true, optionalOnEdit: true },
        { key: "telegram_user_id", label: "Telegram User ID", type: "number", placeholder: "mis. 123456789 (kosongkan jika tidak pakai bot)" },
        { key: "is_active", label: "Status", type: "boolean", hideOnCreate: true },
      ]}
    />
  );
}
```
(`MasterCrud` already converts a `number` field to `null` when blank, else `Number(v)` — matching the backend `*int64`.)

- [ ] **Step 2: Verify in the browser**

Master → User → Edit the `guru` user → set **Telegram User ID** = `999000111` → Simpan. The table row shows `Telegram ID = 999000111`. Reopen Edit → the field is pre-filled. Clear it → Simpan → row shows `-`.

- [ ] **Step 3: Cross-check the API**

```bash
curl -s -b /tmp/sim_cookies.txt http://localhost:8080/api/v1/users
```
Expected: the `guru` row reflects the value you set (number) or `null` after clearing.

- [ ] **Step 4: Commit (in sim-madrasah-alfath repo)**

```bash
cd /d/Projects/sim-madrasah-alfath
git add frontend/app/\(app\)/master/users/page.tsx
git commit -m "feat(web): set telegram_user_id from the user form"
```

---

## Task 2: Nilai page — Tugas read-only + breakdown + Tugas manager

The nilai page must (a) show `tugas` as a read-only derived average plus a T1…Tn breakdown, (b) on the main **Simpan** send only `uts`/`uas` (so it never overwrites the bot's Tugas average — A1 made the endpoint component-aware), and (c) provide a **Kelola Tugas** panel to enter/edit a specific "Tugas ke-N" via `/nilai/tugas/batch`.

**Files:**
- Modify: `app/(app)/nilai/page.tsx`

- [ ] **Step 1: Replace the page with the version below**

```tsx
"use client";

import { useEffect, useState } from "react";
import { api, exportUrl } from "@/lib/api";

type Opt = { id: number; nama: string };
type Item = {
  santri_id: number;
  nama: string;
  nis: string;
  tugas: number | null;
  uts: number | null;
  uas: number | null;
};
type TugasEntry = { ke: number; nilai: number };
type TugasRow = { santri_id: number; nama: string; list: TugasEntry[]; rata: number | null };

function hitungAkhir(t: number | null, u: number | null, a: number | null) {
  const v = (x: number | null) => (x == null ? 0 : x);
  return Math.round((v(t) * 0.3 + v(u) * 0.3 + v(a) * 0.4) * 100) / 100;
}

export default function NilaiPage() {
  const [kelas, setKelas] = useState<Opt[]>([]);
  const [mapel, setMapel] = useState<Opt[]>([]);
  const [periode, setPeriode] = useState<Opt[]>([]);
  const [kelasId, setKelasId] = useState("");
  const [mapelId, setMapelId] = useState("");
  const [periodeId, setPeriodeId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // Tugas (riwayat ke-1..n)
  const [tugasRows, setTugasRows] = useState<TugasRow[]>([]);
  const [nextKe, setNextKe] = useState(1);
  const [editKe, setEditKe] = useState<number | null>(null); // null = panel tertutup
  const [tugasInputs, setTugasInputs] = useState<Record<number, string>>({});
  const [savingTugas, setSavingTugas] = useState(false);

  useEffect(() => {
    api("/kelas?aktif=1").then(setKelas).catch(() => {});
    api("/periode").then(setPeriode).catch(() => {});
  }, []);

  useEffect(() => {
    setMapelId("");
    if (!kelasId) { setMapel([]); return; }
    api(`/kelas/${kelasId}/mapel`)
      .then((list: any[]) => setMapel(list.map((m) => ({ id: m.mata_pelajaran_id, nama: m.nama }))))
      .catch(() => setMapel([]));
  }, [kelasId]);

  const ready = kelasId && mapelId && periodeId;

  async function loadTugas() {
    if (!ready) { setTugasRows([]); setNextKe(1); return; }
    const d = await api(`/nilai/tugas?kelas_id=${kelasId}&mata_pelajaran_id=${mapelId}&periode_id=${periodeId}`);
    setTugasRows(d.items || []);
    setNextKe(d.next_ke || 1);
  }

  async function load() {
    if (!ready) { setItems([]); setTugasRows([]); return; }
    const d = await api(`/nilai?kelas_id=${kelasId}&mata_pelajaran_id=${mapelId}&periode_id=${periodeId}`);
    setItems(d.items);
    setEditKe(null);
    setMsg("");
    await loadTugas();
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [kelasId, mapelId, periodeId]);

  function setVal(id: number, field: "uts" | "uas", val: string) {
    const num = val === "" ? null : Math.max(0, Math.min(100, Number(val)));
    setItems((prev) => prev.map((it) => (it.santri_id === id ? { ...it, [field]: num } : it)));
  }

  // Simpan utama: HANYA UTS/UAS (tugas berasal dari rata-rata nilai_tugas — jangan ditimpa).
  async function simpan() {
    setSaving(true);
    setMsg("");
    try {
      const d = await api("/nilai/batch", {
        method: "POST",
        body: {
          kelas_id: Number(kelasId),
          mata_pelajaran_id: Number(mapelId),
          periode_id: Number(periodeId),
          items: items.map((i) => ({ santri_id: i.santri_id, uts: i.uts, uas: i.uas })),
        },
      });
      setMsg(`UTS/UAS tersimpan: ${d.saved} santri.`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  function tugasOf(santriId: number): TugasRow | undefined {
    return tugasRows.find((t) => t.santri_id === santriId);
  }

  function openTugas(ke: number) {
    setEditKe(ke);
    // prefill nilai ke-tsb bila sudah ada
    const init: Record<number, string> = {};
    for (const r of tugasRows) {
      const found = r.list.find((e) => e.ke === ke);
      init[r.santri_id] = found ? String(found.nilai) : "";
    }
    setTugasInputs(init);
    setMsg("");
  }

  async function simpanTugas() {
    if (editKe == null) return;
    setSavingTugas(true);
    setMsg("");
    try {
      const itemsT = Object.entries(tugasInputs)
        .filter(([, v]) => v !== "")
        .map(([sid, v]) => ({ santri_id: Number(sid), nilai: Math.max(0, Math.min(100, Number(v))) }));
      if (itemsT.length === 0) { setMsg("Isi minimal satu nilai tugas."); return; }
      const d = await api("/nilai/tugas/batch", {
        method: "POST",
        body: {
          kelas_id: Number(kelasId),
          mata_pelajaran_id: Number(mapelId),
          periode_id: Number(periodeId),
          ke: editKe,
          items: itemsT,
        },
      });
      setMsg(`Tugas ke-${d.ke} tersimpan: ${d.saved} santri.`);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSavingTugas(false);
    }
  }

  function exportExcel() {
    const url = exportUrl(`/nilai/export?kelas_id=${kelasId}&mata_pelajaran_id=${mapelId}&periode_id=${periodeId}`);
    window.open(url, "_blank");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Input Nilai</h1>
      <p className="muted" style={{ margin: 0 }}>
        Bobot Nilai Akhir: Tugas 30% + UTS 30% + UAS 40%. Nilai <strong>Tugas = rata-rata Tugas ke-1..n</strong> (kelola di panel Tugas; kolom Tugas tidak diedit langsung).
      </p>

      <div className="row">
        <select className="input" value={kelasId} onChange={(e) => setKelasId(e.target.value)}>
          <option value="">— kelas —</option>
          {kelas.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
        </select>
        <select className="input" value={mapelId} onChange={(e) => setMapelId(e.target.value)}>
          <option value="">— mata pelajaran —</option>
          {mapel.map((m) => <option key={m.id} value={m.id}>{m.nama}</option>)}
        </select>
        <select className="input" value={periodeId} onChange={(e) => setPeriodeId(e.target.value)}>
          <option value="">— periode —</option>
          {periode.map((p) => <option key={p.id} value={p.id}>{p.nama}</option>)}
        </select>
        <button className="btn" onClick={simpan} disabled={saving || !items.length}>
          {saving ? "Menyimpan..." : "Simpan UTS/UAS"}
        </button>
        <button className="btn secondary" onClick={exportExcel} disabled={!ready || !items.length}>
          ⬇ Ekspor Excel
        </button>
      </div>

      {msg && <div className="card" style={{ padding: 12 }}>{msg}</div>}

      {ready && items.length > 0 && (
        <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <strong>Kelola Tugas</strong>
            <div className="row" style={{ gap: 6 }}>
              {Array.from({ length: nextKe - 1 }, (_, i) => i + 1).map((ke) => (
                <button key={ke} className={"btn secondary"} style={{ padding: "5px 10px", outline: editKe === ke ? "2px solid var(--accent)" : "none" }}
                  onClick={() => openTugas(ke)}>Tugas ke-{ke}</button>
              ))}
              <button className="btn" style={{ padding: "5px 10px" }} onClick={() => openTugas(nextKe)}>
                + Tugas ke-{nextKe}
              </button>
            </div>
          </div>
          {editKe != null && (
            <div className="table-wrap" style={{ padding: 0 }}>
              <table>
                <thead><tr><th>Nama</th><th style={{ width: 130 }}>Tugas ke-{editKe}</th></tr></thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.santri_id}>
                      <td>{it.nama}</td>
                      <td>
                        <input className="input" type="number" min={0} max={100} style={{ width: 90 }}
                          value={tugasInputs[it.santri_id] ?? ""}
                          onChange={(e) => setTugasInputs({ ...tugasInputs, [it.santri_id]: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn" onClick={simpanTugas} disabled={savingTugas}>
                  {savingTugas ? "Menyimpan..." : `Simpan Tugas ke-${editKe}`}
                </button>
                <button className="btn secondary" onClick={() => setEditKe(null)}>Tutup</button>
              </div>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>Nama</th>
                <th>Tugas (rata²)</th>
                <th style={{ width: 110 }}>UTS</th>
                <th style={{ width: 110 }}>UAS</th>
                <th style={{ width: 110 }}>Nilai Akhir</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const th = tugasOf(it.santri_id);
                return (
                  <tr key={it.santri_id}>
                    <td>{idx + 1}</td>
                    <td>{it.nama}<div className="muted" style={{ fontSize: 12 }}>{it.nis}</div></td>
                    <td>
                      <strong>{it.tugas ?? "-"}</strong>
                      {th && th.list.length > 0 && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {th.list.map((e) => `T${e.ke} ${e.nilai}`).join(" · ")}
                        </div>
                      )}
                    </td>
                    {(["uts", "uas"] as const).map((f) => (
                      <td key={f}>
                        <input className="input" type="number" min={0} max={100} style={{ width: 80 }}
                          value={it[f] ?? ""} onChange={(e) => setVal(it.santri_id, f, e.target.value)} />
                      </td>
                    ))}
                    <td><strong>{hitungAkhir(it.tugas, it.uts, it.uas)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!ready && <p className="muted">Pilih kelas, mata pelajaran, dan periode untuk mulai input nilai.</p>}
    </div>
  );
}
```

Key changes vs. the original: the main table's Tugas cell is **read-only** (shows `it.tugas` + `T1…Tn` breakdown); `setVal` only handles `uts`/`uas`; the main **Simpan UTS/UAS** posts only those two components (so the bot's Tugas average survives); a **Kelola Tugas** panel lists existing `Tugas ke-1..(next_ke-1)` plus a `+ Tugas ke-{next_ke}` button, and saves the chosen `ke` via `/nilai/tugas/batch`.

- [ ] **Step 2: Verify Tugas entry from the web**

In the browser at Nilai, pick a class + mapel + active periode that has students. In **Kelola Tugas**, click `+ Tugas ke-1`, enter a few scores, **Simpan Tugas ke-1**. Expected: message `Tugas ke-1 tersimpan: N santri`; the main table's Tugas column now shows the entered values as `rata²` with `T1 ..` breakdown; Nilai Akhir updates. Click `+ Tugas ke-2`, enter different scores, save → the Tugas column shows the average of T1 & T2.

- [ ] **Step 3: Verify component-aware main save**

Enter UTS/UAS for a student, click **Simpan UTS/UAS**. Reload (re-pick or refresh). Expected: UTS/UAS persisted AND the Tugas average from Step 2 is unchanged (not blanked). Cross-check:
```bash
curl -s -b /tmp/sim_cookies.txt "http://localhost:8080/api/v1/nilai?kelas_id=<id>&mata_pelajaran_id=<id>&periode_id=<id>"
```
Expected: `tugas` equals the Step-2 average; `uts`/`uas` reflect what you typed.

- [ ] **Step 4: Verify bot/web parity (if A2 is also deployed)**

If the bot (A2) is live: enter `Tugas ke-3` via the bot for the same class/mapel, then refresh the web Nilai page → the new T3 appears in the breakdown and the average updates. (If A2 isn't deployed yet, skip — the web path alone is sufficient for A3.)

- [ ] **Step 5: Commit**

```bash
cd /d/Projects/sim-madrasah-alfath
git add frontend/app/\(app\)/nilai/page.tsx
git commit -m "feat(web): Tugas read-only avg + T1..Tn breakdown + Tugas manager; main save = UTS/UAS only"
```

---

## Task 3: End-to-end checkpoint

- [ ] **Step 1: Regression — full three-value entry no longer clobbers Tugas**

In the web: for a fresh student, set Tugas via the panel (ke-1 = 80), then set UTS=70, UAS=90 via the main table and Simpan UTS/UAS. Expected Nilai Akhir = `80*0.3 + 70*0.3 + 90*0.4 = 81.00`, and Tugas stays 80.

- [ ] **Step 2: Confirm users telegram field round-trips once more**

Master → User → set/clear a Telegram ID → confirm table + API reflect it (Task 1 Step 2–3).

- [ ] **Step 3: Commit any stragglers**

```bash
cd /d/Projects/sim-madrasah-alfath
git add -A && git commit -m "chore: Phase A3 web consistency verified" --allow-empty
```

---

## Self-review notes (verified while writing)

- **Spec coverage:** telegram_user_id in web form (PRD §5.1, review §11.2 implies admin can set it) → Task 1. Tugas read-only derived + breakdown shown in web (PRD §6.5, review decision: "tampilkan di web SIM juga") → Task 2 Steps 1–2. Web Tugas input via detail table, not direct column (PRD §6.5 two-writer rule) → Task 2 (`/nilai/tugas/batch`, main save omits tugas). Component-aware coexistence → Task 2 Step 3, Task 3 Step 1.
- **No placeholders:** both files are given in full; every step has a concrete browser action or `curl` with expected output.
- **Type/name consistency:** field key `telegram_user_id` matches the backend column/JSON (A1 Task 3). `/nilai/tugas` response fields `items[].list[].{ke,nilai}`, `next_ke`, and `/nilai/tugas/batch` body `{kelas_id, mata_pelajaran_id, periode_id, ke, items:[{santri_id,nilai}]}` match A1 Task 8 exactly. Main `/nilai/batch` body now `{...items:[{santri_id,uts,uas}]}` relies on A1 Task 7 component-aware merge.
- **Verification model:** manual browser + `curl` cross-check (no frontend test harness in the repo; adding one is out of scope and off-pattern).
- **Deviation flagged:** the Tugas column is no longer directly editable in the web — Tugas is entered only via the Kelola Tugas panel (writes the detail table). This is the agreed two-writer-consistency rule (PRD §6.5); call it out in any user-facing release note.
```
