-- ================================================================
-- FIX_EQUIPMENT_MAPPING_SYNC.sql
-- Run this ONCE in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ================================================================
--
-- ROOT CAUSE:
--   equipment_type_mappings was NEVER added to the supabase_realtime
--   publication. Supabase Realtime only emits postgres_changes events
--   for tables listed in this publication. Without it, every INSERT
--   and DELETE on this table is invisible to all other connected devices.
--
-- WHAT THIS SCRIPT FIXES:
--   1. Adds the table to the Realtime publication
--   2. Sets REPLICA IDENTITY FULL so DELETE events carry the full old
--      row (needed so the app can match and remove the correct mapping)
--   3. Ensures RLS is disabled (the app uses anon key — RLS would
--      silently block all reads/writes from other devices)
--   4. Grants correct permissions to anon + authenticated roles
--   5. Ensures a UNIQUE constraint exists to prevent duplicate rows
--   6. Verification queries at the end — check they all return OK
-- ================================================================


-- ── STEP 1: Table structure (safe — ADD IF NOT EXISTS) ────────────────────────

CREATE TABLE IF NOT EXISTS equipment_type_mappings (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  department_id     TEXT        NOT NULL,
  section_id        TEXT        NOT NULL,
  equipment_type_id TEXT        NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist (idempotent)
ALTER TABLE equipment_type_mappings ADD COLUMN IF NOT EXISTS id                TEXT;
ALTER TABLE equipment_type_mappings ADD COLUMN IF NOT EXISTS department_id     TEXT;
ALTER TABLE equipment_type_mappings ADD COLUMN IF NOT EXISTS section_id        TEXT;
ALTER TABLE equipment_type_mappings ADD COLUMN IF NOT EXISTS equipment_type_id TEXT;
ALTER TABLE equipment_type_mappings ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW();

-- Unique constraint prevents duplicate mappings and makes upsert safe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'equipment_type_mappings_unique'
  ) THEN
    ALTER TABLE equipment_type_mappings
      ADD CONSTRAINT equipment_type_mappings_unique
      UNIQUE (department_id, section_id, equipment_type_id);
  END IF;
END $$;


-- ── STEP 2: REPLICA IDENTITY FULL ────────────────────────────────────────────
--
-- WHY: With REPLICA IDENTITY DEFAULT (the PostgreSQL default), DELETE events
-- only include the primary key in payload.old. That is enough to delete by id.
-- But FULL ensures the complete row is available, which is safer and matches
-- how records and activity_logs are configured in this project.
--
ALTER TABLE equipment_type_mappings REPLICA IDENTITY FULL;


-- ── STEP 3: Add to Realtime publication ──────────────────────────────────────
--
-- THIS IS THE PRIMARY FIX.
-- Without this, no Realtime events fire for this table — ever.
-- All devices except the one making the change stay permanently stale.
--
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'equipment_type_mappings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE equipment_type_mappings;
    RAISE NOTICE '✅ equipment_type_mappings added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'ℹ️  equipment_type_mappings already in publication — skipped';
  END IF;
END $$;


-- ── STEP 4: Disable RLS ───────────────────────────────────────────────────────
--
-- This app uses the anon key with RLS disabled (same as records, departments,
-- sections, equipment_types). Enabling RLS without correct policies silently
-- blocks all cross-device reads — devices get empty arrays and can't tell why.
--
ALTER TABLE equipment_type_mappings DISABLE ROW LEVEL SECURITY;


-- ── STEP 5: Permissions ───────────────────────────────────────────────────────

GRANT ALL ON TABLE equipment_type_mappings TO anon;
GRANT ALL ON TABLE equipment_type_mappings TO authenticated;
GRANT ALL ON TABLE equipment_type_mappings TO service_role;


-- ── STEP 6: Sync trigger (stamp sync_status on every write) ──────────────────
--
-- The app polls sync_status.last_updated to detect cross-device changes.
-- Mapping writes must stamp this table so safety-net polls wake up correctly.
-- This mirrors the trigger already on records, departments, sections, etc.
--

-- Create the trigger function if it doesn't exist (it should — defined in SETUP.sql)
CREATE OR REPLACE FUNCTION fn_stamp_sync_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE sync_status SET last_updated = NOW() WHERE id = 1;
  RETURN NULL;
END;
$$;

-- Drop and recreate the trigger on equipment_type_mappings
DROP TRIGGER IF EXISTS trg_stamp_sync_status_on_mappings ON equipment_type_mappings;
CREATE TRIGGER trg_stamp_sync_status_on_mappings
  AFTER INSERT OR UPDATE OR DELETE
  ON equipment_type_mappings
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_stamp_sync_status();


-- ── STEP 7: Verification ──────────────────────────────────────────────────────
--
-- After running this script, ALL of these queries must return the expected value.
-- If any show unexpected results, re-run the relevant step above.
--

-- CHECK A: Is the table in the Realtime publication? → must show 1 row
SELECT
  'CHECK A — Realtime publication' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL — table not in publication' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'equipment_type_mappings';

-- CHECK B: REPLICA IDENTITY → must show 'f' (full)
SELECT
  'CHECK B — Replica Identity' AS check_name,
  CASE WHEN relreplident = 'f' THEN '✅ PASS (FULL)' ELSE '❌ FAIL — not FULL: ' || relreplident::text END AS result
FROM pg_class
WHERE relname = 'equipment_type_mappings';

-- CHECK C: RLS disabled → must show false
SELECT
  'CHECK C — RLS disabled' AS check_name,
  CASE WHEN relrowsecurity = false THEN '✅ PASS (RLS off)' ELSE '❌ FAIL — RLS is ON (will block anon reads)' END AS result
FROM pg_class
WHERE relname = 'equipment_type_mappings';

-- CHECK D: Unique constraint exists
SELECT
  'CHECK D — Unique constraint' AS check_name,
  CASE WHEN COUNT(*) > 0 THEN '✅ PASS' ELSE '❌ FAIL — no unique constraint' END AS result
FROM pg_constraint
WHERE conname = 'equipment_type_mappings_unique';

-- CHECK E: Sync trigger exists
SELECT
  'CHECK E — Sync trigger' AS check_name,
  CASE WHEN COUNT(*) > 0 THEN '✅ PASS' ELSE '❌ FAIL — trigger missing' END AS result
FROM pg_trigger
WHERE tgname = 'trg_stamp_sync_status_on_mappings';

-- CHECK F: Current data (informational)
SELECT
  'CHECK F — Row count' AS check_name,
  COUNT(*)::TEXT || ' mapping rows in table' AS result
FROM equipment_type_mappings;
