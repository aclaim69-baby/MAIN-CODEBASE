-- ================================================================
-- FIX_ALL_UUID_TO_TEXT.sql
-- THE ONE PERMANENT FIX — Run in Supabase SQL Editor
-- ================================================================
--
-- ROOT CAUSE OF ALL ISSUES:
--   The live database was created with UUID primary keys on:
--     - records.id          (UUID)  ← app sends base36 text → INSERT fails
--     - activity_logs.id    (UUID)  ← DB trigger sends text → INSERT fails
--     - equipment_type_mappings (already fixed in previous SQL)
--
--   The app generates IDs with uid() = base36 strings like "abc123xyz".
--   PostgreSQL silently rejects these into UUID columns.
--   The error is caught and either queued (records) or swallowed (logs).
--   Result: nothing reaches the database, nothing appears on other devices.
--
-- THIS SCRIPT FIXES EVERYTHING IN ONE RUN:
--   1. Converts records.id from UUID → TEXT
--   2. Converts activity_logs.id from UUID → TEXT
--   3. Rebuilds all constraints, triggers, publication membership
--   4. Verifies every table is correctly configured
--   5. Does NOT touch departments/sections/equipment_types (already TEXT)
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- PART 1 — FIX records TABLE
-- ════════════════════════════════════════════════════════════════

-- Step 1a: Drop constraints that reference the id column
ALTER TABLE records DROP CONSTRAINT IF EXISTS records_pkey;
ALTER TABLE records DROP CONSTRAINT IF EXISTS records_ref_id_unique;
ALTER TABLE records DROP CONSTRAINT IF EXISTS records_ref_id_key;

-- Step 1b: Convert id from UUID to TEXT
--   USING id::TEXT preserves all existing UUID-format rows as text strings.
--   New rows from the app will use base36 strings — both formats are valid TEXT.
ALTER TABLE records ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- Step 1c: Convert ref_id to TEXT (should already be, but force it)
ALTER TABLE records ALTER COLUMN ref_id TYPE TEXT USING ref_id::TEXT;

-- Step 1d: Restore primary key and unique constraint
ALTER TABLE records ADD CONSTRAINT records_pkey PRIMARY KEY (id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_ref_id_unique'
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_unique UNIQUE (ref_id);
  END IF;
END $$;

-- Step 1e: Remove UUID default (new rows get their id from the app)
ALTER TABLE records ALTER COLUMN id DROP DEFAULT;


-- ════════════════════════════════════════════════════════════════
-- PART 2 — FIX activity_logs TABLE
-- ════════════════════════════════════════════════════════════════

-- Step 2a: Drop primary key constraint
ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS activity_logs_pkey;

-- Step 2b: Convert id from UUID to TEXT
ALTER TABLE activity_logs ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- Step 2c: Restore primary key
ALTER TABLE activity_logs ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);

-- Step 2d: Remove UUID default (trigger uses gen_random_uuid()::TEXT explicitly)
ALTER TABLE activity_logs ALTER COLUMN id DROP DEFAULT;


-- ════════════════════════════════════════════════════════════════
-- PART 3 — REBUILD TRIGGERS (reference id columns — must be consistent)
-- ════════════════════════════════════════════════════════════════

-- Rebuild fn_log_record_insert so it explicitly casts to TEXT
CREATE OR REPLACE FUNCTION fn_log_record_insert()
RETURNS TRIGGER AS $$
DECLARE
  log_desc TEXT;
  bucket   BIGINT;
BEGIN
  log_desc := 'Checklist submitted by ' || COALESCE(NEW.technician, 'Unknown');
  bucket   := EXTRACT(EPOCH FROM NOW())::BIGINT / 5;

  IF NOT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'submission'
      AND description = log_desc
      AND COALESCE(actor, '') = COALESCE(NEW.technician, '')
      AND created_at_sec = bucket
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid()::TEXT,   -- TEXT id, not UUID
      'submission',
      log_desc,
      NEW.technician,
      'submissions',
      NOW()
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- never block the record insert
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_record_insert ON records;
CREATE TRIGGER trg_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW EXECUTE FUNCTION fn_log_record_insert();

-- Rebuild fn_log_record_delete similarly
CREATE OR REPLACE FUNCTION fn_log_record_delete()
RETURNS TRIGGER AS $$
DECLARE
  log_desc TEXT;
  bucket   BIGINT;
BEGIN
  log_desc := 'Record deleted: ' || COALESCE(OLD.ref_id, OLD.id);
  bucket   := EXTRACT(EPOCH FROM NOW())::BIGINT / 5;

  IF NOT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'deletion'
      AND description = log_desc
      AND created_at_sec = bucket
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid()::TEXT,
      'deletion',
      log_desc,
      NULL,
      'deletions',
      NOW()
    );
  END IF;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_record_delete ON records;
CREATE TRIGGER trg_log_record_delete
  AFTER DELETE ON records
  FOR EACH ROW EXECUTE FUNCTION fn_log_record_delete();


-- ════════════════════════════════════════════════════════════════
-- PART 4 — REALTIME PUBLICATION (records + activity_logs)
-- ════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE records;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'equipment_type_mappings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE equipment_type_mappings;
  END IF;
END $$;

-- REPLICA IDENTITY FULL on all three tables
ALTER TABLE records                REPLICA IDENTITY FULL;
ALTER TABLE activity_logs          REPLICA IDENTITY FULL;
ALTER TABLE equipment_type_mappings REPLICA IDENTITY FULL;


-- ════════════════════════════════════════════════════════════════
-- PART 5 — RLS + PERMISSIONS (all affected tables)
-- ════════════════════════════════════════════════════════════════

ALTER TABLE records                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs           DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_type_mappings DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE records                 TO anon, authenticated, service_role;
GRANT ALL ON TABLE activity_logs           TO anon, authenticated, service_role;
GRANT ALL ON TABLE equipment_type_mappings TO anon, authenticated, service_role;


-- ════════════════════════════════════════════════════════════════
-- PART 6 — VERIFICATION (all must show ✅ PASS)
-- ════════════════════════════════════════════════════════════════

SELECT 'records.id type' AS check_name,
  CASE WHEN data_type = 'text' THEN '✅ PASS'
       ELSE '❌ FAIL — still: ' || data_type END AS result
FROM information_schema.columns
WHERE table_name = 'records' AND column_name = 'id';

SELECT 'activity_logs.id type' AS check_name,
  CASE WHEN data_type = 'text' THEN '✅ PASS'
       ELSE '❌ FAIL — still: ' || data_type END AS result
FROM information_schema.columns
WHERE table_name = 'activity_logs' AND column_name = 'id';

SELECT 'equipment_type_mappings.department_id type' AS check_name,
  CASE WHEN data_type = 'text' THEN '✅ PASS'
       ELSE '❌ FAIL — still: ' || data_type END AS result
FROM information_schema.columns
WHERE table_name = 'equipment_type_mappings' AND column_name = 'department_id';

SELECT 'records in Realtime' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'records';

SELECT 'activity_logs in Realtime' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'activity_logs';

SELECT 'equipment_type_mappings in Realtime' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'equipment_type_mappings';

SELECT 'records REPLICA IDENTITY' AS check_name,
  CASE WHEN relreplident = 'f' THEN '✅ PASS (FULL)'
       ELSE '❌ FAIL — value: ' || relreplident::text END AS result
FROM pg_class WHERE relname = 'records';

SELECT 'activity_logs REPLICA IDENTITY' AS check_name,
  CASE WHEN relreplident = 'f' THEN '✅ PASS (FULL)'
       ELSE '❌ FAIL — value: ' || relreplident::text END AS result
FROM pg_class WHERE relname = 'activity_logs';

SELECT 'records RLS disabled' AS check_name,
  CASE WHEN relrowsecurity = false THEN '✅ PASS'
       ELSE '❌ FAIL — RLS ON' END AS result
FROM pg_class WHERE relname = 'records';

SELECT 'activity_logs RLS disabled' AS check_name,
  CASE WHEN relrowsecurity = false THEN '✅ PASS'
       ELSE '❌ FAIL — RLS ON' END AS result
FROM pg_class WHERE relname = 'activity_logs';

SELECT 'log insert trigger exists' AS check_name,
  CASE WHEN COUNT(*) > 0 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_trigger WHERE tgname = 'trg_log_record_insert';

-- Final summary
SELECT
  (SELECT COUNT(*) FROM records)       AS total_records,
  (SELECT COUNT(*) FROM activity_logs) AS total_logs,
  (SELECT COUNT(*) FROM equipment_type_mappings) AS total_mappings;
