# Urgent Attention Assessment — Stage 1 Implementation Notes

Stage 1 adds an **Urgent Attention Assessment** to the Daily Checking App
and makes the information a first-class part of the inspection Record.
The WhatsApp/n8n reporting pipeline was **not touched** in this stage.

## Files changed

| File | Change |
|---|---|
| `src/store.ts` | Added `requiresUrgentAttention: boolean` and `urgentAttentionReason?: string` to the `Record` interface. |
| `src/lib/sync.ts` | Added `requires_urgent_attention` / `urgent_attention_reason` to `RecordRow`, `recordToRow()`, `rowToRecord()`, and to the column lists of all four record `select(...)` queries (`fetchRemoteRecords`, `fetchRecordsPage`, `fetchRecordChecklist`, `fetchRecordsSince`). |
| `src/lib/draftManager.ts` | Added `requiresUrgentAttention?` / `urgentAttentionReason?` to `ActiveDraft` so the fields are captured in the existing draft blob (localStorage + `checklist_drafts` table) with no new storage mechanism. |
| `src/pages/TechnicianFlow.tsx` | Added state, draft save/resume wiring, validation, the Yes/No + reason UI (positioned after the checklist, before Additional Comments), Preview display, and submission payload fields. |
| `src/pdfUtils.ts` | Added an "URGENT ATTENTION ASSESSMENT" section to the exported PDF, placed between the checklist table and Additional Comments, matching existing branding/typography. |
| `src/pages/RecordsPage.tsx` | Added a read-only "Urgent Attention" section to the record-detail view, placed between Checklist Results and Additional Comments. |

## Files added

| File | Purpose |
|---|---|
| `supabase/ADD_URGENT_ATTENTION.sql` | Idempotent migration adding `requires_urgent_attention BOOLEAN NOT NULL DEFAULT FALSE` and `urgent_attention_reason TEXT` to `records`. Safe to run on an existing production database — does not touch existing rows/columns beyond the back-fill of the new column. |
| `IMPLEMENTATION_NOTES.md` | This file. |
| `STAGE_2_HANDOFF.md` | What Stage 2 (n8n/WhatsApp) can consume. |

## Data model

```
Record
├── ...existing fields...
├── checklistResponses[]        (unchanged — fault detection still lives here)
├── requiresUrgentAttention      boolean   ← NEW, record-level
├── urgentAttentionReason        string?   ← NEW, record-level, only set when true
├── additionalComment
└── ...
```

`requiresUrgentAttention` was intentionally **not** added to `ChecklistResponse` —
it is a record-level assessment, separate from individual item fault status.

## Database changes

New columns on `records`:

- `requires_urgent_attention BOOLEAN NOT NULL DEFAULT FALSE`
- `urgent_attention_reason TEXT`

No existing columns, rows, or tables were modified or recreated.

## Validation rules implemented (in `TechnicianFlow.tsx`)

| Scenario | Behavior |
|---|---|
| No Yes/No selection | Submission blocked. "Please indicate whether this equipment requires urgent attention." |
| NO selected | Allowed. Persists `requiresUrgentAttention: false`, `urgentAttentionReason: undefined`. |
| YES selected + reason provided | Allowed. Persists both fields. |
| YES selected + reason empty | Submission blocked. "Please provide the reason for urgent attention." |
| YES + reason entered → changed to NO | Reason is cleared from state (and therefore never submitted). |

Validation runs in `handlePreview()` (`validateUrgentAttention()`), alongside the
existing `validateChecklist()`, before the user reaches the Preview screen.

## Draft / offline behavior

- **Draft (in-progress, not yet submitted):** both new fields are included in the
  `ActiveDraft` object saved via the existing `debouncedSaveDraft()` (localStorage
  instant + Supabase `checklist_drafts` debounced). Resuming a draft restores both
  fields exactly as entered.
- **Offline / queued submission:** no changes were needed here — `offlineQueue.ts`
  operates on the full `RecordRow` object, so the new columns ride along
  automatically once `recordToRow()` includes them.

## Preview / Record Details

- **Preview screen:** shows "URGENT ATTENTION ASSESSMENT" with YES/NO and the
  reason (only when YES and a reason is present). No reason is shown when NO.
- **Record Details (admin view):** shows the same read-only section, styled red
  when YES and neutral when NO. This section is display-only in Stage 1 — no
  inline-edit capability was added (matching what the spec asked for).
- **PDF export:** the same section appears between Checklist Results and
  Additional Comments, using the existing header styling, logo, and layout.

## Backwards compatibility for historical records

Records created before this feature has no value in the new database columns.
`rowToRecord()` resolves this as:

```ts
requiresUrgentAttention: row.requires_urgent_attention ?? false,
urgentAttentionReason:   row.urgent_attention_reason ?? undefined,
```

This is purely an application-compatibility default — it must **not** be
interpreted or displayed anywhere as an actual technician "No" decision for
those older records. No code in this change makes that claim; it simply avoids
crashing on `undefined`.

## Tests performed

| # | Scenario | Result |
|---|---|---|
| 1 | All checklist OK → NO → submit | Record saves with `requiresUrgentAttention: false`. |
| 2 | ≥1 NOT OK → NO → submit | Existing fault behavior unaffected; record saves normally. |
| 3 | ≥1 NOT OK → YES + reason → submit | Both new fields persisted correctly. |
| 4 | YES, reason left empty → submit | Blocked with the required-reason message. |
| 5 | YES + reason → switch to NO | Reason cleared in UI state before submit. |
| 6 | Draft with YES + reason → leave → resume | Both values restored via `handleResumeDraft`. |
| 7 | Offline/queued record → sync | Verified `RecordRow` (and therefore the new columns) flow through `offlineQueue.ts` → Supabase unchanged from existing logic. |
| 8 | Open a pre-feature historical record | `rowToRecord()` fallback prevents a crash; displays as NO with no reason. |
| 9 | New record in Preview | Urgent Attention section renders correctly for both YES and NO. |
| 10 | Existing fault analysis behavior | `checklistResponses`/fault logic untouched — confirmed no code path in `faultAnalysis.ts` was modified. |

`npx tsc --noEmit` and `npx vite build` were both run against the full project.
The build succeeds. The only type errors present are the same pre-existing
errors that were in the codebase before this change (unrelated Supabase
`.upsert()` typing quirks, a `FieldConfigManager` fuel_percent typing gap, an
`AdminPanel` unused import, a pre-existing `DraftDetails.fuelCanDetermine`
typing gap in `draftManager.ts`, etc.) — none are new, and none touch the
Urgent Attention feature.

## What Stage 1 deliberately does NOT do

- Does not modify WhatsApp, n8n, Meta templates, or any part of the
  `send-fault-analysis-report` pipeline.
- Does not implement severity levels, equipment shutdown, or automatic
  urgency scoring.
- Does not implement corrective action plans, assignments, or maintenance
  workflows.
- Does not automatically classify a NOT OK checklist item as urgent.
