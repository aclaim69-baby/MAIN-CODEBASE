-- ============================================================
-- ADD_URGENT_ATTENTION.sql
-- Adds requires_urgent_attention / urgent_attention_reason columns
-- to the records table.
--
-- PURPOSE
--   Stage 1 of the Urgent Attention Assessment feature. Lets a
--   technician explicitly flag, at the record level (not per
--   checklist item), whether the inspected equipment requires
--   prompt maintenance or supervisory attention, with an optional
--   free-text reason when flagged YES.
--
--   This is a technician judgment call made AFTER the checklist
--   and BEFORE Preview/Submit — it is NOT automatically derived
--   from a NOT OK checklist status.
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent via IF NOT EXISTS)
-- SAFE FOR AN EXISTING PRODUCTION DATABASE — does not touch or
-- recreate the records table, and does not modify any existing
-- checklist data.
-- ============================================================

-- ── 1. Add the columns (safe if they already exist) ───────────────────────
ALTER TABLE records
  ADD COLUMN IF NOT EXISTS requires_urgent_attention BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE records
  ADD COLUMN IF NOT EXISTS urgent_attention_reason TEXT;

-- ── 2. Back-fill existing rows ─────────────────────────────────────────────
-- Historical records predate this feature. Defaulting
-- requires_urgent_attention to FALSE here is a backwards-compatibility
-- fallback for application compatibility only — it must NOT be
-- interpreted or displayed as an actual technician "No" decision for
-- those older records.
UPDATE records
SET requires_urgent_attention = FALSE
WHERE requires_urgent_attention IS NULL;

-- ── 3. Confirm ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'records'
      AND column_name = 'requires_urgent_attention'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'records'
      AND column_name = 'urgent_attention_reason'
  ) THEN
    RAISE NOTICE 'SUCCESS: requires_urgent_attention and urgent_attention_reason columns are present on the records table.';
  ELSE
    RAISE EXCEPTION 'FAILED: urgent attention columns were not added. Check permissions.';
  END IF;
END;
$$;
