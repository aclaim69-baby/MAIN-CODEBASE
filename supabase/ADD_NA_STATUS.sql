-- ============================================================
--  ADD N/A STATUS SUPPORT
--  Daily Checking App — Run this in Supabase SQL Editor
-- ============================================================
--
--  BACKGROUND
--  ----------
--  Checklist response statuses are stored as plain text values
--  inside the JSONB `checklist` column of the `records` table.
--  There are NO database-level CHECK constraints on those values,
--  so the database already accepts 'N/A' without any schema change.
--
--  This migration:
--    1. Confirms the records table structure is correct (safe no-op).
--    2. Adds a comment documenting the three valid status values.
--    3. Provides a verification query so you can confirm everything
--       looks right after running.
--
--  CROSS-DEVICE SYNC
--  -----------------
--  Because status values live inside the JSONB blob that is
--  already replicated via Supabase Realtime, 'N/A' records will
--  sync to every device automatically — no extra work needed.
--
-- ============================================================

-- 1. Safety check — make sure the checklist column is JSONB
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name  = 'records'
      AND column_name = 'checklist'
      AND data_type   = 'jsonb'
  ) THEN
    RAISE EXCEPTION
      'records.checklist is not JSONB — cannot store N/A values safely. '
      'Run fix_database.sql first to convert the column type.';
  END IF;
END $$;

-- 2. Annotate the column with the three accepted status values
COMMENT ON COLUMN records.checklist IS
  'JSONB array of checklist response objects. '
  'Each object has: itemId, label, status (''OK'' | ''NOT OK'' | ''N/A''), '
  'comment, actionPlan, isSubheading. '
  'N/A means the item is not applicable for this inspection.';

-- 3. Verification — run this to confirm existing + new rows are healthy
SELECT
  'Total records'            AS metric,
  COUNT(*)::TEXT             AS value
FROM records

UNION ALL

SELECT
  'Rows with at least one N/A status',
  COUNT(*)::TEXT
FROM records
WHERE checklist @> '[{"status":"N/A"}]'

UNION ALL

SELECT
  'Rows with at least one NOT OK status',
  COUNT(*)::TEXT
FROM records
WHERE checklist @> '[{"status":"NOT OK"}]'

UNION ALL

SELECT
  'Rows with all items OK or N/A (no issues)',
  COUNT(*)::TEXT
FROM records
WHERE NOT (checklist @> '[{"status":"NOT OK"}]');

-- ============================================================
--  DONE — No structural changes were needed.
--  The app code update (N/A option in dropdowns) is the only
--  change required to enable N/A support end-to-end.
-- ============================================================
