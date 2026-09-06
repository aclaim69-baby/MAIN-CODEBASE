-- =============================================================
--  DAILY CHECKING APP — DEFINITIVE DATABASE FIX
--  Safe to run multiple times (fully idempotent)
--  Matches exact column names used in db.ts / store.ts
--  Run in Supabase SQL Editor → New Query → Run
-- =============================================================


-- ===========================================================
-- SECTION 1 — records TABLE
-- ===========================================================

-- 1A. Create records table if it does not exist
CREATE TABLE IF NOT EXISTS records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_id        TEXT NOT NULL,
  department    TEXT NOT NULL DEFAULT '',
  section       TEXT NOT NULL DEFAULT '',
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

-- 1B. Add any missing columns safely (already-existing columns are skipped)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='ref_id') THEN
    ALTER TABLE records ADD COLUMN ref_id TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='department') THEN
    ALTER TABLE records ADD COLUMN department TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='section') THEN
    ALTER TABLE records ADD COLUMN section TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_type') THEN
    ALTER TABLE records ADD COLUMN equipment_type TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_code') THEN
    ALTER TABLE records ADD COLUMN equipment_code TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_number') THEN
    ALTER TABLE records ADD COLUMN equipment_number TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='date') THEN
    ALTER TABLE records ADD COLUMN date TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='start_time') THEN
    ALTER TABLE records ADD COLUMN start_time TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='completion_time') THEN
    ALTER TABLE records ADD COLUMN completion_time TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='hour_meter') THEN
    ALTER TABLE records ADD COLUMN hour_meter TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='technician') THEN
    ALTER TABLE records ADD COLUMN technician TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='supervisor') THEN
    ALTER TABLE records ADD COLUMN supervisor TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='qc_verifier') THEN
    ALTER TABLE records ADD COLUMN qc_verifier TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='checklist') THEN
    ALTER TABLE records ADD COLUMN checklist JSONB NOT NULL DEFAULT '[]';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='submitted_at') THEN
    ALTER TABLE records ADD COLUMN submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='created_at') THEN
    ALTER TABLE records ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

-- 1C. Convert checklist column to JSONB if it was created as TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'records'
      AND column_name = 'checklist'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE records ALTER COLUMN checklist TYPE JSONB USING checklist::jsonb;
  END IF;
END $$;

-- 1D. Performance index on submitted_at DESC (matches ORDER BY in fetchRecords)
CREATE INDEX IF NOT EXISTS records_submitted_at_idx ON records (submitted_at DESC);

-- 1E. Unique constraint on ref_id (prevents duplicate submissions at DB level)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'records'::regclass AND conname = 'records_ref_id_unique'
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_unique UNIQUE (ref_id);
  END IF;
END $$;

-- 1F. Remove any rogue columns that don't belong
--     (e.g. "data" or "event_type" that may have been added by mistake)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='data') THEN
    ALTER TABLE records DROP COLUMN data;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='event_type') THEN
    ALTER TABLE records DROP COLUMN event_type;
  END IF;
END $$;


-- ===========================================================
-- SECTION 2 — activity_logs TABLE
-- ===========================================================
-- IMPORTANT: The app uses these exact columns:
--   id, type, description, actor, section, created_at
-- NOT: event_type, color, data, payload
-- ===========================================================

-- 2A. Create activity_logs table if it does not exist
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT '',
  section     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2B. Add any missing columns safely
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='type') THEN
    ALTER TABLE activity_logs ADD COLUMN type TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='description') THEN
    ALTER TABLE activity_logs ADD COLUMN description TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='actor') THEN
    ALTER TABLE activity_logs ADD COLUMN actor TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='section') THEN
    ALTER TABLE activity_logs ADD COLUMN section TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='created_at') THEN
    ALTER TABLE activity_logs ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

-- 2C. Add a stable integer second column (avoids immutable-function index errors)
--     This is used by the duplicate-prevention index below
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='created_at_sec') THEN
    ALTER TABLE activity_logs ADD COLUMN created_at_sec BIGINT GENERATED ALWAYS AS
      (EXTRACT(EPOCH FROM created_at)::BIGINT / 5) STORED;
  END IF;
END $$;

-- 2D. Remove rogue columns that don't belong
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='event_type') THEN
    ALTER TABLE activity_logs DROP COLUMN event_type;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='color') THEN
    ALTER TABLE activity_logs DROP COLUMN color;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='data') THEN
    ALTER TABLE activity_logs DROP COLUMN data;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='payload') THEN
    ALTER TABLE activity_logs DROP COLUMN payload;
  END IF;
END $$;

-- 2E. Drop any broken or non-immutable indexes from previous attempts
DROP INDEX IF EXISTS activity_logs_dedup_idx;
DROP INDEX IF EXISTS activity_logs_unique_idx;
DROP INDEX IF EXISTS activity_logs_dedup_safe;
DROP INDEX IF EXISTS idx_activity_logs_dedup;

-- 2F. Remove exact duplicate rows (same id inserted twice)
DELETE FROM activity_logs a
USING activity_logs b
WHERE a.ctid > b.ctid
  AND a.id = b.id;

-- 2G. Remove near-duplicate rows (same content within 5-second window)
--     Keeps the row with the smallest ctid per group
DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM activity_logs
  GROUP BY type, description, actor, section, (EXTRACT(EPOCH FROM created_at)::BIGINT / 5)
);

-- 2H. Create safe duplicate-prevention index using the STORED generated column
--     (no immutable-function error because created_at_sec is a stored value)
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_safe
  ON activity_logs (type, description, actor, section, created_at_sec);

-- 2I. Performance index on created_at DESC (matches ORDER BY in fetchLogs)
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs (created_at DESC);


-- ===========================================================
-- SECTION 3 — settings TABLE
-- ===========================================================
-- id must be INTEGER = 1 (not UUID)
-- The app always upserts with id = 1
-- ===========================================================

-- 3A. Create settings with correct INTEGER id if it does not exist
CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  footer_text TEXT NOT NULL DEFAULT 'Designed by workshop inventory',
  qc_required BOOLEAN NOT NULL DEFAULT FALSE,
  nav_logo    TEXT,
  home_logo   TEXT
);

-- 3B. Add missing columns if the table already exists with wrong schema
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='footer_text') THEN
    ALTER TABLE settings ADD COLUMN footer_text TEXT NOT NULL DEFAULT 'Designed by workshop inventory';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='qc_required') THEN
    ALTER TABLE settings ADD COLUMN qc_required BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='nav_logo') THEN
    ALTER TABLE settings ADD COLUMN nav_logo TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='home_logo') THEN
    ALTER TABLE settings ADD COLUMN home_logo TEXT;
  END IF;
END $$;

-- 3C. Drop rogue "data" JSONB column if it exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='data') THEN
    -- Rescue any data from the JSONB blob before dropping
    UPDATE settings
    SET
      footer_text = COALESCE(
        (data->>'footer_text')::TEXT,
        footer_text,
        'Designed by workshop inventory'
      ),
      qc_required = COALESCE(
        (data->>'qc_required')::BOOLEAN,
        qc_required,
        FALSE
      )
    WHERE data IS NOT NULL;
    ALTER TABLE settings DROP COLUMN data;
  END IF;
END $$;

-- 3D. Fix settings.id column type if it was created as UUID
--     (cannot ALTER type directly; must recreate)
DO $$
DECLARE
  col_type TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'settings' AND column_name = 'id';

  IF col_type IN ('uuid', 'character varying', 'text') THEN
    -- Save existing data
    CREATE TEMP TABLE settings_backup AS SELECT * FROM settings;
    -- Drop and recreate with correct type
    DROP TABLE settings;
    CREATE TABLE settings (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      footer_text TEXT NOT NULL DEFAULT 'Designed by workshop inventory',
      qc_required BOOLEAN NOT NULL DEFAULT FALSE,
      nav_logo    TEXT,
      home_logo   TEXT
    );
    -- Restore first row's non-id data if any existed
    INSERT INTO settings (id, footer_text, qc_required, nav_logo, home_logo)
    SELECT
      1,
      COALESCE(MIN(footer_text), 'Designed by workshop inventory'),
      COALESCE(BOOL_OR(qc_required), FALSE),
      MIN(nav_logo),
      MIN(home_logo)
    FROM settings_backup
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE IF EXISTS settings_backup;
  END IF;
END $$;

-- 3E. Remove any extra rows (only id = 1 should ever exist)
DELETE FROM settings WHERE id <> 1;

-- 3F. Ensure exactly one canonical row exists
INSERT INTO settings (id, footer_text, qc_required, nav_logo, home_logo)
VALUES (1, 'Designed by workshop inventory', FALSE, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  footer_text = COALESCE(NULLIF(settings.footer_text, ''), 'Designed by workshop inventory'),
  qc_required = COALESCE(settings.qc_required, FALSE);

-- 3G. Add check constraint so a second row can never be inserted
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'settings'::regclass AND conname = 'settings_single_row'
  ) THEN
    ALTER TABLE settings ADD CONSTRAINT settings_single_row CHECK (id = 1);
  END IF;
END $$;


-- ===========================================================
-- SECTION 4 — admins TABLE
-- ===========================================================

-- 4A. Create admins table if it does not exist
CREATE TABLE IF NOT EXISTS admins (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  password           TEXT NOT NULL DEFAULT '',
  password_set       BOOLEAN NOT NULL DEFAULT FALSE,
  is_super_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  role               TEXT NOT NULL DEFAULT 'junior',
  can_delete_records BOOLEAN NOT NULL DEFAULT FALSE,
  can_add_admins     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4B. Add any missing columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='is_super_admin') THEN
    ALTER TABLE admins ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='password_set') THEN
    ALTER TABLE admins ADD COLUMN password_set BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='can_delete_records') THEN
    ALTER TABLE admins ADD COLUMN can_delete_records BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='can_add_admins') THEN
    ALTER TABLE admins ADD COLUMN can_add_admins BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='role') THEN
    ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'junior';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='created_at') THEN
    ALTER TABLE admins ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  END IF;
END $$;

-- 4C. Unique constraint on email
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'admins'::regclass AND conname = 'admins_email_unique'
  ) THEN
    ALTER TABLE admins ADD CONSTRAINT admins_email_unique UNIQUE (email);
  END IF;
END $$;

-- 4D. Fix NULL or invalid roles
UPDATE admins SET role = 'junior'
WHERE role IS NULL OR role NOT IN ('junior', 'senior');

-- 4E. DEFINITIVE SUPER ADMIN FIX
--     is_super_admin = TRUE is what mapAdmin() reads to grant super access
--     The role column value ('junior') is irrelevant for super admins
DELETE FROM admins WHERE LOWER(email) = 'admin@system.com';
INSERT INTO admins (id, email, password, password_set, is_super_admin, role, can_delete_records, can_add_admins)
VALUES ('admin-super', 'admin@system.com', 'admin1', TRUE, TRUE, 'junior', TRUE, TRUE);


-- ===========================================================
-- SECTION 5 — checklist_templates TABLE
-- ===========================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_type_id TEXT NOT NULL,
  section_id        TEXT NOT NULL,
  items             JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_templates' AND column_name='equipment_type_id') THEN
    ALTER TABLE checklist_templates ADD COLUMN equipment_type_id TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_templates' AND column_name='section_id') THEN
    ALTER TABLE checklist_templates ADD COLUMN section_id TEXT NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_templates' AND column_name='items') THEN
    ALTER TABLE checklist_templates ADD COLUMN items JSONB NOT NULL DEFAULT '[]';
  END IF;
END $$;

-- Convert items to JSONB if TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checklist_templates'
      AND column_name = 'items'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE checklist_templates ALTER COLUMN items TYPE JSONB USING items::jsonb;
  END IF;
END $$;

-- Remove duplicate templates (keep newest per equipment+section pair)
DELETE FROM checklist_templates a
USING checklist_templates b
WHERE a.created_at < b.created_at
  AND a.equipment_type_id = b.equipment_type_id
  AND a.section_id = b.section_id;

-- Unique constraint per equipment+section pair
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'checklist_templates'::regclass
      AND conname = 'checklist_templates_pair_unique'
  ) THEN
    ALTER TABLE checklist_templates
      ADD CONSTRAINT checklist_templates_pair_unique
      UNIQUE (equipment_type_id, section_id);
  END IF;
END $$;


-- ===========================================================
-- SECTION 6 — departments, sections, equipment_types TABLES
-- ===========================================================

CREATE TABLE IF NOT EXISTS departments (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sections (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  department_id TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ===========================================================
-- SECTION 7 — ROW LEVEL SECURITY — DISABLE ON ALL TABLES
-- ===========================================================
-- The app uses only the anon/publishable key.
-- RLS with no policies = 0 rows returned silently.
-- Disabling RLS lets the key read/write freely.
-- ===========================================================

ALTER TABLE records            DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs      DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins             DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings           DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE sections           DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types    DISABLE ROW LEVEL SECURITY;


-- ===========================================================
-- SECTION 8 — REPLICA IDENTITY FULL
-- ===========================================================
-- Required so DELETE events include payload.old.id
-- Without this, realtime DELETE fires but payload.old = {}
-- and the frontend cannot identify which record to remove
-- ===========================================================

ALTER TABLE records       REPLICA IDENTITY FULL;
ALTER TABLE activity_logs REPLICA IDENTITY FULL;
ALTER TABLE admins        REPLICA IDENTITY FULL;


-- ===========================================================
-- SECTION 9 — REALTIME PUBLICATION
-- ===========================================================
-- Both tables MUST be in supabase_realtime publication
-- or postgres_changes events are never fired
-- ===========================================================

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


-- ===========================================================
-- SECTION 10 — TRIGGER: AUTO-LOG ON RECORD INSERT
-- ===========================================================
-- Fires AFTER INSERT on records
-- Inserts one activity_log entry per submission
-- Uses a 5-second dedup window (created_at_sec column)
-- to prevent double-logging when frontend also calls addLog
-- ===========================================================

CREATE OR REPLACE FUNCTION fn_log_record_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_description TEXT;
  v_sec         BIGINT;
  v_exists      BOOLEAN;
BEGIN
  -- Build description to match frontend format exactly:
  -- "Checklist submitted by <technician>"
  v_description := 'Checklist submitted by ' || COALESCE(NEW.technician, 'Unknown');

  -- 5-second bucket to match the dedup index
  v_sec := EXTRACT(EPOCH FROM NOW())::BIGINT / 5;

  -- Check if a log with the same content already exists in this 5-second window
  SELECT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'submission'
      AND description = v_description
      AND actor       = COALESCE(NEW.technician, '')
      AND section     = COALESCE(NEW.section, '')
      AND created_at_sec = v_sec
  ) INTO v_exists;

  -- Only insert if no near-duplicate exists
  IF NOT v_exists THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid(),
      'submission',
      v_description,
      COALESCE(NEW.technician, ''),
      COALESCE(NEW.section, ''),
      NOW()
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let the trigger crash a record insert
  RAISE WARNING 'fn_log_record_insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_record_insert ON records;
CREATE TRIGGER trg_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_record_insert();


-- ===========================================================
-- SECTION 11 — TRIGGER: AUTO-LOG ON RECORD DELETE
-- ===========================================================

CREATE OR REPLACE FUNCTION fn_log_record_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_description TEXT;
  v_sec         BIGINT;
  v_exists      BOOLEAN;
BEGIN
  v_description := 'Record ' || COALESCE(OLD.ref_id, OLD.id::TEXT) || ' deleted';
  v_sec := EXTRACT(EPOCH FROM NOW())::BIGINT / 5;

  SELECT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'deletion'
      AND description = v_description
      AND created_at_sec = v_sec
  ) INTO v_exists;

  IF NOT v_exists THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid(),
      'deletion',
      v_description,
      '',
      COALESCE(OLD.section, ''),
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


-- ===========================================================
-- SECTION 12 — VERIFICATION QUERIES
-- Run these after the script to confirm everything is correct
-- ===========================================================

-- 12A. Super admin row — must show is_super_admin = true, password = admin1
SELECT id, email, password, password_set, is_super_admin, role
FROM admins
WHERE LOWER(email) = 'admin@system.com';

-- 12B. No duplicate admins — must return 0 rows
SELECT email, COUNT(*) as cnt
FROM admins
GROUP BY email
HAVING COUNT(*) > 1;

-- 12C. Settings row — must show exactly 1 row with id = 1
SELECT id, footer_text, qc_required FROM settings;

-- 12D. Realtime publication — must show records and activity_logs
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('records', 'activity_logs')
ORDER BY tablename;

-- 12E. Triggers — must show 2 rows
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN ('trg_log_record_insert', 'trg_log_record_delete')
ORDER BY trigger_name;

-- 12F. Replica identity — relreplident must be 'f' (FULL) for both tables
SELECT relname, relreplident
FROM pg_class
WHERE relname IN ('records', 'activity_logs');

-- 12G. RLS disabled — rowsecurity must be false for all tables
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN (
  'records','activity_logs','admins','settings',
  'checklist_templates','departments','sections','equipment_types'
)
ORDER BY relname;

-- 12H. Dedup index exists on activity_logs
SELECT indexname FROM pg_indexes
WHERE tablename = 'activity_logs'
  AND indexname = 'activity_logs_dedup_safe';

-- 12I. No duplicate records by ref_id — must return 0 rows
SELECT ref_id, COUNT(*) as cnt
FROM records
GROUP BY ref_id
HAVING COUNT(*) > 1;

-- 12J. Column verification — activity_logs must have these exact columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'activity_logs'
ORDER BY ordinal_position;

-- 12K. Column verification — records must have submitted_at
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'records' AND column_name = 'submitted_at';
