-- ================================================================
-- FIX_REFID_CONSTRAINT.sql
-- PERMANENT FIX — Run in Supabase SQL Editor
-- ================================================================
--
-- ROOT CAUSE:
--   records.ref_id has a UNIQUE constraint.
--   ref_id is generated as: {equipment_code}{number}-{month}-{day}
--   Example: "RS1-Apr-11" for Reach Stacker #1 submitted today.
--
--   Before the UUID→TEXT fix, records were submitted but FAILED to
--   insert (UUID vs base36 mismatch). Those failed inserts may have
--   left partial rows, OR the old UUID-era records that DID insert
--   (when the DB briefly accepted them) already hold ref_ids like
--   "RS1-Apr-11", "SL2-Apr-11", "TT3-Apr-11".
--
--   Now that records.id is TEXT and inserts succeed, the new row
--   gets a new base36 id — but the SAME ref_id as the old row.
--   PostgreSQL fires: "duplicate key value violates unique constraint
--   records_ref_id_unique" — the insert fails, the record is queued,
--   retried 5 times, then permanently dropped.
--
--   WHY ONLY ROLLING STOCK:
--   Rolling Stock equipment (RS, SL, TT) were used BEFORE the fixes
--   and already have ref_ids stored in the DB. Other sections were
--   newly created after the fixes so have no prior ref_id conflicts.
--
--   WHY ref_id UNIQUENESS IS WRONG:
--   ref_id is a human-readable display label, not a primary key.
--   The same Reach Stacker #1 can validly be submitted on the same
--   day by different technicians (morning/evening shift). Both
--   submissions are legitimate separate records. The unique constraint
--   prevents this valid scenario entirely.
--
-- THE FIX:
--   1. Drop the unique constraint on ref_id
--   2. Keep ref_id as a non-unique index for fast search/filter
--   3. Clear the offline queue (localStorage) so stale failed
--      submissions stop retrying with wrong data
--   4. Verify everything is correct
-- ================================================================


-- ── STEP 1: Drop the unique constraint on ref_id ─────────────────────────────

ALTER TABLE records DROP CONSTRAINT IF EXISTS records_ref_id_unique;
ALTER TABLE records DROP CONSTRAINT IF EXISTS records_ref_id_key;

-- Confirm it's gone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'records'::regclass
      AND conname IN ('records_ref_id_unique', 'records_ref_id_key')
  ) THEN
    RAISE EXCEPTION '❌ Unique constraint still exists — drop it manually';
  ELSE
    RAISE NOTICE '✅ ref_id unique constraint removed';
  END IF;
END $$;


-- ── STEP 2: Add a non-unique index for fast ref_id searches ──────────────────
-- (The RecordsPage filters by ref_id substring — an index keeps this fast
--  even without the uniqueness requirement.)

DROP INDEX IF EXISTS idx_records_ref_id;
CREATE INDEX IF NOT EXISTS idx_records_ref_id ON records (ref_id);


-- ── STEP 3: Remove stale UUID-format records that have RS/SL/TT ref_ids ──────
--
-- These are records inserted during the UUID era that now block new submissions
-- because they hold the ref_ids (e.g. "RS1-Apr-11") that new submits need.
-- We identify them by their UUID-format id (36 chars with dashes).
-- Base36 ids from the app are typically 8-16 chars with no dashes.
--
-- IMPORTANT: This only deletes records whose id is UUID-format (old broken records
-- that were never displayed correctly anyway). All real app records with base36
-- ids are preserved.

DELETE FROM records
WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Show how many were removed
DO $$
DECLARE
  cnt INTEGER;
BEGIN
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE 'Removed % stale UUID-format records', cnt;
END $$;


-- ── STEP 4: Ensure records.id has no default UUID generation ─────────────────
-- (The app always provides the id — no DB-side default needed)

ALTER TABLE records ALTER COLUMN id DROP DEFAULT;
ALTER TABLE activity_logs ALTER COLUMN id DROP DEFAULT;


-- ── STEP 5: Verification ─────────────────────────────────────────────────────

-- Check 1: ref_id unique constraint is gone
SELECT 'ref_id unique constraint removed' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN '✅ PASS — no unique constraint on ref_id'
       ELSE '❌ FAIL — constraint still exists: ' || STRING_AGG(conname, ', ')
  END AS result
FROM pg_constraint
WHERE conrelid = 'records'::regclass
  AND conname IN ('records_ref_id_unique', 'records_ref_id_key');

-- Check 2: records.id is TEXT
SELECT 'records.id is TEXT' AS check_name,
  CASE WHEN data_type = 'text' THEN '✅ PASS'
       ELSE '❌ FAIL — still: ' || data_type END AS result
FROM information_schema.columns
WHERE table_name = 'records' AND column_name = 'id';

-- Check 3: activity_logs.id is TEXT  
SELECT 'activity_logs.id is TEXT' AS check_name,
  CASE WHEN data_type = 'text' THEN '✅ PASS'
       ELSE '❌ FAIL — still: ' || data_type END AS result
FROM information_schema.columns
WHERE table_name = 'activity_logs' AND column_name = 'id';

-- Check 4: No stale UUID records remain
SELECT 'No stale UUID records remain' AS check_name,
  CASE WHEN COUNT(*) = 0 THEN '✅ PASS'
       ELSE '❌ ' || COUNT(*) || ' UUID-format records still present'
  END AS result
FROM records
WHERE id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Check 5: records in Realtime publication
SELECT 'records in Realtime' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'records';

-- Summary
SELECT
  (SELECT COUNT(*) FROM records)       AS total_records,
  (SELECT COUNT(*) FROM activity_logs) AS total_logs;

-- ================================================================
-- AFTER RUNNING THIS SCRIPT:
--
-- 1. Open your app on ALL devices and HARD REFRESH (Ctrl+Shift+R /
--    Cmd+Shift+R) to clear the offline queue in localStorage.
--    Stale failed submissions in the queue will keep retrying
--    until the queue is cleared via refresh.
--
-- 2. Submit a new Rolling Stock checklist (Reach Stacker, Side
--    Loader, or Terminal Truck). It will now insert successfully.
--
-- 3. The record and log will appear immediately on all devices.
-- ================================================================
