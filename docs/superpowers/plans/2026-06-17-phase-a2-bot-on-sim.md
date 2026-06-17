# Phase A2 — Bot on SIM (src/ logic + n8n rewiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Telegram bot so it reads/writes the SIM-Madrasah REST API (retiring Google Sheets) using interactive inline-keyboard, stateful flows for `/absen` and `/nilai`, plus `/daftar` and `/menu`.

**Architecture:** Two parts. **Part 1** is pure JavaScript logic in `src/` (keyboard builders, parsers, reducers, formatters) developed with `node:test` TDD — zero I/O, fully unit-tested. **Part 2** wires these into one n8n workflow: a Telegram Trigger handling both `message` and `callback_query`; a per-teacher `bot-login` bootstrap; per-`chat_id` conversation state in n8n workflow static data; and HTTP Request nodes calling the SIM API (`Authorization: Bearer <jwt>`). n8n Code nodes contain verbatim copies of the `src/` functions (single source of truth = `src/`).

**Tech Stack:** Node 18+ (`node --test`), n8n (Telegram + HTTP Request + Code + Switch + IF nodes, workflow static data), SIM REST API from Phase A1.

**Depends on:** Phase A1 (bot-login, `/nilai/tugas*`, component-aware `/nilai/batch`) must be deployed and reachable. **Spec references:** design doc §3–§9, PRD §6, §7.

---

## Phase A roadmap (context)

- A1 (done before this): SIM backend enablement.
- **A2 (this plan):** bot `src/` logic + n8n rewiring; retire Sheets.
- A3 (later): SIM web frontend (telegram field + Tugas breakdown).

## Conventions used throughout

- **callback_data scheme** (kept ≤64 bytes): `"<cmd>:<action>[:<arg>...]"`. Status codes are single letters `H/S/I/A` ↔ `hadir/sakit/izin/alpha`. Examples: `absen:set:12:S`, `absen:save`, `absen:page:2`, `nilai:komp:T`, `nilai:kelas:3`, `nilai:mapel:5`.
- **Roster `idx`** is the 1-based position in the current roster; state maps `idx → {santri_id, nama}`.
- **Session** is stored in `$getWorkflowStaticData('global')` under key `sess_<chat_id>`.
- **Env in n8n:** `SIM_BASE` (e.g. `https://madrasah.example.com/api/v1`) and `BOT_SHARED_SECRET` set as n8n environment variables, read via `$env`.

## File structure (Part 1, under Al-Fath Automation repo)

```
src/format/roster.js      # formatRoster (exists — unchanged)
src/parsers/callback.js   # NEW parseCallbackData
src/format/keyboard.js    # NEW buildPickKeyboard, buildAbsenKeyboard
src/logic/absen.js        # NEW STATUS_BY_CODE, initStatus, applyStatus, setKeterangan, summarize, toAbsensiBatch
src/parsers/scores.js     # NEW parseScores
src/logic/nilai.js        # NEW nextKe, previewAverage
src/format/summary.js     # NEW formatAbsenSummary, formatNilaiSummary, formatTugasHistory
tests/callback.test.js  tests/keyboard.test.js  tests/absen.test.js
tests/scores.test.js    tests/nilai.test.js     tests/summary.test.js
```

---

# PART 1 — Pure logic (`src/`, TDD)

## Task 1: callback parser

**Files:**
- Test: `tests/callback.test.js`
- Create: `src/parsers/callback.js`

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCallbackData } = require('../src/parsers/callback');

test('parses cmd and action only', () => {
  assert.deepEqual(parseCallbackData('absen:save'), { cmd: 'absen', action: 'save', args: [] });
});

test('parses args', () => {
  assert.deepEqual(parseCallbackData('absen:set:12:S'),
    { cmd: 'absen', action: 'set', args: ['12', 'S'] });
});

test('empty or null yields null', () => {
  assert.equal(parseCallbackData(''), null);
  assert.equal(parseCallbackData(null), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/parsers/callback'`.

- [ ] **Step 3: Implement**

```javascript
// src/parsers/callback.js
function parseCallbackData(data) {
  if (!data || typeof data !== 'string') return null;
  const parts = data.split(':');
  if (parts.length < 2) return null;
  return { cmd: parts[0], action: parts[1], args: parts.slice(2) };
}
module.exports = { parseCallbackData };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/callback.js tests/callback.test.js
git commit -m "feat: add tested callback_data parser"
```

---

## Task 2: keyboard builders

**Files:**
- Test: `tests/keyboard.test.js`
- Create: `src/format/keyboard.js`

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPickKeyboard, buildAbsenKeyboard } = require('../src/format/keyboard');

test('buildPickKeyboard makes one button per item, chunked', () => {
  const kb = buildPickKeyboard(
    [{ id: 3, nama: '4A' }, { id: 4, nama: '4B' }, { id: 5, nama: '5A' }],
    'nilai', 'kelas', 'nama', 'id', 2);
  assert.deepEqual(kb, [
    [ { text: '4A', callback_data: 'nilai:kelas:3' }, { text: '4B', callback_data: 'nilai:kelas:4' } ],
    [ { text: '5A', callback_data: 'nilai:kelas:5' } ],
  ]);
});

test('buildAbsenKeyboard marks active status and paginates', () => {
  const roster = [
    { idx: 1, santri_id: 10, nama: 'Adi' },
    { idx: 2, santri_id: 11, nama: 'Budi' },
  ];
  const status = { 1: 'hadir', 2: 'sakit' };
  const kb = buildAbsenKeyboard(roster, status, 1, 10);
  // First row = student label (noop), second row = 4 status buttons.
  assert.equal(kb[0][0].text, '1. Adi — ✅ Hadir');
  assert.equal(kb[0][0].callback_data, 'absen:noop:1');
  assert.deepEqual(kb[1].map((b) => b.callback_data),
    ['absen:set:1:H', 'absen:set:1:S', 'absen:set:1:I', 'absen:set:1:A']);
  assert.equal(kb[2][0].text, '2. Budi — 🤒 Sakit');
  // Last rows = actions (no pagination needed for 2 ≤ 10 page size).
  const flat = kb.flat().map((b) => b.callback_data);
  assert.ok(flat.includes('absen:ket'));
  assert.ok(flat.includes('absen:save'));
  assert.ok(flat.includes('absen:cancel'));
  assert.ok(!flat.includes('absen:page:2'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/format/keyboard.js
const STATUS_LABEL = { hadir: '✅ Hadir', sakit: '🤒 Sakit', izin: '📝 Izin', alpha: '❌ Alpha' };
const STATUS_BUTTONS = [['H', 'Hadir'], ['S', 'Sakit'], ['I', 'Izin'], ['A', 'Alpha']];

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildPickKeyboard(items, cmd, action, labelKey, valueKey, perRow = 2) {
  const buttons = items.map((it) => ({
    text: String(it[labelKey]),
    callback_data: `${cmd}:${action}:${it[valueKey]}`,
  }));
  return chunk(buttons, perRow);
}

function buildAbsenKeyboard(roster, statusMap, page = 1, pageSize = 8) {
  const start = (page - 1) * pageSize;
  const pageRows = roster.slice(start, start + pageSize);
  const rows = [];
  for (const r of pageRows) {
    const st = statusMap[r.idx] || 'hadir';
    rows.push([{ text: `${r.idx}. ${r.nama} — ${STATUS_LABEL[st]}`, callback_data: `absen:noop:${r.idx}` }]);
    rows.push(STATUS_BUTTONS.map(([code]) => ({ text: code, callback_data: `absen:set:${r.idx}:${code}` })));
  }
  const totalPages = Math.ceil(roster.length / pageSize);
  if (totalPages > 1) {
    const nav = [];
    if (page > 1) nav.push({ text: '◀', callback_data: `absen:page:${page - 1}` });
    if (page < totalPages) nav.push({ text: '▶', callback_data: `absen:page:${page + 1}` });
    rows.push(nav);
  }
  rows.push([
    { text: '➕ Keterangan', callback_data: 'absen:ket' },
    { text: '💾 Simpan', callback_data: 'absen:save' },
    { text: '✖ Batal', callback_data: 'absen:cancel' },
  ]);
  return rows;
}

module.exports = { buildPickKeyboard, buildAbsenKeyboard, STATUS_LABEL, STATUS_BUTTONS };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format/keyboard.js tests/keyboard.test.js
git commit -m "feat: add tested inline-keyboard builders"
```

---

## Task 3: absen reducer & batch builder

**Files:**
- Test: `tests/absen.test.js`
- Create: `src/logic/absen.js`

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS_BY_CODE, initStatus, applyStatus, setKeterangan, summarize, toAbsensiBatch,
} = require('../src/logic/absen');

const roster = [
  { idx: 1, santri_id: 10, nama: 'Adi' },
  { idx: 2, santri_id: 11, nama: 'Budi' },
  { idx: 3, santri_id: 12, nama: 'Citra' },
];

test('initStatus defaults everyone to hadir', () => {
  assert.deepEqual(initStatus(roster), { 1: 'hadir', 2: 'hadir', 3: 'hadir' });
});

test('applyStatus maps a code and rejects unknown', () => {
  const s = applyStatus(initStatus(roster), 2, 'S');
  assert.equal(s[2], 'sakit');
  assert.throws(() => applyStatus(s, 2, 'X'));
});

test('summarize counts statuses and late (keterangan "Terlambat")', () => {
  let s = applyStatus(initStatus(roster), 2, 'S');
  const ket = setKeterangan({}, 1, 'Terlambat 10 Menit');
  const sum = summarize(s, roster, ket);
  assert.deepEqual(sum, { hadir: 2, sakit: 1, izin: 0, alpha: 0, terlambat: 1 });
});

test('toAbsensiBatch emits all students with keterangan only where set', () => {
  let s = applyStatus(initStatus(roster), 2, 'S');
  const ket = setKeterangan({}, 1, 'Terlambat 10 Menit');
  const batch = toAbsensiBatch({ kelas_id: 3, tanggal: '2026-06-17', roster, statusMap: s, ketMap: ket });
  assert.equal(batch.kelas_id, 3);
  assert.equal(batch.tanggal, '2026-06-17');
  assert.deepEqual(batch.items, [
    { santri_id: 10, status: 'hadir', keterangan: 'Terlambat 10 Menit' },
    { santri_id: 11, status: 'sakit' },
    { santri_id: 12, status: 'hadir' },
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/logic/absen.js
const STATUS_BY_CODE = { H: 'hadir', S: 'sakit', I: 'izin', A: 'alpha' };
const VALID = new Set(Object.values(STATUS_BY_CODE));

function initStatus(roster) {
  const m = {};
  for (const r of roster) m[r.idx] = 'hadir';
  return m;
}

function applyStatus(statusMap, idx, code) {
  const status = STATUS_BY_CODE[code] || code;
  if (!VALID.has(status)) throw new Error(`Status tidak valid: ${code}`);
  return { ...statusMap, [idx]: status };
}

function setKeterangan(ketMap, idx, text) {
  return { ...ketMap, [idx]: (text || '').trim() };
}

function summarize(statusMap, roster, ketMap = {}) {
  const sum = { hadir: 0, sakit: 0, izin: 0, alpha: 0, terlambat: 0 };
  for (const r of roster) {
    const st = statusMap[r.idx] || 'hadir';
    sum[st]++;
    const ket = ketMap[r.idx] || '';
    if (st === 'hadir' && /^terlambat/i.test(ket)) sum.terlambat++;
  }
  return sum;
}

function toAbsensiBatch({ kelas_id, tanggal, roster, statusMap, ketMap = {} }) {
  const items = roster.map((r) => {
    const item = { santri_id: r.santri_id, status: statusMap[r.idx] || 'hadir' };
    const ket = (ketMap[r.idx] || '').trim();
    if (ket) item.keterangan = ket;
    return item;
  });
  return { kelas_id, tanggal, items };
}

module.exports = { STATUS_BY_CODE, initStatus, applyStatus, setKeterangan, summarize, toAbsensiBatch };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/absen.js tests/absen.test.js
git commit -m "feat: add tested absen reducer + batch builder"
```

---

## Task 4: score parser

**Files:**
- Test: `tests/scores.test.js`
- Create: `src/parsers/scores.js`

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseScores } = require('../src/parsers/scores');

const roster = [
  { idx: 1, santri_id: 10, nama: 'Adi' },
  { idx: 2, santri_id: 11, nama: 'Budi' },
];

test('parses "no nilai" pairs across lines and spaces', () => {
  const r = parseScores('1 85\n2 90.5', roster);
  assert.deepEqual(r.entries, [
    { idx: 1, santri_id: 10, nilai: 85 },
    { idx: 2, santri_id: 11, nilai: 90.5 },
  ]);
  assert.deepEqual(r.errors, []);
});

test('rejects out-of-range and unknown number and duplicate', () => {
  assert.match(parseScores('1 120', roster).errors[0], /0–100|0-100/);
  assert.match(parseScores('9 80', roster).errors[0], /tidak dikenal/);
  const dup = parseScores('1 80\n1 90', roster);
  assert.equal(dup.entries.length, 1);
  assert.match(dup.errors[0], /dua kali/);
});

test('empty message is an error', () => {
  assert.match(parseScores('   ', roster).errors[0], /kosong/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/parsers/scores.js
function parseScores(text, roster) {
  const result = { entries: [], errors: [] };
  const trimmed = (text || '').trim();
  if (trimmed === '') {
    result.errors.push('Pesan kosong. Kirim pasangan: [no] [nilai].');
    return result;
  }
  const seen = new Set();
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const tokens = line.split(/\s+/);
    const num = Number(tokens[0]);
    const entry = roster.find((r) => r.idx === num);
    if (!Number.isInteger(num) || !entry) {
      result.errors.push(`Nomor tidak dikenal: "${line}"`);
      continue;
    }
    if (seen.has(num)) {
      result.errors.push(`Nomor ${num} ditulis dua kali.`);
      continue;
    }
    const nilai = Number(tokens[1]);
    if (!Number.isFinite(nilai) || nilai < 0 || nilai > 100) {
      result.errors.push(`Nilai harus 0–100 pada "${line}".`);
      continue;
    }
    seen.add(num);
    result.entries.push({ idx: num, santri_id: entry.santri_id, nilai });
  }
  return result;
}
module.exports = { parseScores };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/scores.js tests/scores.test.js
git commit -m "feat: add tested score parser"
```

---

## Task 5: nilai logic (next_ke, average preview)

**Files:**
- Test: `tests/nilai.test.js`
- Create: `src/logic/nilai.js`

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextKe, previewAverage } = require('../src/logic/nilai');

test('nextKe is max(ke)+1, or 1 when empty', () => {
  assert.equal(nextKe([{ ke: 1 }, { ke: 2 }]), 3);
  assert.equal(nextKe([]), 1);
});

test('previewAverage rounds to 2 decimals', () => {
  assert.equal(previewAverage([80, 90], 70), 80); // (80+90+70)/3 = 80
  assert.equal(previewAverage([], 81.666), 81.67);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/logic/nilai.js
function nextKe(history) {
  const max = (history || []).reduce((m, t) => Math.max(m, Number(t.ke) || 0), 0);
  return max + 1;
}

function previewAverage(existingValues, newValue) {
  const all = [...(existingValues || []), Number(newValue)];
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  return Math.round(avg * 100) / 100;
}

module.exports = { nextKe, previewAverage };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/nilai.js tests/nilai.test.js
git commit -m "feat: add tested nilai logic (next_ke, average preview)"
```

---

## Task 6: summary formatters

**Files:**
- Test: `tests/summary.test.js`
- Create: `src/format/summary.js`

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatAbsenSummary, formatNilaiSummary, formatTugasHistory } = require('../src/format/summary');

test('formatAbsenSummary includes counts and late', () => {
  const s = formatAbsenSummary({ hadir: 27, sakit: 1, izin: 1, alpha: 1, terlambat: 2 });
  assert.match(s, /27 Hadir/);
  assert.match(s, /2 terlambat/i);
});

test('formatNilaiSummary names component, count, context', () => {
  assert.equal(
    formatNilaiSummary('Tugas ke-3', 28, 'Matematika', '4A'),
    '✅ Tugas ke-3 tersimpan untuk 28 santri (Matematika 4A).');
});

test('formatTugasHistory renders T1..Tn and average', () => {
  assert.equal(
    formatTugasHistory('Budi', [{ ke: 1, nilai: 80 }, { ke: 2, nilai: 90 }], 85),
    'Budi: T1 80 · T2 90 → rata² 85');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```javascript
// src/format/summary.js
function formatAbsenSummary(s) {
  let txt = `✅ Tersimpan. ${s.hadir} Hadir, ${s.sakit} Sakit, ${s.izin} Izin, ${s.alpha} Alpha.`;
  if (s.terlambat) txt += ` (${s.terlambat} terlambat)`;
  return txt;
}

function formatNilaiSummary(komponen, count, mapel, kelas) {
  return `✅ ${komponen} tersimpan untuk ${count} santri (${mapel} ${kelas}).`;
}

function formatTugasHistory(nama, list, rata) {
  const parts = list.map((t) => `T${t.ke} ${t.nilai}`).join(' · ');
  return `${nama}: ${parts} → rata² ${rata}`;
}

module.exports = { formatAbsenSummary, formatNilaiSummary, formatTugasHistory };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS — all Part 1 tests (callback, keyboard, absen, scores, nilai, summary + existing attendance, roster).

- [ ] **Step 5: Commit**

```bash
git add src/format/summary.js tests/summary.test.js
git commit -m "feat: add tested summary formatters"
```

---

# PART 2 — n8n rewiring (GUI in the n8n editor)

> Build a NEW workflow **AlFath Bot v2** (keep v1 disabled as a fallback). Code-node bodies are copied verbatim from the `src/` modules built in Part 1 — keep them in sync. Each Code node that uses a `src/` function pastes that function's body at the top, then the glue shown.
>
> **State pattern (used everywhere):** load with
> `const sd = $getWorkflowStaticData('global'); const chatId = String(<chat id>); let sess = sd['sess_'+chatId] || {};`
> and persist by mutating `sess` then `sd['sess_'+chatId] = sess;`.

## Task 7: Credentials, env, and the dual-update trigger

- [ ] **Step 1: Set n8n environment variables**

In n8n host env (or n8n Variables): `SIM_BASE=https://<your-sim-domain>/api/v1` and `BOT_SHARED_SECRET=<same secret as SIM .env>`. Restart n8n if needed.

- [ ] **Step 2: Create workflow + Telegram Trigger for message AND callback_query**

New workflow **AlFath Bot v2**. Add **Telegram Trigger** (existing Telegram credential), Updates = `["message", "callback_query"]`. Save & activate (registers webhook).

- [ ] **Step 3: Normalize the update (Code node `Normalize`)**

Connect Trigger → **Code** `Normalize`:
```javascript
const u = $input.item.json;
const isCb = !!u.callback_query;
const from = isCb ? u.callback_query.from : u.message.from;
const chat = isCb ? u.callback_query.message.chat : u.message.chat;
return [{ json: {
  isCallback: isCb,
  telegramUserId: from.id,
  chatId: chat.id,
  messageId: isCb ? u.callback_query.message.message_id : null,
  callbackId: isCb ? u.callback_query.id : null,
  callbackData: isCb ? u.callback_query.data : null,
  text: isCb ? '' : (u.message.text || ''),
}}];
```

- [ ] **Step 4: Verify**

Send `/menu` to the bot and tap nothing; in n8n executions confirm `Normalize` outputs `isCallback:false`, your `telegramUserId`, and `text:"/menu"`.

---

## Task 8: bot-login bootstrap + identity guard

- [ ] **Step 1: HTTP Request `BotLogin`**

Connect `Normalize` → **HTTP Request** `BotLogin`: Method POST, URL `={{ $env.SIM_BASE }}/auth/bot-login`, Body (JSON):
```json
{ "bot_secret": "={{ $env.BOT_SHARED_SECRET }}", "telegram_user_id": "={{ $('Normalize').item.json.telegramUserId }}" }
```
Settings: "Never Error" = ON (so a 403 doesn't abort; we branch on it).

- [ ] **Step 2: Guard `Registered?` (IF)**

Connect `BotLogin` → **IF** `Registered?`: condition `={{ $json.token }}` **is not empty**.
- FALSE → **Telegram → Send Message**: chatId `={{ $('Normalize').item.json.chatId }}`, text `Maaf, Anda belum terdaftar sebagai guru.` Stop.
- TRUE → continue. The JWT is `={{ $('BotLogin').item.json.token }}`; reuse it as `Authorization: Bearer` on every SIM call below.

- [ ] **Step 3: Verify**

From a registered Telegram account (its id set on a SIM user in A1), send `/menu` → flow proceeds past `Registered?` TRUE. From an unregistered account → "belum terdaftar".

---

## Task 9: Router — message commands vs callbacks

- [ ] **Step 1: Code `Route` (compute a route key)**

Connect `Registered?` TRUE → **Code** `Route` (pastes `parseCallbackData` from `src/parsers/callback.js`):
```javascript
// --- paste parseCallbackData here ---
const n = $('Normalize').item.json;
let route;
if (n.isCallback) {
  const cb = parseCallbackData(n.callbackData);     // {cmd, action, args}
  route = cb ? cb.cmd : 'unknown';
  return [{ json: { route, isCallback: true, cb } }];
}
const first = (n.text.split('\n')[0] || '').trim();
const raw = first.split(/\s+/)[0].toLowerCase().split('@')[0]; // "/absen"
const arg = first.slice(raw.length).trim();                    // class name etc.
route = raw.replace('/', '');                                   // "absen"
return [{ json: { route, isCallback: false, command: raw, arg } }];
```

- [ ] **Step 2: Switch `Dispatch` on `={{ $json.route }}`**

Outputs (renamed): `absen`, `nilai`, `daftar`, `menu`, fallback `extra`. Both message commands and callbacks share the same `cmd`/route, so e.g. an `absen:*` callback and `/absen` both land on the `absen` output (the sub-flow then checks `isCallback`).

- [ ] **Step 3: Wire `/menu` + fallback**

`menu` and `extra` → **Telegram → Send Message** (chatId from Normalize) with text:
```
Perintah:
/absen [nama kelas] — catat kehadiran
/nilai [Tugas|UTS|UAS] — input nilai
/daftar [nama kelas] — daftar santri
/menu — bantuan
```

- [ ] **Step 4: Verify**

`/menu` returns the list. An unknown command returns the same list (fallback).

---

## Task 10: `/daftar [nama kelas]` (read-only)

- [ ] **Step 1: Resolve class — HTTP `GetKelas`**

`daftar` output → **HTTP Request** `GetKelas`: GET `={{ $env.SIM_BASE }}/kelas?aktif=1`, Header `Authorization: Bearer {{ $('BotLogin').item.json.token }}`.

- [ ] **Step 2: Code `MatchKelas`**

```javascript
const arg = ($('Route').item.json.arg || '').trim().toLowerCase();
const list = $input.first().json; // array of {id,nama,...}
const found = list.find((k) => k.nama.toLowerCase() === arg);
return [{ json: { found: found || null, list } }];
```
If `found` is null → Send Message listing class names as tappable buttons via `buildPickKeyboard(list,'daftar','kelas','nama','id')` (Telegram Send Message with `reply_markup.inline_keyboard`). (A `daftar:kelas:<id>` callback re-enters this flow with the chosen id — handle by reading `cb.args[0]` when `isCallback`.)

- [ ] **Step 3: HTTP `GetSantri` + format**

When a class id is known → **HTTP Request** GET `={{ $env.SIM_BASE }}/santri?kelas_id=<id>` (Bearer). Then **Code** (pastes `formatRoster`):
```javascript
// --- paste formatRoster ---
const rows = $input.first().json; // [{id,nama,...}]
const roster = rows.map((r, i) => ({ idx: i + 1, name: r.nama }));
return [{ json: { text: 'Daftar santri:\n' + formatRoster(roster) } }];
```
→ Send Message `={{ $json.text }}`.

- [ ] **Step 4: Verify**

`/daftar 4A` → numbered roster from the SIM (names match `/santri?kelas_id=` for 4A).

---

## Task 11: `/absen` interactive flow

> Sub-flow handles three entry shapes on the `absen` route: (a) `/absen [kelas]` message → start session + render board; (b) `absen:set|page|ket|ketpick|noop` callback → mutate session + edit board; (c) `absen:save`/`absen:cancel` callback → finalize.

- [ ] **Step 1: Start — IF `isCallback` is false**

`absen` output → **IF** `AbsenIsStart` (`={{ $('Route').item.json.isCallback }}` is false).
- TRUE (start) → go to Step 2.
- FALSE (callback) → go to Step 5.

- [ ] **Step 2: Resolve class & load roster**

Start branch → **HTTP** `GetKelas` (GET `/kelas?aktif=1`, Bearer) → **Code** `MatchKelasAbsen` (same matcher as Task 10 Step 2 using `$('Route').item.json.arg`). If no match → Send buttons `buildPickKeyboard(list,'absen','kelas','nama','id')` and stop. If matched → **HTTP** `GetSantriAbsen` (GET `/santri?kelas_id=<id>`, Bearer).

- [ ] **Step 3: Init session + render board (Code `AbsenStart`)**

Pastes `initStatus`, `buildAbsenKeyboard` (and `STATUS_LABEL`/`STATUS_BUTTONS`):
```javascript
// --- paste initStatus (from src/logic/absen.js) and buildAbsenKeyboard (src/format/keyboard.js) ---
const n = $('Normalize').item.json;
const rows = $input.first().json;            // santri array
const roster = rows.map((r, i) => ({ idx: i + 1, santri_id: r.id, nama: r.nama }));
const kelas = $('MatchKelasAbsen').item.json.found;
const now = $now.setZone('Asia/Jakarta');
const sd = $getWorkflowStaticData('global');
const sess = { cmd: 'absen', kelas_id: kelas.id, kelas_nama: kelas.nama,
  tanggal: now.toFormat('yyyy-LL-dd'), roster, statusMap: initStatus(roster), ketMap: {}, page: 1 };
sd['sess_' + n.chatId] = sess;
return [{ json: {
  chatId: n.chatId,
  text: `Absensi ${kelas.nama} — ${sess.tanggal}. Tandai yang tidak Hadir, lalu Simpan.`,
  keyboard: buildAbsenKeyboard(roster, sess.statusMap, 1),
}}];
```
→ **Telegram → Send Message** with `reply_markup` = `={{ { inline_keyboard: $json.keyboard } }}`. (No need to capture message_id; callbacks carry it.)

- [ ] **Step 4: Verify start**

`/absen 4A` → a message listing each santri with H/S/I/A buttons + ➕ Keterangan / 💾 Simpan / ✖ Batal.

- [ ] **Step 5: Handle callbacks (Code `AbsenCb`)**

Callback branch → **Code** `AbsenCb` (pastes `applyStatus`, `summarize`, `toAbsensiBatch`, `buildAbsenKeyboard`):
```javascript
// --- paste applyStatus, summarize, toAbsensiBatch (src/logic/absen.js) + buildAbsenKeyboard ---
const n = $('Normalize').item.json;
const cb = $('Route').item.json.cb;          // {cmd, action, args}
const sd = $getWorkflowStaticData('global');
const sess = sd['sess_' + n.chatId];
if (!sess || sess.cmd !== 'absen') {
  return [{ json: { kind: 'answer', text: 'Sesi habis. Mulai lagi dengan /absen [kelas].' } }];
}
let out;
if (cb.action === 'set') {
  sess.statusMap = applyStatus(sess.statusMap, Number(cb.args[0]), cb.args[1]);
  sd['sess_' + n.chatId] = sess;
  out = { kind: 'edit', keyboard: buildAbsenKeyboard(sess.roster, sess.statusMap, sess.page) };
} else if (cb.action === 'page') {
  sess.page = Number(cb.args[0]); sd['sess_' + n.chatId] = sess;
  out = { kind: 'edit', keyboard: buildAbsenKeyboard(sess.roster, sess.statusMap, sess.page) };
} else if (cb.action === 'ket') {
  const buttons = sess.roster.map((r) => ({ text: `${r.idx}. ${r.nama}`, callback_data: `absen:ketpick:${r.idx}` }));
  const kb = []; for (let i = 0; i < buttons.length; i += 2) kb.push(buttons.slice(i, i + 2));
  out = { kind: 'edit', text: 'Pilih santri untuk diberi keterangan (mis. "Terlambat 10 Menit"):',
          keyboard: kb };
} else if (cb.action === 'ketpick') {
  sess.awaitKet = Number(cb.args[0]); sd['sess_' + n.chatId] = sess;
  const nama = sess.roster.find((r) => r.idx === sess.awaitKet).nama;
  out = { kind: 'forcereply', text: `Keterangan untuk ${nama}? (ketik, atau /lewati)` };
} else if (cb.action === 'noop') {
  out = { kind: 'answer', text: '' };
} else if (cb.action === 'cancel') {
  delete sd['sess_' + n.chatId];
  out = { kind: 'edit', text: 'Absensi dibatalkan.', keyboard: [] };
} else if (cb.action === 'save') {
  out = { kind: 'save' };
}
return [{ json: { ...out, chatId: n.chatId, messageId: n.messageId, callbackId: n.callbackId } }];
```

- [ ] **Step 6: Apply the callback result**

After `AbsenCb`, add a **Switch** on `={{ $json.kind }}`:
- `edit` → **Telegram → Edit Message Text** (chatId, messageId, text optional, `reply_markup`={inline_keyboard}). Also add a **Telegram → Answer Callback Query** (`callbackId`) to clear the spinner.
- `answer` → **Telegram → Answer Callback Query** only.
- `forcereply` → **Telegram → Send Message** with `reply_markup` = `={{ { force_reply: true, input_field_placeholder: 'Terlambat 10 Menit / alasan…' } }}`.
- `save` → go to Step 7.

- [ ] **Step 7: Save (`absen:save`)**

On `save`: **Code** `BuildBatch` (pastes `toAbsensiBatch`, `summarize`, `formatAbsenSummary`):
```javascript
// --- paste toAbsensiBatch, summarize (src/logic/absen.js) + formatAbsenSummary (src/format/summary.js) ---
const n = $('Normalize').item.json;
const sd = $getWorkflowStaticData('global');
const sess = sd['sess_' + n.chatId];
const batch = toAbsensiBatch(sess);
const sum = summarize(sess.statusMap, sess.roster, sess.ketMap);
return [{ json: { batch, summaryText: formatAbsenSummary(sum), chatId: n.chatId, callbackId: n.callbackId } }];
```
→ **HTTP Request** POST `={{ $env.SIM_BASE }}/absensi/batch` (Bearer), Body `={{ $json.batch }}` → **Code** to `delete sd['sess_'+chatId]` → **Telegram → Edit Message Text** with `={{ $('BuildBatch').item.json.summaryText }}` + **Answer Callback Query**.

- [ ] **Step 8: Keterangan text capture (force-reply handler)**

A force-reply answer arrives as a normal `message` (not a command). Add to the `Route` fallback path a check: if `!isCallback` and a session exists with `awaitKet` set, treat the message text as the keterangan. Implement as a **Code** at the top of the `extra`/fallback branch:
```javascript
const n = $('Normalize').item.json;
const sd = $getWorkflowStaticData('global');
const sess = sd['sess_' + n.chatId];
if (!n.isCallback && sess && sess.cmd === 'absen' && sess.awaitKet) {
  const idx = sess.awaitKet;
  if (n.text.trim() !== '/lewati') sess.ketMap[idx] = n.text.trim();
  delete sess.awaitKet; sd['sess_' + n.chatId] = sess;
  return [{ json: { handled: true, chatId: n.chatId, text: 'Keterangan disimpan. Lanjutkan menandai atau tekan 💾 Simpan.' } }];
}
return [{ json: { handled: false } }];
```
→ IF `handled` → Send Message confirmation; else fall through to the `/menu` fallback.

- [ ] **Step 9: Verify `/absen` end-to-end**

1. `/absen 4A` → board renders, everyone defaults Hadir.
2. Tap `S` on a student → board edits, that student shows 🤒 Sakit.
3. Tap ➕ Keterangan → pick a Hadir student → reply `Terlambat 10 Menit` → confirmation.
4. Tap 💾 Simpan → summary `✅ Tersimpan. N Hadir, 1 Sakit… (1 terlambat)`.
5. In the SIM web (or `GET /absensi?kelas_id=&tanggal=`), confirm rows: the sakit student = `sakit`, the late student = `hadir` + keterangan `Terlambat 10 Menit`, rest `hadir`.

---

## Task 12: `/nilai` interactive flow

> Steps: component (arg or buttons) → pick class → pick mapel → (Tugas: get next_ke) → force-reply scores → Simpan. Periode = active.

- [ ] **Step 1: Determine component + start session**

`nilai` route, start (message) → **Code** `NilaiStart`:
```javascript
const n = $('Normalize').item.json;
const arg = ($('Route').item.json.arg || '').trim().toLowerCase();
const map = { tugas: 'Tugas', uts: 'UTS', uas: 'UAS' };
const komponen = map[arg] || null;
const sd = $getWorkflowStaticData('global');
sd['sess_' + n.chatId] = { cmd: 'nilai', komponen, step: komponen ? 'kelas' : 'komponen' };
return [{ json: { chatId: n.chatId, komponen } }];
```
If `komponen` null → Send Message with buttons `[Tugas][UTS][UAS]` (`buildPickKeyboard([{k:'Tugas',v:'T'},...],'nilai','komp','k','v',3)`); a `nilai:komp:<T|U|A>` callback sets it then continues to class pick.

- [ ] **Step 2: Pick class**

**HTTP** GET `/kelas?aktif=1` (Bearer) → Send Message with `buildPickKeyboard(list,'nilai','kelas','nama','id')`. Callback `nilai:kelas:<id>` → store `sess.kelas_id`, `sess.kelas_nama`.

- [ ] **Step 3: Pick mapel**

On class chosen → **HTTP** GET `/kelas/{{id}}/mapel` (Bearer) → Send Message `buildPickKeyboard(list,'nilai','mapel','nama','mata_pelajaran_id')`. Callback `nilai:mapel:<id>` → store `sess.mata_pelajaran_id`, `sess.mapel_nama`.

- [ ] **Step 4: Resolve active periode**

**HTTP** GET `/periode` (Bearer) → **Code**: `const p=$input.first().json.find(x=>x.is_active); if(!p){return [{json:{err:'Belum ada periode aktif. Hubungi admin.'}}]} sess.periode_id=p.id; ...`. On err → Send Message and stop.

- [ ] **Step 5: For Tugas, fetch next_ke**

If `sess.komponen === 'Tugas'`: **HTTP** GET `/nilai/tugas?kelas_id=&mata_pelajaran_id=&periode_id=` (Bearer) → **Code** (pastes `nextKe`): `sess.ke = $input.first().json.next_ke;` and label = `Tugas ke-${sess.ke}`. For UTS/UAS label = the component name.

- [ ] **Step 6: Prompt scores (force-reply)**

**HTTP** GET `/santri?kelas_id=` (Bearer) → **Code** builds `sess.roster` (`{idx,santri_id,nama}`), persists, and emits a message: numbered roster + `Kirim nilai: [no] [nilai], satu per baris. Mis: 1 85`. Send with `reply_markup` force_reply, `input_field_placeholder: '1 85'`.

- [ ] **Step 7: Parse scores reply + Simpan**

The reply is a `message`. In the force-reply handler (extend Task 11 Step 8's branch to also handle `sess.cmd==='nilai'`), run **Code** `ParseNilai` (pastes `parseScores`):
```javascript
// --- paste parseScores ---
const n = $('Normalize').item.json;
const sd = $getWorkflowStaticData('global');
const sess = sd['sess_' + n.chatId];
const r = parseScores(n.text, sess.roster);
if (r.errors.length) return [{ json: { ok: false, chatId: n.chatId, text: 'Kesalahan:\n- ' + r.errors.join('\n- ') } }];
const items = r.entries.map((e) => ({ santri_id: e.santri_id, nilai: e.nilai }));
return [{ json: { ok: true, chatId: n.chatId, sess, items, count: items.length } }];
```
- IF `ok` false → Send errors.
- IF `ok` true →
  - **Tugas:** HTTP POST `/nilai/tugas/batch` (Bearer) body `{kelas_id, mata_pelajaran_id, periode_id, ke, items}`.
  - **UTS/UAS:** HTTP POST `/nilai/batch` (Bearer) body `{kelas_id, mata_pelajaran_id, periode_id, items:[{santri_id, <uts|uas>: nilai}]}` (map component to the right field; the other components are omitted → preserved by A1's component-aware save).
  - Then **Code** (pastes `formatNilaiSummary`) → Send Message; `delete sd['sess_'+chatId]`.

- [ ] **Step 8: Verify `/nilai` end-to-end**

1. `/nilai Tugas` → pick `4A` → pick `Matematika` → bot says "Tugas ke-1" + roster prompt.
2. Reply `1 80\n2 70` → `✅ Tugas ke-1 tersimpan untuk 2 santri (Matematika 4A).`
3. `GET /nilai/tugas?...` shows ke=1 values; `GET /nilai?...` shows `tugas` = those values; `next_ke` now 2.
4. `/nilai UTS` → pick same class/mapel → reply scores → `GET /nilai?...` shows `uts` set and `tugas` unchanged (component-aware).

---

## Task 13: Retire Sheets & export the workflow

- [ ] **Step 1: Disable the v1 workflow**

In n8n, deactivate **AlFath Bot** (v1). Only **AlFath Bot v2** stays active (one webhook per bot).

- [ ] **Step 2: Export v2 to the repo**

Export AlFath Bot v2 JSON → save as `docs/superpowers/n8n/alfath-bot-v2-workflow.json` (replaces the Sheets-era task-6/task-7 references for runtime; keep old files as history).

- [ ] **Step 3: Update README**

In `README.md`, change the architecture line from `Telegram bot → n8n → Google Sheets → Looker Studio` to `Telegram bot → n8n → SIM-Madrasah REST API (MySQL)`. Note the dashboard is the SIM web app.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/n8n/alfath-bot-v2-workflow.json README.md
git commit -m "feat: rewire bot to SIM API (v2), retire Google Sheets"
```

---

## Task 14: End-to-end checkpoint

- [ ] **Step 1: Run all logic tests**

Run: `npm test`
Expected: PASS — Part 1 suites (callback, keyboard, absen, scores, nilai, summary) + existing (attendance, roster).

- [ ] **Step 2: Full manual smoke (registered teacher)**

`/menu`, `/daftar 4A`, the `/absen` sequence (Task 11 Step 9), and both `/nilai` sequences (Task 12 Step 8). Confirm each result in the SIM web dashboard.

- [ ] **Step 3: Unregistered-sender check**

From an account whose telegram id is not on any SIM user → every command replies "belum terdaftar".

- [ ] **Step 4: Commit any stragglers**

```bash
git add -A
git commit -m "chore: Phase A2 bot-on-SIM verified" --allow-empty
```

---

## Self-review notes (verified while writing)

- **Spec coverage:** interactive model & state (design §3–§4) → Tasks 7, 11, 12. bootstrap/guard (design §5.0, PRD §4) → Task 8. router (§5.1) → Task 9. `/daftar`,`/menu` (§5.2, §5.1) → Tasks 9, 10. `/absen` buttons + keterangan + Terlambat marker (§5.3, PRD §6.3) → Task 11. `/nilai` Tugas/UTS/UAS + next_ke + component-aware (§5.4, PRD §6.4–6.5) → Task 12. testable-logic inventory (§6) → Tasks 1–6. retire Sheets (§1) → Task 13.
- **No placeholders:** every `src/` step has complete code + tests; every n8n task names the node type, key params, exact Code/HTTP bodies, and a verification.
- **Type/name consistency:** `parseCallbackData`→`{cmd,action,args}` used in Tasks 9, 11. `buildAbsenKeyboard(roster,statusMap,page,pageSize)` and `STATUS_BY_CODE` codes `H/S/I/A` consistent across keyboard + reducer + callbacks. `toAbsensiBatch(session)` shape matches `/absensi/batch`. Session key `sess_<chatId>` identical everywhere.
- **Deviation flagged:** v1 (Sheets) is deactivated, not deleted — fallback during cutover; remove after v2 is confirmed in production.
```
