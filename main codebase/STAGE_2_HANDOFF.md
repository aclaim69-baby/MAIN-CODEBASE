# Stage 2 Handoff — What's Now Available

Stage 1 is complete and verified. This document describes exactly what data
Stage 2 (n8n + WhatsApp integration) can now consume. **Stage 2 has not been
started** — WhatsApp, n8n, and the Meta template remain completely unmodified.

## What's now reliably persisted

Every new inspection Record in Supabase's `records` table now carries:

| Column | Type | Meaning |
|---|---|---|
| `requires_urgent_attention` | `boolean` (`NOT NULL DEFAULT FALSE`) | Whether the technician flagged this equipment as needing urgent attention. |
| `urgent_attention_reason` | `text` (nullable) | Technician's free-text reason. Only meaningful when `requires_urgent_attention = true`. |

Also exposed in the app's `Record` TypeScript type as:

```ts
requiresUrgentAttention: boolean;
urgentAttentionReason?: string;
```

## How Stage 2 should query it

For a given reporting window (e.g. "today"), the equivalent of:

```sql
SELECT equipment_code, equipment_number, urgent_attention_reason
FROM records
WHERE requires_urgent_attention = true
  AND date = <report_date>
ORDER BY submitted_at ASC;
```

gives the list needed to build the dynamic Urgent Attention block described in
the original spec (Section 21/26), e.g.:

```
2 Equipment Require Urgent Attention

TT91 — Brake performance reduced
RS26 — Hydraulic leak requires attention
```

## Reminders for whoever picks up Stage 2

- **Do not** replace the existing five WhatsApp body parameters (`{{1}}`–`{{5}}`).
  The spec calls for exactly one new variable (`{{6}}`) carrying the entire
  formatted Urgent Attention block as a single string.
- **Do not** create a separate variable per urgent equipment — the count is
  dynamic and must not be hardcoded.
- **Zero urgent equipment** needs an explicit decision on presentation
  (e.g. "0 Equipment Require Urgent Attention" vs. omitting the section) —
  confirm before changing the approved Meta template.
- If `requires_urgent_attention` data is unavailable for any reason, the
  existing Daily Fault Report must continue to send without failing.
- Existing fault detection (`checklistResponses[].status === 'NOT OK'`) is
  completely separate from urgent attention and was not touched — don't
  conflate the two in the n8n payload logic.
- First inspect the current n8n workflow (webhook node, existing
  `body_params` mapping, WhatsApp node, template name/language) before
  changing anything, per the original spec's Section 25.

Stage 2 is not implemented in this delivery — this document only hands off
the data contract that Stage 1 now guarantees.
