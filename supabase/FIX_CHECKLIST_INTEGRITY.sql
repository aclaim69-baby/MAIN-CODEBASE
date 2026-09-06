-- ============================================================
-- FIX_CHECKLIST_INTEGRITY.sql
-- Checklist data integrity fix — run once in Supabase SQL Editor
-- ============================================================
--
-- WHAT THIS FIXES:
--   The records.checklist column stores the full checklist as JSONB.
--   Each array element is a ChecklistResponse object with fields:
--     itemId, label, status, comment, actionPlan, isSubheading
--
--   This migration ensures:
--   1. The column exists and is JSONB (not TEXT)
--   2. Realtime publishes the full row so cross-device sync works
--   3. No bad defaults silently convert NOT OK → OK
--
-- FRONTEND BUGS FIXED (in code, not SQL):
--   - _realtimeUpdateRecord now preserves local checklist when
--     Supabase Realtime strips it (64KB payload limit)
--   - upsertRecords now merges checklists instead of overwriting
--   - New records arriving on other devices immediately get their
--     checklist fetched via fetchRecordChecklist()
-- ============================================================

-- 1. Ensure checklist column is JSONB (safe if already correct)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'records' AND column_name = 'checklist'
    AND data_type = 'text'
  ) THEN
    ALTER TABLE records ALTER COLUMN checklist TYPE JSONB USING checklist::JSONB;
  END IF;
END $$;

ALTER TABLE records ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]';

-- 2. Enable REPLICA IDENTITY FULL so Realtime payloads include the full row.
--    Without this, UPDATE events only carry changed columns — the checklist
--    may be missing from the payload even when it hasn't changed.
ALTER TABLE records REPLICA IDENTITY FULL;

-- 3. Ensure records table is in the Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE records;
  END IF;
END $$;

-- 4. Verify: check for any records where checklist is null (shouldn't happen)
UPDATE records SET checklist = '[]' WHERE checklist IS NULL;

-- 5. Quick sanity check — shows count of records with non-empty checklists
SELECT
  COUNT(*) AS total_records,
  COUNT(*) FILTER (WHERE jsonb_array_length(checklist) > 0) AS records_with_checklist,
  COUNT(*) FILTER (WHERE jsonb_array_length(checklist) = 0) AS records_without_checklist
FROM records;
