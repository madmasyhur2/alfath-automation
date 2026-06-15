# Design: School Monitoring System (Telegram Bot → Sheets → Dashboard)

- **Date:** 2026-06-15
- **Institution:** Al-Fath (small, single-campus evening program)
- **Status:** Approved design — pending spec review before planning

## 1. Problem & Context

The principal wants to monitor the education process — grades, attendance, reasons
for absence, and notes about students — from a single dashboard. A data-entry website
would burden homeroom teachers, who asked to input via a messaging app instead.

The solution: teachers input through a **Telegram bot** (low friction), data lands in
**Google Sheets** (system of record), and a **dashboard** shows live statistics to the
principal and all teaching staff. The institution also wants the bot to **remind
homeroom teachers** of recurring duties and hand them ready-to-send parent messages.

## 2. Goals & Non-Goals

**Goals (v1):**
- Capture attendance, grades, student notes, and task announcements via Telegram.
- Store everything in Google Sheets as the durable source of truth.
- Show live statistics per school, per class, and per student on a dashboard.
- Send scheduled and event-driven reminders to homeroom teachers, each with a
  ready-to-forward draft message for parents.

**Non-Goals (explicitly out of scope for v1 — YAGNI):**
- **Student engagement metric** — too fuzzy to measure reliably; dropped.
- **Finance/payment data entry** — the finance department owns its own sheet; we only
  read it. No payment-recording flow is built here.
- **Direct messaging to parents** — the system drafts content; teachers forward it via
  their existing parent WhatsApp groups. No parent contacts stored, no WhatsApp API.
- **Per-lesson attendance** — attendance is daily, taken by the homeroom teacher only.
- **Weighted final-grade calculation** — dashboard shows averages per assessment type.
- **Per-user access control on the dashboard** — all staff see everything.

## 3. Users & Roles

| Role | Inputs | Views |
|---|---|---|
| **Homeroom teacher** (wali kelas) | Daily attendance, student notes; receives reminders | Full dashboard |
| **Subject teacher** | Grades for their lessons, task announcements (`/tugas`) | Full dashboard |
| **Principal** | — | Full dashboard (primary monitor) |

Identity is established by `telegram_user_id` (see §6). A person may be both a homeroom
and a subject teacher. The dashboard is **fully open to all teaching staff**, including
payment status (the institution's explicit choice; reversible by removing the panel).

## 4. Architecture

```
One Telegram bot  ──▶  n8n (self-hosted)  ──▶  Google Sheets  ──▶  Google Looker Studio
   (/ commands)        - routes commands       (system of         (live dashboard,
                       - runs reminder crons     record)            auto-refresh)
                       - reads Payments sheet
```

- **Telegram bot:** single bot, `/` commands. The only data-entry surface for teachers.
- **n8n (already self-hosted by the maintainer):** receives Telegram updates, validates
  the sender, writes rows to Sheets, and runs the scheduled/event reminder workflows.
- **Google Sheets:** the system of record. Everything downstream is rebuildable from it.
  The bot only **appends** to transactional sheets; humans only hand-edit master sheets.
- **Google Looker Studio:** read-only dashboard, auto-refreshes from Sheets (~15 min).

The maintainer is a solo, low-code operator; this stack costs Rp 0/month beyond the
existing n8n host and has minimal moving parts.

## 5. Data Model (Google Sheets)

### Master data (maintained by hand, once per term)

| Sheet | Columns |
|---|---|
| **Students** | `student_id`, `name`, `class_id` |
| **Classes** | `class_id`, `class_name`, `homeroom_teacher_id` |
| **Teachers** | `teacher_id`, `name`, `telegram_user_id`, `role` (homeroom / subject / principal) |
| **Lessons** | `lesson_id`, `subject`, `class_id`, `teacher_id` |
| **Settings** | key/value config (see §10) |
| **Templates** | `template_key`, `text` — editable wording for reminders |

A **Lesson** = one subject taught to one class by one teacher. This single table
expresses every relationship (class↔lessons, teacher↔lessons/classes, student↔lessons
via class).

### Transactional data (bot appends; never hand-edited)

| Sheet | Columns |
|---|---|
| **Attendance** | `timestamp`, `date`, `student_id`, `class_id`, `status` (H/T/S/I/A), `reason`, `recorded_by` |
| **Grades** | `timestamp`, `date`, `student_id`, `lesson_id`, `assessment_type` (Tugas/UH/UTS/UAS), `assessment_name`, `score`, `recorded_by` |
| **Notes** | `timestamp`, `date`, `student_id`, `note_text`, `recorded_by` |
| **Tasks** | `task_id`, `date_given`, `lesson_id`, `description`, `due_date`, `recorded_by` |

**Attendance statuses:** `H` Hadir, `T` Terlambat (present but late), `S` Sakit,
`I` Izin, `A` Alpa. A row is written only for students who are *not* plain Hadir;
everyone else is assumed present (exception-only model, see §6).

**Submission marker:** completing `/absen` (including "nihil" = all present) also logs a
per-class, per-day submission record (`date`, `class_id`, `recorded_by`). This is what
distinguishes "all present" from "not submitted yet" — it drives the follow-up nudge and
ensures attendance-% denominators only count days the class actually ran.

### External contract (owned by finance, read-only to us)

| Sheet | Columns |
|---|---|
| **Payments** | `student_id` (join key — must match Students), `month` (`YYYY-MM`), `status` (`Lunas`/`Belum`), `amount` *(opt)*, `paid_date` *(opt)*, default tuition Rp 75,000 |

Finance fills this in their own standardized format. We pre-fill the student list so they
only set status (no ID typos). If a month's data is missing, reminders **degrade
gracefully** to a generic message (see §7).

## 6. Telegram Bot

**One bot, Indonesian-language prompts.** It responds only to senders whose
`telegram_user_id` is in the **Teachers** sheet; unknown senders get a polite rejection.
From the sender's ID the bot already knows their name, homeroom class, and lessons — it
never asks "who are you" or "which class."

**Display principle:** the bot always shows **student names** (joined from `student_id`),
never bare numbers. **Selection principle:** tappable name buttons for single-student
picks; a named+numbered list with `number score` shorthand only for bulk grade entry.

### Commands & flows

**`/absen` — daily attendance (homeroom teachers only).** Exception-only: everyone is
assumed Hadir; the teacher only reports who is not.
```
Teacher: /absen
Bot:     Absensi 7A — Senin, 15 Juni 2026. Siapa yang tidak hadir / terlambat?
         (taps a student name → taps status H/T/S/I/A → types reason or arrival time)
         Ketik "nihil" jika semua hadir.
Bot:     ✅ Tercatat. 27 Hadir, 1 Terlambat, 1 Sakit, 1 Izin.
```

**`/nilai` — grades (subject teacher).** Pick lesson → pick assessment type + name →
paste `number score` pairs against the named roster.
```
Bot:  Matematika 7A — UH Bab 3. Kirim: [no] [skor]
      1. Adi Nugroho   2. Budi Santoso   3. Citra Dewi …
Teacher: 1 85 / 2 90 / 3 78
Bot:  ✅ 3 nilai tercatat.
```

**`/catatan` — student note (any teacher).** Tap student name → type note.

**`/tugas` — announce a task (subject teacher).** Pick lesson → description → due date.
Writes a Tasks row and triggers the task-given reminder (see §7).

**`/daftar [kelas]`** — show a class roster on demand.
**`/menu`** — list the commands available to this teacher based on role.

## 7. Reminder Engine

Each reminder is an n8n workflow. Pattern: **nudge the right teacher + provide a
ready-to-copy draft** they forward to their parent WhatsApp group. Wording comes from the
**Templates** sheet. Reminders fire only on active days (Sat–Wed).

| Reminder | Trigger | Recipient | Draft |
|---|---|---|---|
| **Attendance nudge** | Each active day, ~18:05; follow-up ~19:15 if not yet submitted | Each homeroom teacher | "Jangan lupa absensi [kelas] 🙏" |
| **Weekly recap** | Wednesday, ~19:45 (last active day of week) | Each homeroom teacher | Per-student weekly attendance summary built from the Attendance sheet |
| **Tuition** | 1st of month (slides to next active day if Thu/Fri), ~18:05 | Each homeroom teacher | Names this class's unpaid students from Payments; generic fallback if month data missing |
| **Task given** | Event: a `/tugas` announcement | Homeroom teacher of the task's class | "Ananda diberi tugas [deskripsi] pada [pelajaran], dikumpulkan [due_date] — mohon dampingi" |

Cross-routing note: a **subject teacher** announces a task; the system drafts the parent
message for that class's **homeroom teacher** to forward.

## 8. Dashboard (Looker Studio)

**School-wide (principal's home):**
- Today's attendance: % present + counts of H / T / S / I / A
- Attendance trend over week/month
- Per-class attendance % and grade-average table
- **Watchlist:** ≥3 Alpa this month, below-KKM in multiple lessons, frequent-late
- Recent notes feed
- Payment status panel (% paid per class, unpaid list)

**Per-student drilldown (pick a student):**
- Attendance record + reasons + late count
- Grades across lessons by assessment type, against KKM (60)
- Notes timeline, tasks assigned, payment status

**Per-class view:** roster with each student's attendance %, average grade, and flags.

Refresh is automatic (~15 min cache), well within the daily/weekly monitoring cadence.

## 9. Security & Privacy

- **Authentication** = Telegram `telegram_user_id` whitelist in the Teachers sheet.
- **Authorization** = role field gates commands (only homeroom teachers `/absen`; only
  subject teachers of a lesson can `/nilai`/`/tugas` for it).
- **Sheet access** is held by the maintainer; the bot's n8n credentials write only to
  transactional sheets and read Payments.
- **Privacy posture:** all education data and payment status are visible to all staff per
  the institution's explicit decision. (If reversed later, drop the payment panel and
  scope dashboard sharing.)

## 10. Configuration (Settings sheet)

| Key | Value |
|---|---|
| `kkm` | 60 |
| `tuition_amount` | 75000 |
| `active_days` | Sat, Sun, Mon, Tue, Wed |
| `class_start` / `class_end` | 18:00 / 19:30 |
| `attendance_nudge_time` | 18:05 (follow-up 19:15) |
| `weekly_recap_time` | Wednesday 19:45 |
| `tuition_reminder_day` | 1st of month (next active day if Thu/Fri) |

## 11. Future Phases (not v1)

- **Finance subsystem:** payment-recording flow, amounts, history.
- **Direct parent messaging:** store parent contacts + WhatsApp integration + consent.
- **Task completion tracking:** mark tasks done, surface completion rates.
- **Achievement targets per lesson:** teacher/student goals, tracked on the dashboard.
- **Engagement signal:** revisit if a trustworthy measure emerges.

## 12. Assumptions to Confirm at Review

- Reminder times in §10 are proposed defaults — adjust to your routine.
- Assessment types (Tugas/UH/UTS/UAS) match how grades are categorized.
- Finance will adopt the Payments sheet format and the shared `student_id` keys.
