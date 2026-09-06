-- ============================================================
--  Daily Checking App — Realtime & Cross-Device Sync Fix
--  Paste the ENTIRE file into Supabase SQL Editor → Run
--  Safe to run multiple times (fully idempotent)
-- ============================================================


-- ==============================================================
-- SECTION 1: RECORDS TABLE — ensure all columns exist
-- ==============================================================

CREATE TABLE IF NOT EXISTS records (
  id             TEXT PRIMARY KEY,
  ref_id         TEXT,
  department     TEXT,
  section        TEXT,
  equipment_type TEXT,
  equipment_code TEXT,
  equipment_number TEXT,
  date           TEXT,
  start_time     TEXT,
  completion_time TEXT,
  hour_meter     TEXT,
  technician     TEXT,
  supervisor     TEXT,
  qc_verifier    TEXT,
  checklist      JSONB DEFAULT '[]'::jsonb,
  submitted_at   TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Add any missing columns safely (IF NOT EXISTS guards)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='ref_id')
    THEN ALTER TABLE records ADD COLUMN ref_id TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='department')
    THEN ALTER TABLE records ADD COLUMN department TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='section')
    THEN ALTER TABLE records ADD COLUMN section TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_type')
    THEN ALTER TABLE records ADD COLUMN equipment_type TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_code')
    THEN ALTER TABLE records ADD COLUMN equipment_code TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='equipment_number')
    THEN ALTER TABLE records ADD COLUMN equipment_number TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='date')
    THEN ALTER TABLE records ADD COLUMN date TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='start_time')
    THEN ALTER TABLE records ADD COLUMN start_time TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='completion_time')
    THEN ALTER TABLE records ADD COLUMN completion_time TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='hour_meter')
    THEN ALTER TABLE records ADD COLUMN hour_meter TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='technician')
    THEN ALTER TABLE records ADD COLUMN technician TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='supervisor')
    THEN ALTER TABLE records ADD COLUMN supervisor TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='qc_verifier')
    THEN ALTER TABLE records ADD COLUMN qc_verifier TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='submitted_at')
    THEN ALTER TABLE records ADD COLUMN submitted_at TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='records' AND column_name='created_at')
    THEN ALTER TABLE records ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(); END IF;
END $$;

-- Ensure checklist column is JSONB (convert from TEXT if needed)
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
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'checklist column type conversion skipped: %', SQLERRM;
END $$;

-- Index for fast ordering by submitted_at DESC (used by fetchRemoteRecords)
CREATE INDEX IF NOT EXISTS idx_records_submitted_at
  ON records (submitted_at DESC);

-- Unique constraint on ref_id to prevent duplicate submissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'records_ref_id_unique'
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_unique UNIQUE (ref_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'records_ref_id_unique constraint skipped: %', SQLERRM;
END $$;


-- ==============================================================
-- SECTION 2: ACTIVITY_LOGS TABLE — exact columns from sync.ts
-- ==============================================================
-- Columns: id, type, description, actor, section, created_at
-- NOTE: The app uses "type" NOT "event_type" — do NOT add event_type

CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  description TEXT,
  actor       TEXT,
  section     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Add any missing columns safely
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='type')
    THEN ALTER TABLE activity_logs ADD COLUMN type TEXT NOT NULL DEFAULT 'submission'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='description')
    THEN ALTER TABLE activity_logs ADD COLUMN description TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='actor')
    THEN ALTER TABLE activity_logs ADD COLUMN actor TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='section')
    THEN ALTER TABLE activity_logs ADD COLUMN section TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='created_at')
    THEN ALTER TABLE activity_logs ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW(); END IF;
END $$;

-- Drop any rogue columns that break the mapper (event_type, color, data, payload)
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

-- Index for fast ordering by created_at DESC (used by fetchRemoteLogs)
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
  ON activity_logs (created_at DESC);

-- Safe dedup: remove exact duplicate rows keeping oldest id
DELETE FROM activity_logs a
WHERE a.ctid <> (
  SELECT MIN(b.ctid)
  FROM activity_logs b
  WHERE b.id = a.id
);

-- Add a stored BIGINT column for dedup index (avoids immutable function error)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activity_logs'
      AND column_name = 'created_at_sec'
  ) THEN
    ALTER TABLE activity_logs
      ADD COLUMN created_at_sec BIGINT
      GENERATED ALWAYS AS (EXTRACT(EPOCH FROM created_at)::BIGINT / 5) STORED;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'created_at_sec column skipped: %', SQLERRM;
END $$;

-- Drop old broken indexes before creating correct ones
DROP INDEX IF EXISTS activity_logs_dedup_idx;
DROP INDEX IF EXISTS activity_logs_dedup_safe;

-- Safe dedup index using stored column (no immutable error)
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_safe
  ON activity_logs (type, COALESCE(description,''), COALESCE(actor,''), created_at_sec)
  WHERE created_at_sec IS NOT NULL;


-- ==============================================================
-- SECTION 3: ADMINS TABLE — super admin fix
-- ==============================================================

CREATE TABLE IF NOT EXISTS admins (
  id               TEXT PRIMARY KEY,
  email            TEXT UNIQUE,
  password         TEXT,
  password_set     BOOLEAN DEFAULT FALSE,
  is_super_admin   BOOLEAN DEFAULT FALSE,
  role             TEXT DEFAULT 'junior',
  can_delete_records BOOLEAN DEFAULT TRUE,
  can_add_admins   BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns safely
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='is_super_admin')
    THEN ALTER TABLE admins ADD COLUMN is_super_admin BOOLEAN DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='password_set')
    THEN ALTER TABLE admins ADD COLUMN password_set BOOLEAN DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='role')
    THEN ALTER TABLE admins ADD COLUMN role TEXT DEFAULT 'junior'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='can_delete_records')
    THEN ALTER TABLE admins ADD COLUMN can_delete_records BOOLEAN DEFAULT TRUE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admins' AND column_name='can_add_admins')
    THEN ALTER TABLE admins ADD COLUMN can_add_admins BOOLEAN DEFAULT FALSE; END IF;
END $$;

-- THE SUPER ADMIN FIX:
-- Delete any corrupt/duplicate rows for admin@system.com, then re-insert clean.
-- is_super_admin = TRUE is the ONLY field that controls super admin access.
-- The app reads: const isSuperAdmin = row.is_super_admin === true  (db.ts / store.ts)
DELETE FROM admins WHERE LOWER(email) = 'admin@system.com';

INSERT INTO admins (
  id, email, password, password_set,
  is_super_admin, role,
  can_delete_records, can_add_admins
) VALUES (
  'admin-super',
  'admin@system.com',
  'admin1',
  TRUE,
  TRUE,         -- ← THIS is what makes them Super Admin
  'junior',     -- role column is irrelevant for supers; isSuperAdmin flag is used instead
  TRUE,
  TRUE
);


-- ==============================================================
-- SECTION 4: SETTINGS TABLE — enforce single row, integer id
-- ==============================================================

-- The app always upserts with { id: 1 } — id must be INTEGER
CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  footer_text TEXT    DEFAULT 'Designed by workshop inventory',
  qc_required BOOLEAN DEFAULT FALSE,
  nav_logo    TEXT,
  home_logo   TEXT
);

-- Add missing columns safely
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='footer_text')
    THEN ALTER TABLE settings ADD COLUMN footer_text TEXT DEFAULT 'Designed by workshop inventory'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='qc_required')
    THEN ALTER TABLE settings ADD COLUMN qc_required BOOLEAN DEFAULT FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='nav_logo')
    THEN ALTER TABLE settings ADD COLUMN nav_logo TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='home_logo')
    THEN ALTER TABLE settings ADD COLUMN home_logo TEXT; END IF;
END $$;

-- Remove any extra rows, keep only id = 1
DELETE FROM settings WHERE id <> 1;

-- Ensure the canonical row exists
INSERT INTO settings (id, footer_text, qc_required)
VALUES (1, 'Designed by workshop inventory', FALSE)
ON CONFLICT (id) DO NOTHING;


-- ==============================================================
-- SECTION 5: CHECKLIST_TEMPLATES TABLE
-- ==============================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  equipment_type_id TEXT NOT NULL,
  section_id        TEXT NOT NULL,
  items             JSONB DEFAULT '[]'::jsonb,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_templates' AND column_name='items')
    THEN ALTER TABLE checklist_templates ADD COLUMN items JSONB DEFAULT '[]'::jsonb; END IF;
END $$;

-- Unique constraint per equipment+section pair
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_templates_unique_pair'
  ) THEN
    ALTER TABLE checklist_templates
      ADD CONSTRAINT checklist_templates_unique_pair
      UNIQUE (equipment_type_id, section_id);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'checklist_templates_unique_pair constraint skipped: %', SQLERRM;
END $$;


-- ==============================================================
-- SECTION 6: DISABLE ROW LEVEL SECURITY ON ALL TABLES
-- ==============================================================
-- CRITICAL: RLS enabled with no policies = anon key gets 0 rows silently.
-- This is the most common cause of empty data after connecting to Supabase.
-- The app uses the publishable (anon) key for all operations.

ALTER TABLE records             DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins              DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings            DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;


-- ==============================================================
-- SECTION 7: REPLICA IDENTITY FULL — required for DELETE realtime
-- ==============================================================
-- Without FULL, DELETE events fire but payload.old = {} (empty).
-- The app reads: (payload.old as { id: string }).id
-- If payload.old is empty, id = undefined and record is never removed from UI.

ALTER TABLE records       REPLICA IDENTITY FULL;
ALTER TABLE activity_logs REPLICA IDENTITY FULL;


-- ==============================================================
-- SECTION 8: ADD TABLES TO REALTIME PUBLICATION
-- ==============================================================
-- CRITICAL: If tables are not in the publication, postgres_changes
-- events NEVER fire. The channel shows SUBSCRIBED but receives nothing.
-- The frontend polls every 15 seconds as a fallback, but realtime
-- is needed for instant cross-device updates.

DO $$
BEGIN
  -- Add records table to realtime publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE records;
    RAISE NOTICE 'records added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'records already in supabase_realtime publication';
  END IF;
END $$;

DO $$
BEGIN
  -- Add activity_logs table to realtime publication
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
    RAISE NOTICE 'activity_logs added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'activity_logs already in supabase_realtime publication';
  END IF;
END $$;


-- ==============================================================
-- SECTION 9: AUTO-LOG TRIGGER ON records INSERT
-- ==============================================================
-- When a checklist is submitted, this trigger automatically creates
-- an activity log entry. Matches the exact format used in store.ts:
--   "Checklist submitted by [technician]"
--
-- DEDUP GUARD: The frontend also calls syncInsertLog().
-- The trigger checks: if a log with same type+description+actor
-- already exists within the last 5 seconds, it SKIPS insertion.
-- This prevents double-log entries from trigger + frontend.

CREATE OR REPLACE FUNCTION fn_log_record_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_desc TEXT;
  v_already_exists BOOLEAN;
BEGIN
  -- Build description matching store.ts addRecord log format exactly
  v_desc := 'Checklist submitted by ' || COALESCE(NEW.technician, 'Unknown');

  -- Dedup guard: skip if identical log already exists within 5 seconds
  SELECT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'submission'
      AND description = v_desc
      AND COALESCE(actor, '') = COALESCE(NEW.technician, '')
      AND created_at  > NOW() - INTERVAL '5 seconds'
  ) INTO v_already_exists;

  IF NOT v_already_exists THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid()::text,
      'submission',
      v_desc,
      NEW.technician,
      'submissions',
      NOW()
    );
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Never block the record insert due to logging failure
  RAISE WARNING 'fn_log_record_insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Drop and recreate trigger (idempotent)
DROP TRIGGER IF EXISTS trg_log_record_insert ON records;

CREATE TRIGGER trg_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW
  EXECUTE FUNCTION fn_log_record_insert();


-- ==============================================================
-- SECTION 10: AUTO-LOG TRIGGER ON records DELETE
-- ==============================================================

CREATE OR REPLACE FUNCTION fn_log_record_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_desc TEXT;
  v_already_exists BOOLEAN;
BEGIN
  v_desc := 'Record deleted: ' || COALESCE(OLD.ref_id, OLD.id);

  SELECT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'record_deleted'
      AND description = v_desc
      AND created_at  > NOW() - INTERVAL '5 seconds'
  ) INTO v_already_exists;

  IF NOT v_already_exists THEN
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
-- SECTION 11: VERIFICATION QUERIES
-- ==============================================================
-- After running the script, inspect these results in the SQL editor.

-- 11A: Super admin — must show is_super_admin = true, password = admin1
SELECT id, email, password, password_set, is_super_admin, role
FROM admins
WHERE LOWER(email) = 'admin@system.com';

-- 11B: Realtime publication — must show 2 rows (records + activity_logs)
SELECT pubname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('records', 'activity_logs')
ORDER BY tablename;

-- 11C: Replica identity — must show relreplident = 'f' (FULL) for both tables
SELECT relname, relreplident
FROM pg_class
WHERE relname IN ('records', 'activity_logs')
ORDER BY relname;

-- 11D: Triggers — must show 2 rows
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN ('trg_log_record_insert', 'trg_log_record_delete')
ORDER BY trigger_name;

-- 11E: RLS — must show rowsecurity = false for all tables
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN ('records','activity_logs','admins','settings','checklist_templates')
ORDER BY relname;

-- 11F: Exact columns in activity_logs (confirm no event_type or color columns)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'activity_logs'
ORDER BY ordinal_position;

-- 11G: Exact columns in records (confirm submitted_at exists)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'records'
ORDER BY ordinal_position;

-- 11H: Settings row — must show exactly 1 row with id = 1
SELECT id, footer_text, qc_required
FROM settings;

-- 11I: Dedup index on activity_logs
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'activity_logs'
  AND indexname = 'activity_logs_dedup_safe';
