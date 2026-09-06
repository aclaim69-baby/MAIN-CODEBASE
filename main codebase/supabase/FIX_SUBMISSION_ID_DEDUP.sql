-- ============================================================
-- FIX_SUBMISSION_ID_DEDUP.sql
-- Adds a submission_id column to the records table.
--
-- PURPOSE
--   Prevents duplicate records from the same form-session from
--   reaching the database, even when:
--     • the user clicks Submit multiple times while offline
--     • the offline queue flushes the same record more than once
--     • a network retry lands after the original succeeded
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent via IF NOT EXISTS / DO blocks)
--
-- HOW IT WORKS
--   1. Each form session generates a UUID (submissionId) in the React app.
--   2. That UUID travels through: TechnicianFlow → store → sync → offlineQueue
--   3. offlineQueue skips adding any record whose submission_id is already queued.
--   4. Here, a UNIQUE constraint means even if two rows arrive at the DB, the
--      second upsert is silently ignored (ON CONFLICT DO NOTHING / upsert-safe).
--
-- DOES NOT BLOCK legitimate re-inspections:
--   • Each new inspection session calls crypto.randomUUID() → fresh UUID
--   • The SAME equipment can be submitted many times with different submission_ids
-- ============================================================

-- ── 1. Add the column (safe if it already exists) ──────────────────────────
ALTER TABLE records
  ADD COLUMN IF NOT EXISTS submission_id TEXT;

-- ── 2. Back-fill existing rows so they don't violate the UNIQUE constraint ──
--    Each legacy row gets a unique placeholder UUID so the constraint can be
--    applied without errors.  These rows were created before dedup existed, so
--    we treat them as independent submissions.
UPDATE records
SET    submission_id = gen_random_uuid()::TEXT
WHERE  submission_id IS NULL;

-- ── 3. Make future NULLs impossible ───────────────────────────────────────
ALTER TABLE records
  ALTER COLUMN submission_id SET NOT NULL;

-- ── 4. Add the UNIQUE constraint ─────────────────────────────────────────
--    Use IF NOT EXISTS so re-running this script is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conrelid = 'records'::regclass
    AND    conname  = 'records_submission_id_key'
  ) THEN
    ALTER TABLE records
      ADD CONSTRAINT records_submission_id_key UNIQUE (submission_id);
  END IF;
END;
$$;

-- ── 5. Index for fast conflict detection on upsert ────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_submission_id
  ON records (submission_id);

-- ── 6. Verification ────────────────────────────────────────────────────────
DO $$
DECLARE
  col_exists  BOOLEAN;
  con_exists  BOOLEAN;
  null_count  INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'records' AND column_name = 'submission_id'
  ) INTO col_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE  conrelid = 'records'::regclass AND conname = 'records_submission_id_key'
  ) INTO con_exists;

  SELECT COUNT(*) INTO null_count
  FROM records WHERE submission_id IS NULL;

  RAISE NOTICE '====================================================';
  RAISE NOTICE 'submission_id column exists : %', col_exists;
  RAISE NOTICE 'UNIQUE constraint exists    : %', con_exists;
  RAISE NOTICE 'Rows with NULL submission_id: %', null_count;
  RAISE NOTICE '====================================================';

  IF NOT col_exists THEN
    RAISE EXCEPTION 'FAILED: submission_id column was not created';
  END IF;
  IF NOT con_exists THEN
    RAISE EXCEPTION 'FAILED: UNIQUE constraint was not created';
  END IF;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'FAILED: % rows still have NULL submission_id', null_count;
  END IF;

  RAISE NOTICE 'SUCCESS: Duplicate submission protection is active.';
END;
$$;
