# Phase B2 — Catatan & Tugas Bot (src/ logic + n8n rewiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new teacher flows to `AlFath Bot v2` — `/catatan` (pick kelas → pick santri → show last 5 notes → write a new note) and `/tugas` (pick kelas → pick mapel → deskripsi → tenggat → save) — reading/writing the Phase B1 SIM endpoints.

**Architecture:** Two parts. **Part 1** is pure JavaScript in `src/` (a date parser + three summary formatters) built with `node:test` TDD — zero I/O. **Part 2** extends the existing `AlFath Bot v2` n8n workflow: two new outputs on the `Dispatch` switch, two sub-flows (mirroring the `/absen` and `/nilai` patterns), and an extension of the shared force-reply handler (`CheckForcereply` + `SwitchFR`). n8n Code nodes contain verbatim copies of the `src/` functions (single source of truth = `src/`).

**Tech Stack:** Node 18+ (`node --test`), n8n (Telegram + HTTP Request + Code + Switch + IF nodes, workflow static data), SIM REST API from Phase B1.

**Depends on:** **Phase B1** (`POST/GET /catatan`, `POST/GET /tugas`) deployed and reachable at the same `SIM_BASE` the bot already uses. **Spec references:** design doc §3, §4, §5.

## Global Constraints

- **callback_data scheme** (≤64 bytes): `"<cmd>:<action>[:<arg>]"`. New: `catatan:kelas:<id>`, `catatan:santri:<santri_id>`, `tugas:kelas:<id>`, `tugas:mapel:<mapel_id>`.
- **Session** lives in `$getWorkflowStaticData('global')` under `sess_<chat_id>`; load/mutate/persist exactly as the existing flows do.
- n8n Code-node bodies are **verbatim copies** of `src/` functions — keep them in sync.
- The existing `Route` node already derives `route = cmd` for both messages and callbacks; **no change needed there**. Only `Dispatch` gains outputs.
- The bot's base URL is the SIM API root the existing HTTP nodes already use (e.g. `http://103.175.219.47/api/v1`). New HTTP nodes use the **same base** and `Authorization: Bearer {{ $('BotLogin').item.json.token }}`.

---

## File structure (Part 1, under Al-Fath Automation repo)

```
src/parsers/tanggal.js   # NEW parseTenggat
src/format/summary.js    # +formatCatatanList, formatCatatanSaved, formatTugasSaved
tests/tanggal.test.js    # NEW
tests/summary.test.js    # +3 tests (file exists from A2)
```

---

# PART 1 — Pure logic (`src/`, TDD)

## Task 1: tenggat parser

**Files:**
- Test: `tests/tanggal.test.js`
- Create: `src/parsers/tanggal.js`

**Interfaces:**
- Produces: `parseTenggat(text) -> { date: string } | { date: null } | { error: string }`. `/lewati` → `{date:null}`; valid `YYYY-MM-DD` → `{date:text}`; empty/malformed → `{error}`.

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTenggat } = require('../src/parsers/tanggal');

test('/lewati yields null date (skip)', () => {
  assert.deepEqual(parseTenggat('/lewati'), { date: null });
  assert.deepEqual(parseTenggat('  /LEWATI '), { date: null });
});

test('valid YYYY-MM-DD passes through', () => {
  assert.deepEqual(parseTenggat('2026-07-05'), { date: '2026-07-05' });
});

test('malformed or out-of-range is an error', () => {
  assert.match(parseTenggat('5 Juli').error, /YYYY-MM-DD/);
  assert.match(parseTenggat('2026-13-40').error, /tidak valid|YYYY-MM-DD/);
  assert.ok(parseTenggat('').error);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/parsers/tanggal'`.

- [ ] **Step 3: Implement**

```javascript
// src/parsers/tanggal.js
function parseTenggat(text) {
  const t = (text || '').trim();
  if (t === '') return { error: 'Tenggat kosong. Kirim YYYY-MM-DD atau /lewati.' };
  if (t.toLowerCase() === '/lewati') return { date: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return { error: 'Format tanggal harus YYYY-MM-DD, atau /lewati.' };
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { error: 'Tanggal tidak valid.' };
  return { date: t };
}
module.exports = { parseTenggat };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/tanggal.js tests/tanggal.test.js
git commit -m "feat: add tested tenggat parser"
```

---

## Task 2: catatan & tugas summary formatters

**Files:**
- Modify: `src/format/summary.js`
- Test: `tests/summary.test.js` (append)

**Interfaces:**
- Consumes: existing `src/format/summary.js` exports (`formatAbsenSummary`, `formatNilaiSummary`, `formatTugasHistory`).
- Produces: `formatCatatanList(nama, list) -> string` (list = `[{tanggal, teks}]`); `formatCatatanSaved(nama) -> string`; `formatTugasSaved(mapel, kelas, tenggat) -> string` (tenggat may be `null`).

- [ ] **Step 1: Append the failing tests**

Add to the end of `tests/summary.test.js` (before nothing — just append; the `require` at the top already imports from `../src/format/summary`, so extend that destructure):

```javascript
// --- Phase B additions ---
const {
  formatCatatanList, formatCatatanSaved, formatTugasSaved,
} = require('../src/format/summary');

test('formatCatatanList renders recent notes newest-first', () => {
  const s = formatCatatanList('Budi', [
    { tanggal: '2026-06-29', teks: 'Aktif bertanya.' },
    { tanggal: '2026-06-28', teks: 'Lupa buku.' },
  ]);
  assert.match(s, /Catatan terakhir untuk Budi/);
  assert.match(s, /• 2026-06-29: Aktif bertanya\./);
  assert.match(s, /• 2026-06-28: Lupa buku\./);
});

test('formatCatatanList handles empty history', () => {
  assert.equal(formatCatatanList('Budi', []), 'Belum ada catatan untuk Budi.');
});

test('formatCatatanSaved confirms by name', () => {
  assert.equal(formatCatatanSaved('Budi'), '✅ Catatan untuk Budi tersimpan.');
});

test('formatTugasSaved includes tenggat only when set', () => {
  assert.equal(formatTugasSaved('Matematika', '4A', '2026-07-05'),
    '✅ Tugas Matematika 4A tersimpan. (tenggat 2026-07-05)');
  assert.equal(formatTugasSaved('IPA', '5B', null),
    '✅ Tugas IPA 5B tersimpan.');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `formatCatatanList is not a function` (undefined export).

- [ ] **Step 3: Implement**

In `src/format/summary.js`, add the three functions and extend `module.exports`:
```javascript
function formatCatatanList(nama, list) {
  if (!list || list.length === 0) return `Belum ada catatan untuk ${nama}.`;
  const lines = list.map((c) => `• ${c.tanggal}: ${c.teks}`).join('\n');
  return `Catatan terakhir untuk ${nama}:\n${lines}`;
}

function formatCatatanSaved(nama) {
  return `✅ Catatan untuk ${nama} tersimpan.`;
}

function formatTugasSaved(mapel, kelas, tenggat) {
  let txt = `✅ Tugas ${mapel} ${kelas} tersimpan.`;
  if (tenggat) txt += ` (tenggat ${tenggat})`;
  return txt;
}

module.exports = {
  formatAbsenSummary, formatNilaiSummary, formatTugasHistory,
  formatCatatanList, formatCatatanSaved, formatTugasSaved,
};
```
(Replace the existing single `module.exports = { formatAbsenSummary, formatNilaiSummary, formatTugasHistory };` line with the combined export above.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS — all suites (callback, keyboard, absen, scores, nilai, summary, tanggal + existing attendance, roster).

- [ ] **Step 5: Commit**

```bash
git add src/format/summary.js tests/summary.test.js
git commit -m "feat: add tested catatan/tugas formatters"
```

---

# PART 2 — n8n rewiring (`AlFath Bot v2`, workflow id `FgDK2YXQDy2RtwS5`)

> Code-node bodies are copied verbatim from Part 1 / the existing flows. **State pattern** (everywhere):
> `const sd = $getWorkflowStaticData('global'); const sess = sd['sess_'+String(n.chatId)] || {};`, mutate, then `sd['sess_'+String(n.chatId)] = sess;`.
> `n = $('Normalize').item.json` gives `{chatId, telegramUserId, messageId, callbackId, callbackData, text, isCallback}`. `cb = $('Route').item.json.cb` gives `{cmd, action, args}` on callbacks.

## Task 3: Add `catatan` & `tugas` outputs to the Dispatch switch

- [ ] **Step 1: Add two Switch rules**

Open `Dispatch` (Switch). Add rule `r5`: `={{ $json.route }}` equals `catatan` → renamed output `catatan`. Add rule `r6`: `={{ $json.route }}` equals `tugas` → renamed output `tugas`. Keep the existing `extra` fallback. (Both `/catatan` messages and `catatan:*` callbacks already arrive with `route='catatan'` via the existing `Route` node; same for tugas.)

- [ ] **Step 2: Update the `/menu` help text**

Open `Send: Menu` and append two lines to the text:
```
/catatan [nama kelas] — catat catatan santri
/tugas [nama kelas] — umumkan tugas/PR
```

- [ ] **Step 3: Verify**

Save & activate. Send `/menu` → the two new lines appear. Send `/catatan` → in n8n Executions, `Dispatch` routes to the new `catatan` output (it will dead-end until Task 4 — that's expected).

---

## Task 4: `/catatan` flow

> Three entry shapes on the `catatan` route: (a) `/catatan [kelas]` message → resolve class; (b) `catatan:kelas:<id>` callback → load roster; (c) `catatan:santri:<id>` callback → show recent notes + ask for text. The new note is saved by the force-reply handler (Task 6).

- [ ] **Step 1: Split start vs callback**

`catatan` output → **IF** `CatatanIsStart?`: condition `={{ $('Route').item.json.isCallback }}` is false.
- TRUE (start) → Step 2.
- FALSE (callback) → Step 4.

- [ ] **Step 2: Resolve class (start branch)**

Start → **HTTP** `GetKelas_Catatan` (GET `={{ $env.SIM_BASE }}/kelas?aktif=1`, Bearer) → **Code** `MatchKelas_Catatan`:
```javascript
const n = $('Normalize').item.json;
const arg = (($('Route').item.json.arg) || '').trim().toLowerCase();
const list = $input.first().json;
const found = arg ? list.find((k) => String(k.nama).toLowerCase() === arg) : null;
const sd = $getWorkflowStaticData('global');
sd['sess_' + n.chatId] = { cmd: 'catatan', kelas_id: found ? found.id : null, kelas_nama: found ? found.nama : null };
return [{ json: { found: found || null, list, chatId: n.chatId } }];
```
→ **IF** `HasClass_Catatan?`: `={{ $json.found }}` is not empty.
- FALSE → **Telegram** `SendPickKelas_Catatan` (Send Message; build buttons in a small Code node pasting `buildPickKeyboard`):
  ```javascript
  // paste buildPickKeyboard (src/format/keyboard.js)
  const list = $('MatchKelas_Catatan').item.json.list;
  const n = $('Normalize').item.json;
  return [{ json: { chatId: n.chatId, text: 'Pilih kelas:', keyboard: buildPickKeyboard(list, 'catatan', 'kelas', 'nama', 'id') } }];
  ```
  then Send Message with `reply_markup` = `={{ { inline_keyboard: $json.keyboard } }}`.
- TRUE → go to Step 3.

- [ ] **Step 3: Load roster & send santri buttons (matched class)**

TRUE branch → **HTTP** `GetSantri_Catatan` (GET `={{ $env.SIM_BASE }}/santri?kelas_id={{ $('MatchKelas_Catatan').item.json.found.id }}`, Bearer) → **Code** `BuildSantriButtons_Catatan` (also stores a `santri_id → nama` roster in the session so the next callback can show the name):
```javascript
// paste buildPickKeyboard
const rows = $input.first().json;
const n = $('Normalize').item.json;
const sd = $getWorkflowStaticData('global');
const sess = sd['sess_' + n.chatId] || { cmd: 'catatan' };
sess.roster = rows.map((r) => ({ santri_id: r.id, nama: r.nama }));
sd['sess_' + n.chatId] = sess;
const kb = buildPickKeyboard(rows, 'catatan', 'santri', 'nama', 'id', 2);
return [{ json: { chatId: n.chatId, text: 'Pilih santri:', keyboard: kb } }];
```
→ **Telegram** `SendPickSantri_Catatan` (Send Message, `reply_markup` = inline_keyboard).

- [ ] **Step 4: Handle callbacks (callback branch)**

FALSE branch → **Code** `CatatanCb`:
```javascript
const n = $('Normalize').item.json;
const cb = $('Route').item.json.cb;            // {cmd, action, args}
const sd = $getWorkflowStaticData('global');
let sess = sd['sess_' + n.chatId] || { cmd: 'catatan' };
if (cb.action === 'kelas') {
  sess.cmd = 'catatan'; sess.kelas_id = Number(cb.args[0]); sd['sess_' + n.chatId] = sess;
  return [{ json: { kind: 'pickSantri', kelas_id: sess.kelas_id, chatId: n.chatId, callbackId: n.callbackId } }];
}
if (cb.action === 'santri') {
  sess.cmd = 'catatan'; sess.santri_id = Number(cb.args[0]);
  const r = (sess.roster || []).find((x) => x.santri_id === sess.santri_id);
  sess.santri_nama = r ? r.nama : null;
  sd['sess_' + n.chatId] = sess;
  return [{ json: { kind: 'showNotes', santri_id: sess.santri_id, chatId: n.chatId, callbackId: n.callbackId } }];
}
return [{ json: { kind: 'noop', chatId: n.chatId, callbackId: n.callbackId } }];
```
→ **Switch** `SwitchCatatanKind` on `={{ $json.kind }}`: outputs `pickSantri`, `showNotes`, fallback `extra`.

- [ ] **Step 5: `pickSantri` callback → roster buttons**

`pickSantri` → **HTTP** `GetSantri_Catatan2` (GET `/santri?kelas_id={{ $('CatatanCb').item.json.kelas_id }}`, Bearer) → reuse the same `BuildSantriButtons_Catatan` logic (a second Code node identical to Step 3) → **Telegram** `SendPickSantri_Catatan2` (Send Message, inline_keyboard) + **Telegram** Answer Callback Query (`callbackId`).

- [ ] **Step 6: `showNotes` callback → recent notes + force-reply**

`showNotes` → **HTTP** `GetCatatanRecent` (GET `={{ $env.SIM_BASE }}/catatan?santri_id={{ $('CatatanCb').item.json.santri_id }}&limit=5`, Bearer) → **Code** `BuildCatatanPrompt` (pastes `formatCatatanList`):
```javascript
// paste formatCatatanList (src/format/summary.js)
const n = $('Normalize').item.json;
const list = $input.first().json;              // array of {tanggal, teks, ...}
const sd = $getWorkflowStaticData('global');
const sess = sd['sess_' + n.chatId] || { cmd: 'catatan' };
const nama = sess.santri_nama || 'santri';     // set by CatatanCb from the stored roster
sess.awaitCatatan = true; sd['sess_' + n.chatId] = sess;
return [{ json: { chatId: n.chatId, text: formatCatatanList(nama, list) + '\n\nTulis catatan baru:', callbackId: n.callbackId } }];
```
→ **Telegram** `SendCatatanPrompt` (Send Message, `reply_markup` = `={{ { force_reply: true, input_field_placeholder: 'mis. Aktif bertanya hari ini' } }}`) + Answer Callback Query.

> `sess.santri_nama` is populated by `CatatanCb` (Step 4) from the `sess.roster` stored in `BuildSantriButtons_Catatan` (Step 3), so the header shows the real name.

- [ ] **Step 7: Verify `/catatan` up to the prompt**

`/catatan <kelas>` → santri buttons. Tap a santri → bot shows last notes (or "Belum ada catatan…") + a force-reply asking for the new note. (Saving is Task 6.)

---

## Task 5: `/tugas` flow

> Entry shapes on the `tugas` route: (a) `/tugas [kelas]` message → resolve class; (b) `tugas:kelas:<id>` callback → load mapel; (c) `tugas:mapel:<id>` callback → ask deskripsi (force-reply). deskripsi & tenggat are captured by the force-reply handler (Task 6).

- [ ] **Step 1: Split start vs callback**

`tugas` output → **IF** `TugasIsStart?`: `={{ $('Route').item.json.isCallback }}` is false.
- TRUE → Step 2. FALSE → Step 4.

- [ ] **Step 2: Resolve class (start branch)**

Start → **HTTP** `GetKelas_Tugas` (GET `/kelas?aktif=1`, Bearer) → **Code** `MatchKelas_Tugas`:
```javascript
const n = $('Normalize').item.json;
const arg = (($('Route').item.json.arg) || '').trim().toLowerCase();
const list = $input.first().json;
const found = arg ? list.find((k) => String(k.nama).toLowerCase() === arg) : null;
const sd = $getWorkflowStaticData('global');
sd['sess_' + n.chatId] = { cmd: 'tugas', kelas_id: found ? found.id : null, kelas_nama: found ? found.nama : null };
return [{ json: { found: found || null, list, chatId: n.chatId } }];
```
→ **IF** `HasClass_Tugas?`: `={{ $json.found }}` is not empty.
- FALSE → **Code** (paste `buildPickKeyboard`) build `buildPickKeyboard(list,'tugas','kelas','nama','id')` → **Telegram** `SendPickKelas_Tugas`.
- TRUE → Step 3.

- [ ] **Step 3: Load mapel & send buttons (matched class)**

TRUE → **HTTP** `GetMapel_Tugas` (GET `={{ $env.SIM_BASE }}/kelas/{{ $('MatchKelas_Tugas').item.json.found.id }}/mapel`, Bearer) → **Code** `BuildMapelButtons_Tugas` (also stores a `mapel_id → nama` map in the session so the confirmation can show the name):
```javascript
// paste buildPickKeyboard
const list = $input.first().json;              // [{mata_pelajaran_id, nama, ...}]
const n = $('Normalize').item.json;
const sd = $getWorkflowStaticData('global');
const sess = sd['sess_' + n.chatId] || { cmd: 'tugas' };
sess.mapelList = list.map((m) => ({ id: m.mata_pelajaran_id, nama: m.nama }));
sd['sess_' + n.chatId] = sess;
const kb = buildPickKeyboard(list, 'tugas', 'mapel', 'nama', 'mata_pelajaran_id', 2);
return [{ json: { chatId: n.chatId, text: 'Pilih mata pelajaran:', keyboard: kb } }];
```
→ **Telegram** `SendPickMapel_Tugas` (Send Message, inline_keyboard).

- [ ] **Step 4: Handle callbacks (callback branch)**

FALSE → **Code** `TugasCb`:
```javascript
const n = $('Normalize').item.json;
const cb = $('Route').item.json.cb;
const sd = $getWorkflowStaticData('global');
let sess = sd['sess_' + n.chatId] || { cmd: 'tugas' };
if (cb.action === 'kelas') {
  sess.cmd = 'tugas'; sess.kelas_id = Number(cb.args[0]); sd['sess_' + n.chatId] = sess;
  return [{ json: { kind: 'pickMapel', kelas_id: sess.kelas_id, chatId: n.chatId, callbackId: n.callbackId } }];
}
if (cb.action === 'mapel') {
  sess.cmd = 'tugas'; sess.mapel_id = Number(cb.args[0]); sess.awaitField = 'deskripsi';
  const fm = (sess.mapelList || []).find((m) => m.id === sess.mapel_id);
  sess.mapel_nama = fm ? fm.nama : null;
  sd['sess_' + n.chatId] = sess;
  return [{ json: { kind: 'askDeskripsi', chatId: n.chatId, callbackId: n.callbackId } }];
}
return [{ json: { kind: 'noop', chatId: n.chatId, callbackId: n.callbackId } }];
```
→ **Switch** `SwitchTugasKind` on `={{ $json.kind }}`: outputs `pickMapel`, `askDeskripsi`, fallback `extra`.

- [ ] **Step 5: `pickMapel` → mapel buttons; store kelas_nama & mapel_nama**

`pickMapel` → **HTTP** `GetMapel_Tugas2` (GET `/kelas/{{ $('TugasCb').item.json.kelas_id }}/mapel`, Bearer) → **Code** identical to `BuildMapelButtons_Tugas` (Step 3 — also stores `sess.mapelList`) → **Telegram** `SendPickMapel_Tugas2` + Answer Callback Query.

> Because `BuildMapelButtons_Tugas` stores `sess.mapelList` and `TugasCb` sets `sess.mapel_nama` from it (Step 4), the final confirmation shows the real mapel name. `sess.kelas_nama` is set when the class is resolved (start branch `MatchKelas_Tugas`, or — for the `tugas:kelas` callback path — store it in `TugasCb`'s `kelas` branch the same way if you want the class name in the confirmation; otherwise it shows blank, harmless).

- [ ] **Step 6: `askDeskripsi` → force-reply prompt**

`askDeskripsi` → **Telegram** `SendDeskripsiPrompt` (Send Message, text `Deskripsi tugas? (mis. "Kerjakan LKS hal. 12")`, `reply_markup` = `={{ { force_reply: true, input_field_placeholder: 'Kerjakan LKS hal. 12' } }}`) + Answer Callback Query.

- [ ] **Step 7: Verify `/tugas` up to the prompt**

`/tugas <kelas>` → mapel buttons. Tap a mapel → bot asks for the deskripsi via force-reply. (Saving is Task 6.)

---

## Task 6: Extend the force-reply handler (catatan text + tugas deskripsi/tenggat)

> `CheckForcereply` is the shared handler that runs on the `extra`/fallback route for non-command messages. Extend it to capture: catatan text, tugas deskripsi, and tugas tenggat. `SwitchFR` routes the new `kind`s to save/prompt nodes.

- [ ] **Step 1: Extend `CheckForcereply`**

Open `CheckForcereply` (Code). Paste `parseTenggat` at the top (verbatim from `src/parsers/tanggal.js`). After the existing `nilai` block and **before** the final `return [{json:{handled:false}}]`, insert:
```javascript
// --- Phase B: catatan ---
if (sess.cmd === 'catatan' && sess.awaitCatatan) {
  const teks = (n.text || '').trim();
  if (!teks || teks === '/batal') {
    delete sd['sess_' + n.chatId];
    return [{ json: { handled: true, kind: 'reprompt', text: teks === '/batal' ? 'Dibatalkan.' : 'Catatan kosong, dibatalkan.', chatId: n.chatId } }];
  }
  const body = { santri_id: sess.santri_id, teks };
  const nama = sess.santri_nama || 'santri';
  delete sd['sess_' + n.chatId];
  return [{ json: { handled: true, kind: 'catatanSave', body, nama, chatId: n.chatId } }];
}
// --- Phase B: tugas deskripsi ---
if (sess.cmd === 'tugas' && sess.awaitField === 'deskripsi') {
  const desk = (n.text || '').trim();
  if (!desk) return [{ json: { handled: true, kind: 'reprompt', text: 'Deskripsi kosong. Ketik lagi.', chatId: n.chatId } }];
  sess.deskripsi = desk; sess.awaitField = 'tenggat'; sd['sess_' + n.chatId] = sess;
  return [{ json: { handled: true, kind: 'tugasAskTenggat', chatId: n.chatId } }];
}
// --- Phase B: tugas tenggat ---
if (sess.cmd === 'tugas' && sess.awaitField === 'tenggat') {
  const res = parseTenggat(n.text);
  if (res.error) return [{ json: { handled: true, kind: 'tugasTenggatErr', text: res.error, chatId: n.chatId } }];
  const body = { kelas_id: sess.kelas_id, mata_pelajaran_id: sess.mapel_id, deskripsi: sess.deskripsi };
  if (res.date) body.tenggat = res.date;
  const out = { handled: true, kind: 'tugasSave', body, mapel: sess.mapel_nama || ('mapel ' + sess.mapel_id), kelas: sess.kelas_nama || '', tenggat: res.date, chatId: n.chatId };
  delete sd['sess_' + n.chatId];
  return [{ json: out }];
}
```

- [ ] **Step 2: Add `SwitchFR` outputs**

Open `SwitchFR` (Switch). Add rules routing `={{ $json.kind }}` equals → renamed output, for each: `catatanSave`, `tugasAskTenggat`, `tugasSave`, `tugasTenggatErr`, `reprompt`. Keep existing `ket`/`nilaiSave`/`nilaiErrors` + `extra` fallback.

- [ ] **Step 3: Wire `catatanSave`**

`catatanSave` → **HTTP** `PostCatatan` (POST `={{ $env.SIM_BASE }}/catatan`, Bearer, raw JSON body `={{ JSON.stringify($json.body) }}`) → **Code** `BuildCatatanSaved` (paste `formatCatatanSaved`):
```javascript
// paste formatCatatanSaved
const fr = $('CheckForcereply').item.json;
return [{ json: { chatId: fr.chatId, text: formatCatatanSaved(fr.nama) } }];
```
→ **Telegram** Send Message `={{ $json.text }}`.

- [ ] **Step 4: Wire `tugasAskTenggat`**

`tugasAskTenggat` → **Telegram** `SendTenggatPrompt` (Send Message, chatId `={{ $('CheckForcereply').item.json.chatId }}`, text `Tenggat? (YYYY-MM-DD, atau /lewati)`, `reply_markup` = `={{ { force_reply: true, input_field_placeholder: '2026-07-05' } }}`).

- [ ] **Step 5: Wire `tugasSave`**

`tugasSave` → **HTTP** `PostTugas` (POST `={{ $env.SIM_BASE }}/tugas`, Bearer, raw JSON body `={{ JSON.stringify($('CheckForcereply').item.json.body) }}`) → **Code** `BuildTugasSaved` (paste `formatTugasSaved`):
```javascript
// paste formatTugasSaved
const fr = $('CheckForcereply').item.json;
return [{ json: { chatId: fr.chatId, text: formatTugasSaved(fr.mapel, fr.kelas, fr.tenggat) } }];
```
→ **Telegram** Send Message.

- [ ] **Step 6: Wire `tugasTenggatErr` and `reprompt`**

- `tugasTenggatErr` → **Telegram** Send Message (chatId from `CheckForcereply`, text `={{ $json.text }}`, `reply_markup` force_reply `input_field_placeholder: '2026-07-05'`) — re-asks tenggat (session still has `awaitField='tenggat'`).
- `reprompt` → **Telegram** Send Message (text `={{ $json.text }}`) — plain confirmation/cancel.

- [ ] **Step 7: Verify both saves end-to-end**

1. `/catatan <kelas>` → pick santri → reply `Aktif bertanya hari ini` → `✅ Catatan untuk … tersimpan.` Confirm via `GET /catatan?santri_id=` (or re-open `/catatan` for that santri → the new note shows in the recent list).
2. `/tugas <kelas>` → pick mapel → reply deskripsi → reply `2026-07-05` → `✅ Tugas <mapel> <kelas> tersimpan. (tenggat 2026-07-05)`. Confirm via `GET /tugas?kelas_id=`.
3. `/tugas <kelas>` → pick mapel → deskripsi → reply `/lewati` → saved with no tenggat (`✅ Tugas … tersimpan.` without the tenggat suffix).
4. Tenggat typo (`5 juli`) → bot re-asks with the format hint; a subsequent valid date saves.

---

## Task 7: Export the workflow & sync the repo

- [ ] **Step 1: Export `AlFath Bot v2`**

Export the updated workflow JSON and overwrite `docs/superpowers/n8n/alfath-bot-v2-workflow.json`.

- [ ] **Step 2: Commit (Al-Fath Automation repo)**

```bash
cd "/d/Projects/Al-Fath Automation"
git add docs/superpowers/n8n/alfath-bot-v2-workflow.json
git commit -m "feat: add /catatan + /tugas flows to AlFath Bot v2 (Phase B2)"
```

---

## Task 8: End-to-end checkpoint

- [ ] **Step 1: Run all logic tests**

Run: `npm test`
Expected: PASS — Part 1 suites (callback, keyboard, absen, scores, nilai, summary, **tanggal**) + existing (attendance, roster). The summary suite now includes the 3 new formatter tests.

- [ ] **Step 2: Full manual smoke (registered teacher)**

`/menu` shows the two new commands; run the `/catatan` and `/tugas` sequences from Task 6 Step 7. Confirm each result via the SIM API (`GET /catatan?santri_id=`, `GET /tugas?kelas_id=`).

- [ ] **Step 3: Regression — existing flows still work**

Run `/daftar <kelas>`, an `/absen` save, and a `/nilai` save. Expected: all still succeed (the only shared node touched is `CheckForcereply`/`SwitchFR`, extended additively; the `ket`/`nilaiSave`/`nilaiErrors` paths are unchanged).

- [ ] **Step 4: Commit any stragglers**

```bash
cd "/d/Projects/Al-Fath Automation"
git add -A && git commit -m "chore: Phase B2 bot catatan/tugas verified" --allow-empty
```

---

## Self-review notes (verified while writing)

- **Spec coverage (design §3–§5):** `/catatan` flow (kelas → santri → show last 5 → write) → Task 4 + Task 6 Step 3. `/tugas` flow (kelas → mapel → deskripsi → tenggat → save) → Task 5 + Task 6 Steps 1,4,5. Two sequential force-replies via `awaitField` → Task 6 Step 1. `parseTenggat` (`/lewati`→null, validate) → Task 1; used in `CheckForcereply` → Task 6. Formatters → Task 2; used in BuildCatatanSaved/BuildTugasSaved/BuildCatatanPrompt. Dispatch + menu → Task 3. Workflow export → Task 7.
- **No placeholders:** Part 1 has complete code + tests; Part 2 names every node type, its key params, and complete Code-node bodies, each task ending in a concrete verification.
- **Type/name consistency:** callback scheme `catatan:kelas:<id>`, `catatan:santri:<id>`, `tugas:kelas:<id>`, `tugas:mapel:<id>` consistent across keyboard builders (Tasks 4–5) and `CatatanCb`/`TugasCb` (`cb.args[0]`). `parseTenggat` return shape (`{date}`/`{error}`) used identically in Task 1 tests and Task 6. `formatTugasSaved(mapel, kelas, tenggat)` signature matches the BuildTugasSaved call. Session keys `cmd`, `kelas_id`, `kelas_nama`, `santri_id`, `mapel_id`, `mapel_nama`, `awaitCatatan`, `awaitField` consistent across flows.
- **Name threading:** `santri_nama` and `mapel_nama` are stored in the session when the pick-buttons are built (`BuildSantriButtons_Catatan` → `sess.roster`; `BuildMapelButtons_Tugas` → `sess.mapelList`) and resolved in `CatatanCb`/`TugasCb`, so the recent-notes header and the tugas confirmation show real names. `kelas_nama` for the tugas confirmation is set on the start branch; for the `tugas:kelas` callback path it's optional (blank is harmless).
- **Deviation flagged:** the bot never calls `GET /tugas` (created in B1) — it's there for Phase C reminders.
```
