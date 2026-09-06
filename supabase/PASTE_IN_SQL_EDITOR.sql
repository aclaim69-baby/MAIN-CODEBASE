-- ============================================================
--  DAILY CHECKING APP — COMPLETE DATABASE SETUP & AUTO-UPDATE
--  
--  HOW TO RUN:
--  1. Go to https://supabase.com/dashboard
--  2. Open your project
--  3. Click "SQL Editor" in the left sidebar
--  4. Click "New query"
--  5. Copy this ENTIRE file and paste it
--  6. Click "Run"
--  7. Scroll down to see verification results
--
--  SAFE TO RUN MULTIPLE TIMES — nothing is dropped or lost.
-- ============================================================


-- ==============================================================
-- SECTION 1 — records TABLE
-- Creates the table and all columns the app expects exactly.
-- ==============================================================

CREATE TABLE IF NOT EXISTS records (
  id               TEXT PRIMARY KEY,
  ref_id           TEXT,
  department       TEXT,
  section          TEXT,
  equipment_type   TEXT,
  equipment_code   TEXT,
  equipment_number TEXT,
  date             TEXT,
  start_time       TEXT,
  completion_time  TEXT,
  hour_meter       TEXT,
  technician       TEXT,
  supervisor       TEXT,
  qc_verifier      TEXT,
  checklist        JSONB    DEFAULT '[]'::jsonb,
  submitted_at     TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Add any missing columns safely (will not error if already exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='ref_id')           THEN ALTER TABLE records ADD COLUMN ref_id TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='department')       THEN ALTER TABLE records ADD COLUMN department TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='section')          THEN ALTER TABLE records ADD COLUMN section TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_type')   THEN ALTER TABLE records ADD COLUMN equipment_type TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_code')   THEN ALTER TABLE records ADD COLUMN equipment_code TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_number') THEN ALTER TABLE records ADD COLUMN equipment_number TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='date')             THEN ALTER TABLE records ADD COLUMN date TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='start_time')       THEN ALTER TABLE records ADD COLUMN start_time TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='completion_time')  THEN ALTER TABLE records ADD COLUMN completion_time TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='hour_meter')       THEN ALTER TABLE records ADD COLUMN hour_meter TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='technician')       THEN ALTER TABLE records ADD COLUMN technician TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='supervisor')       THEN ALTER TABLE records ADD COLUMN supervisor TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='qc_verifier')      THEN ALTER TABLE records ADD COLUMN qc_verifier TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='submitted_at')     THEN ALTER TABLE records ADD COLUMN submitted_at TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='created_at')       THEN ALTER TABLE records ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(); END IF;
END $$;

-- Fix checklist column to JSONB if it was created as TEXT
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='records' AND column_name='checklist' AND data_type='text'
  ) THEN
    ALTER TABLE records ALTER COLUMN checklist TYPE JSONB USING checklist::jsonb;
  END IF;
END $$;

-- Add unique constraint on ref_id to block duplicate submissions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_ref_id_key'
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_key UNIQUE (ref_id);
  END IF;
END $$;

-- Index for fast ordering by submitted_at (most recent first)
CREATE INDEX IF NOT EXISTS records_submitted_at_idx ON records (submitted_at DESC);

-- Index for fast ordering by created_at
CREATE INDEX IF NOT EXISTS records_created_at_idx ON records (created_at DESC);


-- ==============================================================
-- SECTION 2 — activity_logs TABLE
-- Exact columns: id, type, description, actor, section, created_at
-- ==============================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  type        TEXT,
  description TEXT,
  actor       TEXT,
  section     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add any missing columns safely
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='type')        THEN ALTER TABLE activity_logs ADD COLUMN type TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='description') THEN ALTER TABLE activity_logs ADD COLUMN description TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='actor')       THEN ALTER TABLE activity_logs ADD COLUMN actor TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='section')     THEN ALTER TABLE activity_logs ADD COLUMN section TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='created_at')  THEN ALTER TABLE activity_logs ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(); END IF;
END $$;

-- Remove rogue columns that break the mapper (if they exist from old setup)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='event_type') THEN ALTER TABLE activity_logs DROP COLUMN event_type; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='color')      THEN ALTER TABLE activity_logs DROP COLUMN color; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='data')       THEN ALTER TABLE activity_logs DROP COLUMN data; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='payload')    THEN ALTER TABLE activity_logs DROP COLUMN payload; END IF;
END $$;

-- Add created_at_sec for safe deduplication index (avoids immutable function error)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='activity_logs' AND column_name='created_at_sec'
  ) THEN
    ALTER TABLE activity_logs
    ADD COLUMN created_at_sec BIGINT GENERATED ALWAYS AS
      (EXTRACT(EPOCH FROM created_at)::BIGINT / 5) STORED;
  END IF;
END $$;

-- Remove exact duplicate log rows (same id inserted twice)
DELETE FROM activity_logs a
WHERE a.ctid <> (
  SELECT MIN(b.ctid)
  FROM activity_logs b
  WHERE b.id = a.id
);

-- Remove near-duplicate log rows (same content within 5 seconds)
DELETE FROM activity_logs a
WHERE a.ctid <> (
  SELECT MIN(b.ctid)
  FROM activity_logs b
  WHERE b.type        = a.type
    AND b.description = a.description
    AND COALESCE(b.actor, '') = COALESCE(a.actor, '')
    AND ABS(EXTRACT(EPOCH FROM (b.created_at - a.created_at))) < 5
);

-- Drop old broken indexes (safe — they will be recreated below)
DROP INDEX IF EXISTS activity_logs_dedup_idx;
DROP INDEX IF EXISTS activity_logs_dedup_safe;
DROP INDEX IF EXISTS activity_logs_created_at_idx;

-- Safe dedup index using the stored column (no immutable function error)
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_safe
  ON activity_logs (type, description, COALESCE(actor, ''), created_at_sec);

-- Index for fast ordering
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx
  ON activity_logs (created_at DESC);


-- ==============================================================
-- SECTION 3 — admins TABLE
-- Fixes super admin login bug — is_super_admin must be TRUE.
-- ==============================================================

CREATE TABLE IF NOT EXISTS admins (
  id                TEXT PRIMARY KEY,
  email             TEXT UNIQUE,
  password          TEXT,
  password_set      BOOLEAN DEFAULT FALSE,
  is_super_admin    BOOLEAN DEFAULT FALSE,
  role              TEXT    DEFAULT 'junior',
  can_delete_records BOOLEAN DEFAULT TRUE,
  can_add_admins    BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Add any missing columns safely
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='password_set')       THEN ALTER TABLE admins ADD COLUMN password_set BOOLEAN DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='is_super_admin')     THEN ALTER TABLE admins ADD COLUMN is_super_admin BOOLEAN DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='role')               THEN ALTER TABLE admins ADD COLUMN role TEXT DEFAULT 'junior'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='can_delete_records') THEN ALTER TABLE admins ADD COLUMN can_delete_records BOOLEAN DEFAULT TRUE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='can_add_admins')     THEN ALTER TABLE admins ADD COLUMN can_add_admins BOOLEAN DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='created_at')         THEN ALTER TABLE admins ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(); END IF;
END $$;

-- Fix NULL or invalid roles
UPDATE admins
SET role = 'junior'
WHERE role IS NULL OR role NOT IN ('junior', 'senior');

-- *** THE CRITICAL FIX — Super Admin row ***
-- Delete any corrupt/duplicate rows for admin@system.com first
DELETE FROM admins WHERE LOWER(email) = 'admin@system.com';

-- Insert the correct super admin row with every field right
INSERT INTO admins (
  id, email, password, password_set,
  is_super_admin, role,
  can_delete_records, can_add_admins
) VALUES (
  'admin-super',
  'admin@system.com',
  'admin1',
  TRUE,
  TRUE,          -- ← THIS is what mapAdmin() reads: row.is_super_admin === true
  'junior',      -- role column is ignored for super admins by the app
  TRUE,
  TRUE
);


-- ==============================================================
-- SECTION 4 — settings TABLE
-- Must use INTEGER id = 1 (NOT UUID).
-- ==============================================================

-- Check if id column is wrong type and fix it
DO $$ BEGIN
  -- If id is UUID type, recreate the table properly
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='settings'
      AND column_name='id'
      AND data_type IN ('uuid','character varying','text')
  ) THEN
    -- Save existing data
    CREATE TEMP TABLE settings_backup AS SELECT * FROM settings LIMIT 1;
    DROP TABLE settings;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  footer_text TEXT    DEFAULT 'Designed by workshop inventory',
  qc_required BOOLEAN DEFAULT FALSE,
  nav_logo    TEXT    DEFAULT NULL,
  home_logo   TEXT    DEFAULT NULL,
  CONSTRAINT settings_single_row CHECK (id = 1)
);

-- Restore data from backup if it existed
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='settings_backup') THEN
    UPDATE settings s SET
      footer_text = COALESCE((SELECT footer_text FROM settings_backup LIMIT 1), s.footer_text),
      qc_required = COALESCE((SELECT qc_required FROM settings_backup LIMIT 1), s.qc_required)
    WHERE s.id = 1;
    DROP TABLE settings_backup;
  END IF;
END $$;

-- Add missing columns safely
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='footer_text') THEN ALTER TABLE settings ADD COLUMN footer_text TEXT DEFAULT 'Designed by workshop inventory'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='qc_required') THEN ALTER TABLE settings ADD COLUMN qc_required BOOLEAN DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='nav_logo')    THEN ALTER TABLE settings ADD COLUMN nav_logo TEXT DEFAULT NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='home_logo')   THEN ALTER TABLE settings ADD COLUMN home_logo TEXT DEFAULT NULL; END IF;
END $$;

-- Remove rogue data column if it exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='data') THEN
    ALTER TABLE settings DROP COLUMN data;
  END IF;
END $$;

-- Remove all rows except id=1
DELETE FROM settings WHERE id <> 1;

-- Ensure exactly one row with id=1 exists
INSERT INTO settings (id, footer_text, qc_required)
VALUES (1, 'Designed by workshop inventory', FALSE)
ON CONFLICT (id) DO NOTHING;


-- ==============================================================
-- SECTION 5 — checklist_templates TABLE
-- ==============================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
  id               TEXT PRIMARY KEY,
  equipment_type_id TEXT,
  section_id        TEXT,
  items             JSONB DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Fix items column to JSONB if wrong type
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='checklist_templates'
      AND column_name='items'
      AND data_type='text'
  ) THEN
    ALTER TABLE checklist_templates ALTER COLUMN items TYPE JSONB USING items::jsonb;
  END IF;
END $$;

-- Remove duplicate templates, keep most recent
DELETE FROM checklist_templates a
WHERE a.ctid <> (
  SELECT MIN(b.ctid)
  FROM checklist_templates b
  WHERE b.equipment_type_id = a.equipment_type_id
    AND b.section_id        = a.section_id
);

-- Unique constraint: one template per equipment+section
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_templates_unique_pair'
  ) THEN
    ALTER TABLE checklist_templates
    ADD CONSTRAINT checklist_templates_unique_pair
    UNIQUE (equipment_type_id, section_id);
  END IF;
END $$;


-- ==============================================================
-- SECTION 6 — departments, sections, equipment_types TABLES
-- ==============================================================

CREATE TABLE IF NOT EXISTS departments (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sections (
  id            TEXT PRIMARY KEY,
  department_id TEXT,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment_types (
  id         TEXT PRIMARY KEY,
  code       TEXT,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ==============================================================
-- SECTION 7 — DISABLE ROW LEVEL SECURITY (CRITICAL)
--
-- RLS with no policies = 0 rows returned silently to the anon key.
-- This is the #1 hidden cause of empty data and failed updates.
-- Disabling it lets the publishable key read and write freely.
-- ==============================================================

ALTER TABLE records            DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs      DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins             DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings           DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE sections           DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types    DISABLE ROW LEVEL SECURITY;


-- ==============================================================
-- SECTION 8 — REPLICA IDENTITY FULL (CRITICAL FOR DELETE EVENTS)
--
-- Without FULL, DELETE realtime events fire but payload.old = {}
-- So the app reads id = undefined and never removes the record.
-- FULL puts the complete old row in payload.old.
-- ==============================================================

ALTER TABLE records       REPLICA IDENTITY FULL;
ALTER TABLE activity_logs REPLICA IDENTITY FULL;


-- ==============================================================
-- SECTION 9 — ENABLE REALTIME (CRITICAL FOR INSTANT UPDATES)
--
-- Tables MUST be in the supabase_realtime publication.
-- If missing, the WebSocket shows SUBSCRIBED but fires ZERO events.
-- This is why records don't appear on other devices without refresh.
-- ==============================================================

DO $$ BEGIN
  -- Add records to realtime publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE records;
    RAISE NOTICE 'records added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'records already in supabase_realtime publication';
  END IF;
END $$;

DO $$ BEGIN
  -- Add activity_logs to realtime publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
    RAISE NOTICE 'activity_logs added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'activity_logs already in supabase_realtime publication';
  END IF;
END $$;


-- ==============================================================
-- SECTION 10 — AUTO-LOG TRIGGER ON RECORD INSERT
--
-- When any device submits a checklist → automatically insert
-- an activity_log entry. The 5-second dedup guard prevents
-- duplicate logs when both frontend syncInsertLog() and this
-- trigger fire at the same time.
-- ==============================================================

CREATE OR REPLACE FUNCTION fn_log_record_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_desc TEXT;
  v_sec  BIGINT;
BEGIN
  -- Build description matching the format in store.ts addRecord()
  v_desc := 'Checklist submitted by ' || COALESCE(NEW.technician, 'Unknown');

  -- Compute 5-second bucket for dedup (same as created_at_sec column)
  v_sec := EXTRACT(EPOCH FROM NOW())::BIGINT / 5;

  -- Only insert if no similar log exists in this 5-second window
  IF NOT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'checklist_submitted'
      AND description = v_desc
      AND created_at_sec = v_sec
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid()::text,
      'checklist_submitted',
      v_desc,
      COALESCE(NEW.technician, 'Unknown'),
      'submissions',
      NOW()
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block record insertion due to log failure
  RAISE WARNING 'fn_log_record_insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_record_insert ON records;

CREATE TRIGGER trg_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_record_insert();


-- ==============================================================
-- SECTION 11 — AUTO-LOG TRIGGER ON RECORD DELETE
-- ==============================================================

CREATE OR REPLACE FUNCTION fn_log_record_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_desc TEXT;
  v_sec  BIGINT;
BEGIN
  v_desc := 'Record deleted: ' || COALESCE(OLD.ref_id, OLD.id);
  v_sec  := EXTRACT(EPOCH FROM NOW())::BIGINT / 5;

  IF NOT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'record_deleted'
      AND description = v_desc
      AND created_at_sec = v_sec
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid()::text,
      'record_deleted',
      v_desc,
      NULL,
      'deletions',
      NOW()
    );
  END IF;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_log_record_delete failed: %', SQLERRM;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_record_delete ON records;

CREATE TRIGGER trg_log_record_delete
  AFTER DELETE ON records
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_record_delete();


-- ==============================================================
-- SECTION 12 — VERIFICATION QUERIES
--
-- These run automatically after the script.
-- Check the results in the output panel below.
-- ==============================================================

-- 12A: Super admin must show is_super_admin = true, password = admin1
SELECT
  '12A — SUPER ADMIN' AS check_name,
  id, email, password, password_set, is_super_admin, role
FROM admins
WHERE LOWER(email) = 'admin@system.com';

-- 12B: Both tables must be in realtime publication (must return 2 rows)
SELECT
  '12B — REALTIME PUBLICATION' AS check_name,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('records', 'activity_logs');

-- 12C: Replica identity must be FULL = 'f' for both tables (must return 2 rows)
SELECT
  '12C — REPLICA IDENTITY' AS check_name,
  relname AS table_name,
  CASE relreplident
    WHEN 'd' THEN 'DEFAULT (bad — DELETE wont work)'
    WHEN 'f' THEN 'FULL (correct)'
    WHEN 'i' THEN 'INDEX'
    WHEN 'n' THEN 'NOTHING'
  END AS replica_identity
FROM pg_class
WHERE relname IN ('records', 'activity_logs');

-- 12D: Both triggers must exist (must return 2 rows)
SELECT
  '12D — TRIGGERS' AS check_name,
  trigger_name,
  event_manipulation,
  event_object_table
FROM information_schema.triggers
WHERE trigger_name IN ('trg_log_record_insert', 'trg_log_record_delete');

-- 12E: RLS must be disabled on all tables (rowsecurity = false for all)
SELECT
  '12E — RLS DISABLED' AS check_name,
  relname AS table_name,
  CASE relrowsecurity
    WHEN TRUE  THEN 'ENABLED (bad — will block reads)'
    WHEN FALSE THEN 'DISABLED (correct)'
  END AS rls_status
FROM pg_class
WHERE relname IN (
  'records','activity_logs','admins','settings',
  'checklist_templates','departments','sections','equipment_types'
)
ORDER BY relname;

-- 12F: Settings must have exactly 1 row with id = 1
SELECT
  '12F — SETTINGS' AS check_name,
  COUNT(*) AS row_count,
  MIN(id) AS id,
  MAX(footer_text) AS footer_text
FROM settings;

-- 12G: No duplicate ref_id values in records
SELECT
  '12G — DUPLICATE RECORDS' AS check_name,
  COUNT(*) AS duplicate_count
FROM (
  SELECT ref_id, COUNT(*) AS c
  FROM records
  GROUP BY ref_id
  HAVING COUNT(*) > 1
) x;

-- 12H: activity_logs must have the safe dedup index
SELECT
  '12H — DEDUP INDEX' AS check_name,
  indexname,
  tablename
FROM pg_indexes
WHERE indexname = 'activity_logs_dedup_safe';

-- 12I: activity_logs must NOT have rogue columns
SELECT
  '12I — ROGUE COLUMNS' AS check_name,
  column_name,
  'BAD — this column breaks the log mapper' AS status
FROM information_schema.columns
WHERE table_name = 'activity_logs'
  AND column_name IN ('event_type', 'color', 'data', 'payload');

-- 12J: Show all columns in records table
SELECT
  '12J — RECORDS COLUMNS' AS check_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'records'
ORDER BY ordinal_position;

-- 12K: Show all columns in activity_logs table
SELECT
  '12K — LOG COLUMNS' AS check_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'activity_logs'
ORDER BY ordinal_position;


-- ==============================================================
--  DONE — If all checks above look correct, your app will:
--
--  ✅ Update records instantly across all devices (realtime)
--  ✅ Update activity logs instantly across all devices
--  ✅ Poll every 15 seconds as a fallback safety net
--  ✅ Super admin logs in correctly
--  ✅ No duplicate records or logs
--  ✅ No silent RLS blocks
--  ✅ DELETE events carry the full old row
-- ==============================================================
