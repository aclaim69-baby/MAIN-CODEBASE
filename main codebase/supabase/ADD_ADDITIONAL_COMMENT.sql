-- ============================================================
-- ADD_ADDITIONAL_COMMENT.sql
-- Adds an optional additional_comment column to the records table.
--
-- PURPOSE
--   Allows technicians (and super admins) to enter free-text remarks
--   at the end of the checklist before submitting a daily check.
--   The comment is displayed in the record detail view, in the PDF
--   export, and synced across devices via Supabase realtime.
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent via IF NOT EXISTS)
-- ============================================================

-- ── 1. Add the column (safe if it already exists) ─────────────────────────
ALTER TABLE records
  ADD COLUMN IF NOT EXISTS additional_comment TEXT DEFAULT '';

-- ── 2. Back-fill existing rows with an empty string ───────────────────────
UPDATE records
SET additional_comment = ''
WHERE additional_comment IS NULL;

-- ── 3. Confirm ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'records'
      AND column_name = 'additional_comment'
  ) THEN
    RAISE NOTICE 'SUCCESS: additional_comment column is present on the records table.';
  ELSE
    RAISE EXCEPTION 'FAILED: additional_comment column was not added. Check permissions.';
  END IF;
END;
$$;
