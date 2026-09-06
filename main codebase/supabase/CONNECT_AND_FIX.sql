-- =============================================================================
--  DAILY CHECKING APP — COMPLETE DATABASE SETUP & FIX
--  Supabase Project: yjlcfdscrejxntjtpnyf
--  Safe to run multiple times (fully idempotent)
--
--  HOW TO RUN:
--    1. Open https://supabase.com/dashboard/project/yjlcfdscrejxntjtpnyf
--    2. Click "SQL Editor" in the left sidebar
--    3. Click "New query"
--    4. Paste this entire file
--    5. Click "Run" (or Ctrl+Enter)
--    6. Check Section 12 results at the bottom to verify everything is correct
-- =============================================================================


-- =============================================================================
--  SECTION 1 — records TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS records (
  id               TEXT PRIMARY KEY,
  ref_id           TEXT NOT NULL,
  department       TEXT NOT NULL DEFAULT '',
  section          TEXT NOT NULL DEFAULT '',
  equipment_type   TEXT NOT NULL DEFAULT '',
  equipment_code   TEXT NOT NULL DEFAULT '',
  equipment_number TEXT NOT NULL DEFAULT '',
  date             TEXT NOT NULL DEFAULT '',
  start_time       TEXT NOT NULL DEFAULT '',
  completion_time  TEXT NOT NULL DEFAULT '',
  hour_meter       TEXT NOT NULL DEFAULT '',
  technician       TEXT NOT NULL DEFAULT '',
  supervisor       TEXT NOT NULL DEFAULT '',
  qc_verifier      TEXT NOT NULL DEFAULT '',
  checklist        JSONB NOT NULL DEFAULT '[]',
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns (safe — IF NOT EXISTS guards)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='ref_id')
    THEN ALTER TABLE records ADD COLUMN ref_id TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='department')
    THEN ALTER TABLE records ADD COLUMN department TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='section')
    THEN ALTER TABLE records ADD COLUMN section TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_type')
    THEN ALTER TABLE records ADD COLUMN equipment_type TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_code')
    THEN ALTER TABLE records ADD COLUMN equipment_code TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_number')
    THEN ALTER TABLE records ADD COLUMN equipment_number TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='date')
    THEN ALTER TABLE records ADD COLUMN date TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='start_time')
    THEN ALTER TABLE records ADD COLUMN start_time TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='completion_time')
    THEN ALTER TABLE records ADD COLUMN completion_time TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='hour_meter')
    THEN ALTER TABLE records ADD COLUMN hour_meter TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='technician')
    THEN ALTER TABLE records ADD COLUMN technician TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='supervisor')
    THEN ALTER TABLE records ADD COLUMN supervisor TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='qc_verifier')
    THEN ALTER TABLE records ADD COLUMN qc_verifier TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='submitted_at')
    THEN ALTER TABLE records ADD COLUMN submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='created_at')
    THEN ALTER TABLE records ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); END IF;
END $$;

-- Ensure checklist is JSONB (convert from TEXT if needed)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='records' AND column_name='checklist' AND data_type='text'
  ) THEN
    ALTER TABLE records ALTER COLUMN checklist TYPE JSONB USING checklist::JSONB;
  END IF;
END $$;

-- Remove rogue columns that break the frontend mapper
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='data')
    THEN ALTER TABLE records DROP COLUMN data; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='event_type')
    THEN ALTER TABLE records DROP COLUMN event_type; END IF;
END $$;

-- Unique constraint on ref_id (prevents duplicate submissions)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'records_ref_id_key' AND conrelid = 'records'::regclass
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_key UNIQUE (ref_id);
  END IF;
END $$;

-- Index for ORDER BY submitted_at DESC (used by fetchRemoteRecords)
CREATE INDEX IF NOT EXISTS records_submitted_at_idx ON records (submitted_at DESC);

-- Index for technician name search
CREATE INDEX IF NOT EXISTS records_technician_idx ON records (technician);


-- =============================================================================
--  SECTION 2 — activity_logs TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT        PRIMARY KEY,
  type        TEXT        NOT NULL DEFAULT 'record_submitted',
  description TEXT        NOT NULL DEFAULT '',
  actor       TEXT,
  section     TEXT        NOT NULL DEFAULT 'submissions',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='type')
    THEN ALTER TABLE activity_logs ADD COLUMN type TEXT NOT NULL DEFAULT 'record_submitted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='description')
    THEN ALTER TABLE activity_logs ADD COLUMN description TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='actor')
    THEN ALTER TABLE activity_logs ADD COLUMN actor TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='section')
    THEN ALTER TABLE activity_logs ADD COLUMN section TEXT NOT NULL DEFAULT 'submissions'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='created_at')
    THEN ALTER TABLE activity_logs ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); END IF;
END $$;

-- Remove rogue columns (event_type, color, data, payload break the rowToLog mapper)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='event_type')
    THEN ALTER TABLE activity_logs DROP COLUMN event_type; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='color')
    THEN ALTER TABLE activity_logs DROP COLUMN color; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='data')
    THEN ALTER TABLE activity_logs DROP COLUMN data; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='payload')
    THEN ALTER TABLE activity_logs DROP COLUMN payload; END IF;
END $$;

-- Add created_at_sec as a stored generated column (BIGINT seconds since epoch).
-- This avoids the "immutable function" error when building dedup indexes.
-- date_trunc() is not immutable so cannot be used in a UNIQUE INDEX directly.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='activity_logs' AND column_name='created_at_sec'
  ) THEN
    ALTER TABLE activity_logs
      ADD COLUMN created_at_sec BIGINT GENERATED ALWAYS AS
        (EXTRACT(EPOCH FROM created_at)::BIGINT) STORED;
  END IF;
END $$;

-- Remove any broken indexes from previous runs before recreating
DROP INDEX IF EXISTS activity_logs_dedup_idx;
DROP INDEX IF EXISTS activity_logs_dedup_safe;
DROP INDEX IF EXISTS activity_logs_unique_idx;

-- Remove exact duplicate rows (same id inserted twice)
DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid) FROM activity_logs GROUP BY id
);

-- Remove near-duplicate rows (same content within same second)
DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM activity_logs
  GROUP BY type, description, COALESCE(actor, ''), (created_at_sec / 5)
);

-- Safe dedup index using the stored BIGINT column (no immutability issues)
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_safe
  ON activity_logs (type, description, COALESCE(actor, ''), (created_at_sec / 5));

-- Index for ORDER BY created_at DESC (used by fetchRemoteLogs)
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs (created_at DESC);


-- =============================================================================
--  SECTION 3 — admins TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS admins (
  id                  TEXT    PRIMARY KEY,
  email               TEXT    NOT NULL UNIQUE,
  password            TEXT    NOT NULL DEFAULT '',
  password_set        BOOLEAN NOT NULL DEFAULT FALSE,
  is_super_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  role                TEXT    NOT NULL DEFAULT 'junior',
  can_delete_records  BOOLEAN NOT NULL DEFAULT TRUE,
  can_add_admins      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='password')
    THEN ALTER TABLE admins ADD COLUMN password TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='password_set')
    THEN ALTER TABLE admins ADD COLUMN password_set BOOLEAN NOT NULL DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='is_super_admin')
    THEN ALTER TABLE admins ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='role')
    THEN ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'junior'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='can_delete_records')
    THEN ALTER TABLE admins ADD COLUMN can_delete_records BOOLEAN NOT NULL DEFAULT TRUE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='can_add_admins')
    THEN ALTER TABLE admins ADD COLUMN can_add_admins BOOLEAN NOT NULL DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='created_at')
    THEN ALTER TABLE admins ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); END IF;
END $$;

-- Fix NULL or invalid roles
UPDATE admins SET role = 'junior'
WHERE role IS NULL OR role NOT IN ('junior', 'senior');

-- ── SUPER ADMIN FIX (CRITICAL) ──────────────────────────────────────────────
-- Delete any corrupt/duplicate rows for admin@system.com first
DELETE FROM admins WHERE LOWER(email) = 'admin@system.com';

-- Insert the canonical super admin row with ALL fields correct
INSERT INTO admins (
  id, email, password, password_set, is_super_admin,
  role, can_delete_records, can_add_admins, created_at
) VALUES (
  'admin-super',
  'admin@system.com',
  'admin1',      -- login password
  TRUE,          -- password_set = TRUE so login works (not redirected to set-password screen)
  TRUE,          -- is_super_admin = TRUE — this is what mapAdmin() reads for full access
  'junior',      -- role column — intentionally 'junior'; super admin is identified by is_super_admin only
  TRUE,
  TRUE,
  NOW()
);


-- =============================================================================
--  SECTION 4 — settings TABLE
-- =============================================================================

-- Check if id column is UUID (wrong type) and fix it
DO $$
DECLARE
  col_type TEXT;
  saved_footer TEXT;
  saved_qc     BOOLEAN;
  saved_nav    TEXT;
  saved_home   TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'settings' AND column_name = 'id';

  -- If id is UUID or wrong type, rescue data and recreate table with INTEGER id
  IF col_type IS NOT NULL AND col_type <> 'integer' THEN
    -- Save existing data before drop
    BEGIN
      EXECUTE 'SELECT footer_text FROM settings LIMIT 1' INTO saved_footer;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN
      EXECUTE 'SELECT qc_required FROM settings LIMIT 1' INTO saved_qc;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    DROP TABLE settings;
  END IF;
END $$;

-- Create with correct INTEGER primary key
CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER     PRIMARY KEY CHECK (id = 1),
  footer_text TEXT        NOT NULL DEFAULT 'Designed by workshop inventory',
  qc_required BOOLEAN     NOT NULL DEFAULT FALSE,
  nav_logo    TEXT,        -- base64 data URL for nav bar logo
  home_logo   TEXT,        -- base64 data URL for homepage logo
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='footer_text')
    THEN ALTER TABLE settings ADD COLUMN footer_text TEXT NOT NULL DEFAULT 'Designed by workshop inventory'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='qc_required')
    THEN ALTER TABLE settings ADD COLUMN qc_required BOOLEAN NOT NULL DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='nav_logo')
    THEN ALTER TABLE settings ADD COLUMN nav_logo TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='home_logo')
    THEN ALTER TABLE settings ADD COLUMN home_logo TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='updated_at')
    THEN ALTER TABLE settings ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); END IF;
END $$;

-- Remove rogue 'data' JSONB column (incompatible with the upsertSettings pattern)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='data')
    THEN ALTER TABLE settings DROP COLUMN data; END IF;
END $$;

-- Remove duplicate rows (keep only id = 1)
DELETE FROM settings WHERE id <> 1;

-- Ensure the canonical single row exists
INSERT INTO settings (id, footer_text, qc_required)
VALUES (1, 'Designed by workshop inventory', FALSE)
ON CONFLICT (id) DO UPDATE SET
  footer_text = COALESCE(NULLIF(settings.footer_text, ''), EXCLUDED.footer_text),
  qc_required = COALESCE(settings.qc_required, EXCLUDED.qc_required);


-- =============================================================================
--  SECTION 5 — checklist_templates TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
  id                TEXT PRIMARY KEY,
  equipment_type_id TEXT NOT NULL,
  section_id        TEXT NOT NULL,
  items             JSONB NOT NULL DEFAULT '[]',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_templates' AND column_name='equipment_type_id')
    THEN ALTER TABLE checklist_templates ADD COLUMN equipment_type_id TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_templates' AND column_name='section_id')
    THEN ALTER TABLE checklist_templates ADD COLUMN section_id TEXT NOT NULL DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_templates' AND column_name='items')
    THEN ALTER TABLE checklist_templates ADD COLUMN items JSONB NOT NULL DEFAULT '[]'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_templates' AND column_name='updated_at')
    THEN ALTER TABLE checklist_templates ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); END IF;
END $$;

-- Remove duplicates (keep newest per equipment_type_id + section_id)
DELETE FROM checklist_templates
WHERE ctid NOT IN (
  SELECT DISTINCT ON (equipment_type_id, section_id) ctid
  FROM checklist_templates
  ORDER BY equipment_type_id, section_id, updated_at DESC
);

-- Unique constraint (one template per equipment + section combination)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_templates_eq_sec_key'
  ) THEN
    ALTER TABLE checklist_templates
      ADD CONSTRAINT checklist_templates_eq_sec_key
      UNIQUE (equipment_type_id, section_id);
  END IF;
END $$;


-- =============================================================================
--  SECTION 6 — departments, sections, equipment_types TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS departments (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sections (
  id            TEXT PRIMARY KEY,
  department_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment_types (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
--  SECTION 7 — DISABLE ROW LEVEL SECURITY (CRITICAL)
--
--  RLS is enabled by default on all Supabase tables.
--  With RLS on and no policies defined, the anon / publishable key receives
--  ZERO ROWS on every SELECT — silently, with no error message.
--  This causes the records page to appear empty, logs to not load, etc.
--
--  This app uses a custom admin auth system (not Supabase Auth), so there is
--  no user JWT to write RLS policies against. Disabling RLS is correct here.
-- =============================================================================

ALTER TABLE records            DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs      DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins             DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings           DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE sections           DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types    DISABLE ROW LEVEL SECURITY;


-- =============================================================================
--  SECTION 8 — REPLICA IDENTITY FULL (CRITICAL FOR DELETE REALTIME EVENTS)
--
--  Without REPLICA IDENTITY FULL, Supabase Realtime fires DELETE events but
--  payload.old = {} (empty object). The frontend reads payload.old.id to
--  remove the record from state — if id is undefined, nothing is removed.
--
--  FULL tells PostgreSQL to write the complete old row to the WAL stream,
--  so Supabase Realtime can deliver it in payload.old with all fields intact.
-- =============================================================================

ALTER TABLE records       REPLICA IDENTITY FULL;
ALTER TABLE activity_logs REPLICA IDENTITY FULL;


-- =============================================================================
--  SECTION 9 — REALTIME PUBLICATION (CRITICAL FOR CROSS-DEVICE UPDATES)
--
--  Both tables MUST be in the supabase_realtime publication.
--  If missing, the WebSocket channel shows status "SUBSCRIBED" but delivers
--  ZERO events — silently. Submissions appear locally but not on other devices.
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE records;
    RAISE NOTICE 'Added records to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'records already in supabase_realtime publication';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
    RAISE NOTICE 'Added activity_logs to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'activity_logs already in supabase_realtime publication';
  END IF;
END $$;


-- =============================================================================
--  SECTION 10 — AUTO-LOG TRIGGER (INSERT)
--
--  Automatically creates an activity_log entry whenever a checklist record
--  is inserted. This is the DB-level guarantee that every submission is logged,
--  even if the frontend log call fails.
--
--  5-SECOND DEDUP GUARD: Prevents double-logs when both the frontend
--  syncInsertLog() and this trigger fire for the same submission.
--  If a log with matching type+description+actor was created in the last 5
--  seconds, the trigger skips inserting (the frontend already did it).
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_log_record_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  log_description TEXT;
  log_actor       TEXT;
  now_sec         BIGINT;
  exists_count    INT;
BEGIN
  -- Build description matching the frontend format exactly
  -- store.ts: `Checklist submitted by ${technicianName} (${equipmentTypeName} #${equipmentNumber})`
  log_description := 'Checklist submitted by ' || COALESCE(NEW.technician, 'Unknown')
    || ' (' || COALESCE(NEW.equipment_type, '') || ' #' || COALESCE(NEW.equipment_number, '') || ')';
  log_actor       := COALESCE(NEW.technician, 'Unknown');
  now_sec         := EXTRACT(EPOCH FROM NOW())::BIGINT;

  -- 5-second dedup: skip if a matching log was already created by the frontend
  SELECT COUNT(*) INTO exists_count
  FROM activity_logs
  WHERE type        = 'record_submitted'
    AND description = log_description
    AND COALESCE(actor, '') = log_actor
    AND (now_sec - (EXTRACT(EPOCH FROM created_at)::BIGINT)) < 5;

  IF exists_count > 0 THEN
    RETURN NEW;  -- frontend already logged it — skip duplicate
  END IF;

  -- Insert the log entry
  INSERT INTO activity_logs (id, type, description, actor, section, created_at)
  VALUES (
    gen_random_uuid()::TEXT,
    'record_submitted',
    log_description,
    log_actor,
    'submissions',
    NOW()
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Never let a logging failure block the record insert
  RAISE WARNING 'fn_log_record_insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_record_insert ON records;
CREATE TRIGGER trg_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_record_insert();


-- =============================================================================
--  SECTION 11 — AUTO-LOG TRIGGER (DELETE)
--
--  Automatically logs record deletions. Same 5-second dedup guard.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_log_record_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  log_description TEXT;
  now_sec         BIGINT;
  exists_count    INT;
BEGIN
  log_description := 'Record deleted: ' || COALESCE(OLD.ref_id, OLD.id)
    || ' (' || COALESCE(OLD.technician, 'Unknown') || ')';
  now_sec := EXTRACT(EPOCH FROM NOW())::BIGINT;

  SELECT COUNT(*) INTO exists_count
  FROM activity_logs
  WHERE type        = 'record_deleted'
    AND description = log_description
    AND (now_sec - (EXTRACT(EPOCH FROM created_at)::BIGINT)) < 5;

  IF exists_count > 0 THEN
    RETURN OLD;
  END IF;

  INSERT INTO activity_logs (id, type, description, actor, section, created_at)
  VALUES (
    gen_random_uuid()::TEXT,
    'record_deleted',
    log_description,
    NULL,
    'deletions',
    NOW()
  );

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


-- =============================================================================
--  SECTION 12 — VERIFICATION QUERIES
--
--  After running the script, inspect these results in the SQL Editor output.
--  Every check should return the expected value shown in the comments.
-- =============================================================================

-- 12A: Super admin row — MUST show is_super_admin = true, password = admin1
SELECT
  id,
  email,
  password,
  password_set,
  is_super_admin,
  role,
  can_delete_records,
  can_add_admins
FROM admins
WHERE LOWER(email) = 'admin@system.com';
-- ✅ Expected: 1 row, is_super_admin = true, password = 'admin1'

-- 12B: Realtime publication — MUST show 2 rows (records + activity_logs)
SELECT tablename, pubname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('records', 'activity_logs')
ORDER BY tablename;
-- ✅ Expected: 2 rows

-- 12C: Replica identity — MUST show relreplident = 'f' (FULL) for both tables
SELECT relname, relreplident
FROM pg_class
WHERE relname IN ('records', 'activity_logs');
-- ✅ Expected: relreplident = 'f' for both rows

-- 12D: Triggers — MUST show 2 triggers
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN ('trg_log_record_insert', 'trg_log_record_delete')
ORDER BY trigger_name;
-- ✅ Expected: 2 rows

-- 12E: RLS disabled — MUST show rowsecurity = false for all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN (
  'records','activity_logs','admins','settings',
  'checklist_templates','departments','sections','equipment_types'
)
ORDER BY tablename;
-- ✅ Expected: rowsecurity = false for all 8 tables

-- 12F: Settings — MUST show exactly 1 row with id = 1
SELECT id, footer_text, qc_required FROM settings;
-- ✅ Expected: 1 row, id = 1

-- 12G: Dedup index exists on activity_logs
SELECT indexname FROM pg_indexes
WHERE tablename = 'activity_logs' AND indexname = 'activity_logs_dedup_safe';
-- ✅ Expected: 1 row

-- 12H: submitted_at column exists in records
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'records' AND column_name = 'submitted_at';
-- ✅ Expected: 1 row, data_type = 'timestamp with time zone'

-- 12I: activity_logs has correct columns (NO event_type, color, data, payload)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'activity_logs'
ORDER BY ordinal_position;
-- ✅ Expected: id, type, description, actor, section, created_at, created_at_sec
-- ❌ Must NOT contain: event_type, color, data, payload

-- 12J: No duplicate ref_id values in records
SELECT ref_id, COUNT(*) as cnt
FROM records
GROUP BY ref_id
HAVING COUNT(*) > 1;
-- ✅ Expected: 0 rows (no duplicates)

-- 12K: No duplicate admin emails
SELECT email, COUNT(*) as cnt
FROM admins
GROUP BY email
HAVING COUNT(*) > 1;
-- ✅ Expected: 0 rows
