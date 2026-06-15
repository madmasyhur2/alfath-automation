# Phase 1: Foundation & Attendance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the smallest end-to-end slice — a homeroom teacher logs daily attendance via Telegram, it lands in Google Sheets, and the principal sees it live on a dashboard.

**Architecture:** One Telegram bot → n8n (self-hosted) validates the sender, routes the command, parses the message with tested JS, and appends rows to Google Sheets (the source of truth). Looker Studio reads the Sheets for a live dashboard. Commands are single-message and stateless; teachers reference students by a number shown next to their name.

**Tech Stack:** Telegram Bot API, n8n (visual workflows + JS Code nodes), Google Sheets, Google Looker Studio. Pure parsing/formatting logic is plain JavaScript with `node:test` (zero dependencies, Node 18+).

---

## Phase roadmap (context)

- **Phase 1 (this plan):** foundation + `/absen` + minimal dashboard.
- **Phase 2 (later plan):** `/nilai`, `/catatan`, `/tugas`, dashboard expansion.
- **Phase 3 (later plan):** reminder engine (attendance nudge, weekly recap, tuition, task-given) + active-day scheduling.

## What the agent produces vs. what you do in a GUI

Some artifacts are code the agent writes and tests (parsers, `package.json`). Others are configuration you perform in a browser (BotFather, the n8n editor, Google Sheets, Looker Studio) following exact steps with a verification check. Both kinds appear as tasks below.

## File structure (created in this phase)

```
Al-Fath Automation/
├── docs/superpowers/{specs,plans}/...        # spec + this plan
├── package.json                              # node:test runner, no deps
├── .gitignore
├── README.md                                 # setup + how-to-run-tests
├── src/parsers/attendance.js                 # parse /absen message (pure, tested)
├── src/format/roster.js                      # build "1. Name" list (pure, tested)
└── tests/
    ├── attendance.test.js
    └── roster.test.js
```

n8n workflows live in your n8n instance; their Code-node bodies are copied verbatim from `src/` (single source of truth = `src/`, which is the tested copy).

---

## Task 1: Repository scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "al-fath-monitoring",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
.env
*.local
credentials/
```

- [ ] **Step 3: Create `README.md`**

```markdown
# Al-Fath School Monitoring

Telegram bot → n8n → Google Sheets → Looker Studio. See the design spec in
`docs/superpowers/specs/` and the implementation plans in `docs/superpowers/plans/`.

## Logic tests

Pure parsing/formatting logic lives in `src/` and is tested with Node's built-in
runner (no dependencies). Requires Node 18+.

    npm test

The n8n Code nodes contain copies of these functions; keep them in sync with `src/`.
```

- [ ] **Step 4: Verify the test runner works (no tests yet = success exit)**

Run: `npm test`
Expected: command exits 0 with "tests 0" (no test files found yet is fine).

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore README.md
git commit -m "chore: scaffold repo with node:test runner"
```

---

## Task 2: Attendance message parser (TDD)

Parses a homeroom teacher's `/absen` reply. Everyone not listed is assumed present (Hadir). `nihil` = all present. Exception statuses: `T` Terlambat, `S` Sakit, `I` Izin, `A` Alpa.

**Files:**
- Test: `tests/attendance.test.js`
- Create: `src/parsers/attendance.js`

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAttendanceMessage } = require('../src/parsers/attendance');

const roster = [
  { idx: 1, student_id: 'S-001', name: 'Adi Nugroho' },
  { idx: 2, student_id: 'S-002', name: 'Budi Santoso' },
  { idx: 3, student_id: 'S-003', name: 'Citra Dewi' },
];

test('nihil means everyone present', () => {
  const r = parseAttendanceMessage('nihil', roster);
  assert.equal(r.allPresent, true);
  assert.deepEqual(r.exceptions, []);
  assert.deepEqual(r.errors, []);
});

test('parses one student with status and reason', () => {
  const r = parseAttendanceMessage('2 S demam', roster);
  assert.equal(r.allPresent, false);
  assert.deepEqual(r.exceptions, [
    { student_id: 'S-002', name: 'Budi Santoso', status: 'S', reason: 'demam' },
  ]);
  assert.deepEqual(r.errors, []);
});

test('parses multiple lines incl. late with arrival time', () => {
  const r = parseAttendanceMessage('1 T 18:10\n3 A', roster);
  assert.deepEqual(r.exceptions, [
    { student_id: 'S-001', name: 'Adi Nugroho', status: 'T', reason: '18:10' },
    { student_id: 'S-003', name: 'Citra Dewi', status: 'A', reason: '' },
  ]);
  assert.deepEqual(r.errors, []);
});

test('flags unknown roster number', () => {
  const r = parseAttendanceMessage('9 S sakit', roster);
  assert.equal(r.exceptions.length, 0);
  assert.match(r.errors[0], /Nomor tidak dikenal/);
});

test('flags invalid status', () => {
  const r = parseAttendanceMessage('1 X', roster);
  assert.equal(r.exceptions.length, 0);
  assert.match(r.errors[0], /Status tidak valid/);
});

test('flags duplicate number but keeps the first', () => {
  const r = parseAttendanceMessage('1 S\n1 A', roster);
  assert.equal(r.exceptions.length, 1);
  assert.match(r.errors[0], /dua kali/);
});

test('empty message is an error', () => {
  const r = parseAttendanceMessage('   ', roster);
  assert.equal(r.allPresent, false);
  assert.match(r.errors[0], /kosong/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/parsers/attendance'`.

- [ ] **Step 3: Implement the parser**

```javascript
// src/parsers/attendance.js
// Pure parser for a homeroom teacher's /absen reply.
const EXCEPTION_STATUSES = ['T', 'S', 'I', 'A']; // Terlambat, Sakit, Izin, Alpa
const ALL_PRESENT_WORDS = ['nihil', 'semua hadir', 'hadir semua'];

function parseAttendanceMessage(text, roster) {
  const result = { allPresent: false, exceptions: [], errors: [] };
  const trimmed = (text || '').trim();

  if (trimmed === '') {
    result.errors.push('Pesan kosong. Ketik "nihil" jika semua hadir.');
    return result;
  }
  if (ALL_PRESENT_WORDS.includes(trimmed.toLowerCase())) {
    result.allPresent = true;
    return result;
  }

  const seen = new Set();
  const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l !== '');

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
    const status = (tokens[1] || '').toUpperCase();
    if (!EXCEPTION_STATUSES.includes(status)) {
      result.errors.push(`Status tidak valid pada "${line}" (pakai T/S/I/A).`);
      continue;
    }
    seen.add(num);
    result.exceptions.push({
      student_id: entry.student_id,
      name: entry.name,
      status,
      reason: tokens.slice(2).join(' '),
    });
  }
  return result;
}

module.exports = { parseAttendanceMessage, EXCEPTION_STATUSES, ALL_PRESENT_WORDS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/attendance.js tests/attendance.test.js
git commit -m "feat: add tested attendance message parser"
```

---

## Task 3: Roster formatter (TDD)

Builds the numbered, named roster the teacher reads before typing exceptions.

**Files:**
- Test: `tests/roster.test.js`
- Create: `src/format/roster.js`

- [ ] **Step 1: Write the failing test**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatRoster } = require('../src/format/roster');

test('numbers each student name on its own line', () => {
  const roster = [
    { idx: 1, student_id: 'S-001', name: 'Adi Nugroho' },
    { idx: 2, student_id: 'S-002', name: 'Budi Santoso' },
  ];
  assert.equal(formatRoster(roster), '1. Adi Nugroho\n2. Budi Santoso');
});

test('empty roster yields empty string', () => {
  assert.equal(formatRoster([]), '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/format/roster'`.

- [ ] **Step 3: Implement the formatter**

```javascript
// src/format/roster.js
function formatRoster(roster) {
  return roster.map((r) => `${r.idx}. ${r.name}`).join('\n');
}
module.exports = { formatRoster };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests (9 total) pass.

- [ ] **Step 5: Commit**

```bash
git add src/format/roster.js tests/roster.test.js
git commit -m "feat: add tested roster formatter"
```

---

## Task 4: Create the Google Sheets workbook

Create one Google Sheets file named **AlFath-Monitoring**. Add the tabs below with the exact header row in row 1. Seed a little sample data so later tasks are testable.

**This is GUI work in Google Sheets.**

- [ ] **Step 1: Create the workbook and these tabs with these exact headers (row 1)**

| Tab | Header row (A1 →) |
|---|---|
| `Students` | `student_id`, `name`, `class_id` |
| `Classes` | `class_id`, `class_name`, `homeroom_teacher_id` |
| `Teachers` | `teacher_id`, `name`, `telegram_user_id`, `role` |
| `Lessons` | `lesson_id`, `subject`, `class_id`, `teacher_id` |
| `Settings` | `key`, `value` |
| `Templates` | `template_key`, `text` |
| `Attendance` | `timestamp`, `date`, `student_id`, `class_id`, `status`, `reason`, `recorded_by` |
| `AttendanceLog` | `timestamp`, `date`, `class_id`, `recorded_by` |
| `Payments` | `student_id`, `month`, `status`, `amount`, `paid_date` |

- [ ] **Step 2: Seed sample data for testing**

`Settings`:
```
kkm                 60
tuition_amount      75000
active_days         Sat,Sun,Mon,Tue,Wed
class_start         18:00
class_end           19:30
timezone            Asia/Jakarta
```
`Teachers` (use YOUR real Telegram numeric user id — get it in Task 6 Step 1; you can fill it after):
```
T-001   Ustadz Ahmad   <your_telegram_user_id>   homeroom
```
`Classes`:
```
C-7A   Kelas 7A   T-001
```
`Students`:
```
S-001   Adi Nugroho     C-7A
S-002   Budi Santoso    C-7A
S-003   Citra Dewi      C-7A
```

- [ ] **Step 3: Verify**

Check that all 9 tabs exist, headers are in row 1 exactly as written, and the sample rows are present. The homeroom teacher of `C-7A` is `T-001`.

- [ ] **Step 4: Commit (record the schema, no secrets)**

The workbook lives in Google Drive, not git. No commit needed for this task; note the workbook URL in your own records.

---

## Task 5: Create the Telegram bot

**GUI work in Telegram with @BotFather.**

- [ ] **Step 1: Create the bot**

In Telegram, message `@BotFather` → `/newbot` → give it a name and username. Copy the **HTTP API token** it returns.

- [ ] **Step 2: Set the command list (optional, nice UX)**

Send `@BotFather` `/setcommands`, choose your bot, paste:
```
absen - Catat kehadiran kelas (wali kelas)
daftar - Tampilkan daftar siswa kelas
menu - Bantuan perintah
```

- [ ] **Step 3: Verify**

Open a chat with your new bot and send `/start`. (No reply yet — that's expected until n8n is wired.) Confirm you hold the API token.

---

## Task 6: n8n — Telegram trigger, identity check, command router

Build one workflow named **AlFath Bot**. Connect Telegram and Google Sheets credentials in n8n first.

**GUI work in the n8n editor.**

- [ ] **Step 1: Find your Telegram numeric user id**

Message `@userinfobot` on Telegram; it replies with your numeric id. Put it into the `Teachers` sheet (Task 4 Step 2). This id is how the bot recognizes you.

- [ ] **Step 2: Add credentials**

In n8n → Credentials: add **Telegram API** (paste the BotFather token) and **Google Sheets OAuth2** (authorize the Google account that owns AlFath-Monitoring).

- [ ] **Step 3: Add the Telegram Trigger node**

Node: **Telegram Trigger**, Updates = `message`. Save and activate so n8n registers the webhook.

- [ ] **Step 4: Add identity lookup**

Node: **Google Sheets → Lookup** on tab `Teachers`, match column `telegram_user_id` = `={{ $json.message.from.id }}`. Connect Trigger → this node.

- [ ] **Step 5: Add "not registered" guard**

Node: **IF** — condition: the lookup returned no `teacher_id` (`={{ $json.teacher_id }}` is empty).
- TRUE branch → **Telegram → Send Message**: chat id `={{ $('Telegram Trigger').item.json.message.chat.id }}`, text `Maaf, Anda belum terdaftar sebagai guru.` Then stop.
- FALSE branch → continue.

- [ ] **Step 6: Add the command router**

Node: **Code** named `ParseCommand` on the FALSE branch:
```javascript
const msg = $('Telegram Trigger').item.json.message.text || '';
const firstLine = msg.split('\n')[0].trim();
const command = firstLine.split(/\s+/)[0].toLowerCase(); // e.g. "/absen"
// body = everything after the first line (the exception lines), or after the command on line 1
const afterCmd = firstLine.slice(command.length).trim();
const restLines = msg.split('\n').slice(1).join('\n').trim();
const body = [afterCmd, restLines].filter(Boolean).join('\n');
return [{ json: { command, body } }];
```
Then a **Switch** node on `={{ $json.command }}` with outputs: `/absen`, `/daftar`, `/menu`, and a fallback.

- [ ] **Step 7: Wire `/menu` and fallback**

`/menu` and fallback → **Telegram → Send Message** with text:
```
Perintah:
/absen — catat kehadiran (wali kelas)
/daftar — daftar siswa kelas Anda
/menu — bantuan
```

- [ ] **Step 8: Verify**

Send `/menu` to the bot → you get the command list. Send `/menu` from an account NOT in `Teachers` → you get "belum terdaftar". 

---

## Task 7: n8n — `/daftar` and `/absen` flows

Both need the teacher's class and its student roster. Build a reusable sub-sequence, then branch behavior.

**GUI work in the n8n editor; the Code node body is copied from `src/`.**

- [ ] **Step 1: Resolve the teacher's class (shared by both branches)**

After the Switch, on both `/absen` and `/daftar` outputs, add **Google Sheets → Lookup** on `Classes`, match `homeroom_teacher_id` = `={{ $('Google Sheets').item.json.teacher_id }}`.
Add an **IF**: if no `class_id` → Send Message `Anda bukan wali kelas, perintah ini hanya untuk wali kelas.` and stop.

- [ ] **Step 2: Read the roster**

Node: **Google Sheets → Read** `Students`, filter `class_id` = the resolved class. Then a **Code** node `BuildRoster`:
```javascript
const rows = $input.all().map((i) => i.json);
const roster = rows.map((r, idx) => ({ idx: idx + 1, student_id: r.student_id, name: r.name }));
return [{ json: { roster } }];
```

- [ ] **Step 3: `/daftar` reply**

On the `/daftar` branch, add a **Code** node `FormatRoster` (body copied from `src/format/roster.js`):
```javascript
function formatRoster(roster) {
  return roster.map((r) => `${r.idx}. ${r.name}`).join('\n');
}
const roster = $('BuildRoster').item.json.roster;
return [{ json: { text: `Daftar siswa:\n${formatRoster(roster)}` } }];
```
→ Send Message with `={{ $json.text }}`.

- [ ] **Step 4: `/absen` — empty body shows the roster + instructions**

On the `/absen` branch, after BuildRoster add **IF**: body empty (`={{ $('ParseCommand').item.json.body }}` is empty).
- TRUE → Send Message:
```
Absensi kelas Anda. Balas dengan: /absen lalu baris [no] [T/S/I/A] [alasan]
Contoh:
/absen
2 S demam
1 T 18:10
Ketik "/absen nihil" jika semua hadir.

{{ formatted roster here }}
```
Build that text in a Code node reusing `formatRoster`. Then stop.
- FALSE → continue to Step 5.

- [ ] **Step 5: `/absen` — parse the body**

**Code** node `ParseAbsen` (body copied from `src/parsers/attendance.js`, then add the glue below at the end):
```javascript
// ... paste EXCEPTION_STATUSES, ALL_PRESENT_WORDS, parseAttendanceMessage here ...

const roster = $('BuildRoster').item.json.roster;
const body = $('ParseCommand').item.json.body;
const parsed = parseAttendanceMessage(body, roster);

const classId = $('Classes').item.json.class_id;
const teacherId = $('Google Sheets').item.json.teacher_id;
const now = $now.setZone('Asia/Jakarta');
const ts = now.toISO();
const date = now.toFormat('yyyy-LL-dd');

if (parsed.errors.length) {
  return [{ json: { ok: false, text: 'Ada kesalahan:\n- ' + parsed.errors.join('\n- ') } }];
}

const rows = parsed.exceptions.map((e) => ({
  timestamp: ts, date, student_id: e.student_id, class_id: classId,
  status: e.status, reason: e.reason, recorded_by: teacherId,
}));

const counts = { T: 0, S: 0, I: 0, A: 0 };
parsed.exceptions.forEach((e) => { counts[e.status]++; });
const hadir = roster.length - (counts.S + counts.I + counts.A); // late still counts present
const summary = `✅ Tercatat. ${hadir} Hadir, ${counts.T} Terlambat, ${counts.S} Sakit, ${counts.I} Izin, ${counts.A} Alpa.`;

return [{ json: { ok: true, rows, log: { timestamp: ts, date, class_id: classId, recorded_by: teacherId }, text: summary } }];
```

- [ ] **Step 6: Branch on parse result, write rows, confirm**

Add **IF** on `={{ $json.ok }}`.
- FALSE → Send Message `={{ $json.text }}` (the errors). Stop.
- TRUE →
  - **Google Sheets → Append** to `Attendance`, mapping each item in `rows` (use a "Split Out"/items expansion so each exception becomes a row). If `rows` is empty (all present), skip the append.
  - **Google Sheets → Append** to `AttendanceLog` one row from `log` (records that the class submitted today).
  - **Telegram → Send Message** `={{ $('ParseAbsen').item.json.text }}`.

- [ ] **Step 7: Verify end-to-end**

From your registered Telegram account:
1. Send `/daftar` → you see `1. Adi Nugroho / 2. Budi Santoso / 3. Citra Dewi`.
2. Send `/absen nihil` → reply `3 Hadir, 0 Terlambat...`; `AttendanceLog` gets a row; `Attendance` gets none.
3. Send:
   ```
   /absen
   2 S demam
   1 T 18:10
   ```
   → reply `1 Hadir, 1 Terlambat, 1 Sakit...`; `Attendance` gets 2 rows with correct columns; `AttendanceLog` gets a row.
4. Send `/absen 9 S` → reply contains "Nomor tidak dikenal"; no rows written.

---

## Task 8: Looker Studio dashboard (minimal)

Build the first live view from the Sheets.

**GUI work in Google Looker Studio.**

- [ ] **Step 1: Create report and data sources**

New report → add **Google Sheets** connectors for `Attendance`, `AttendanceLog`, `Students`, and `Classes` from AlFath-Monitoring.

- [ ] **Step 2: Today's attendance scorecards**

Add scorecards counting `Attendance` rows where `date` = today, broken down by `status` (T/S/I/A). Add a scorecard for `AttendanceLog` rows today (= classes that submitted).

- [ ] **Step 3: Per-class exceptions table**

Table from `Attendance`: dimensions `date`, `class_id`, `status`, `student_id`, `reason`. Add a date-range control defaulting to "this week". This is the principal's "who was absent and why" view.

- [ ] **Step 4: Per-student attendance summary**

Table from `Attendance`: dimension `student_id` (joined to `Students.name` via a blended/joined source), metrics = count of rows per `status`. Add a `student_id` filter control for drill-down.

- [ ] **Step 5: Verify**

With the data seeded in Task 7, confirm the scorecards show today's S/I/T counts, the exceptions table lists Budi (S, demam) and Adi (T, 18:10), and filtering the per-student table to `S-002` shows one Sakit.

- [ ] **Step 6: Share**

Share the report (view access) with the principal and staff per the "open to all staff" decision. Record the report URL in your own records.

---

## Task 9: End-to-end checkpoint

- [ ] **Step 1: Run the logic tests one more time**

Run: `npm test`
Expected: PASS — all 9 tests.

- [ ] **Step 2: Full manual smoke test**

From a registered account, run the Task 7 Step 7 sequence again on a fresh date and confirm the dashboard (Task 8) reflects it within its refresh window.

- [ ] **Step 3: Commit any final repo changes**

```bash
git add -A
git commit -m "docs: phase 1 complete — foundation and attendance loop"
```

---

## Self-review notes (verified while writing)

- **Spec coverage (Phase 1 portion):** Sheets data model (§5, incl. AttendanceLog submission marker) → Tasks 4, 7. Bot identity/auth (§6, §9) → Task 6. `/absen` exception-only + statuses H/T/S/I/A (§5, §6) → Tasks 2, 7. `/daftar`, `/menu` (§6) → Tasks 6, 7. Dashboard attendance views (§8) → Task 8. Config values (§10) → Task 4 Settings seed. Grades/notes/tasks/reminders are intentionally Phase 2–3.
- **No placeholders:** every code step shows complete code; every GUI step has an explicit verification.
- **Naming consistency:** `parseAttendanceMessage`, `formatRoster`, and the Attendance/AttendanceLog columns match between `src/`, the n8n Code nodes, and the Sheets headers.
- **Deviations from spec UX (flagged for approval):** number-shorthand instead of tap-buttons; single-message stateless commands instead of multi-step conversations. Both reversible in a later phase.
