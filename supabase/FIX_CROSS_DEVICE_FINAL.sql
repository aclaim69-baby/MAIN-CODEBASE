-- ================================================================
--  DAILY CHECKING APP — FINAL CROSS-DEVICE SYNC FIX
--  Paste this entire script into Supabase SQL Editor and Run.
--  Safe to run multiple times — all statements are idempotent.
-- ================================================================


-- ================================================================
-- SECTION 1 — RECORDS TABLE
-- Ensure all columns exist with correct types
-- ================================================================

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
  checklist        JSONB DEFAULT '[]',
  submitted_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE records ADD COLUMN IF NOT EXISTS ref_id           TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS department       TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS section          TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS equipment_type   TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS equipment_code   TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS equipment_number TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS date             TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS start_time       TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS completion_time  TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS hour_meter       TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS technician       TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS supervisor       TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS qc_verifier      TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS submitted_at     TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE records ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE records ADD COLUMN IF NOT EXISTS checklist        JSONB DEFAULT '[]';

-- Fix checklist column type if it was created as TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'records'
      AND column_name = 'checklist'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE records ALTER COLUMN checklist TYPE JSONB USING checklist::JSONB;
  END IF;
END $$;

-- Add unique constraint on ref_id to prevent duplicate submissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_ref_id_unique'
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_unique UNIQUE (ref_id);
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Index for fast DESC fetch (matches fetchRemoteRecords ORDER BY)
CREATE INDEX IF NOT EXISTS records_submitted_at_idx
  ON records (submitted_at DESC NULLS LAST);


-- ================================================================
-- SECTION 2 — ACTIVITY_LOGS TABLE
-- Exact columns: id, type, description, actor, section, created_at
-- ================================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  type        TEXT,
  description TEXT,
  actor       TEXT,
  section     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS type        TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS actor       TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS section     TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- Drop rogue columns that break the row mapper
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='event_type') THEN
    ALTER TABLE activity_logs DROP COLUMN event_type;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='color') THEN
    ALTER TABLE activity_logs DROP COLUMN color;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='data') THEN
    ALTER TABLE activity_logs DROP COLUMN data;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='activity_logs' AND column_name='payload') THEN
    ALTER TABLE activity_logs DROP COLUMN payload;
  END IF;
END $$;

-- Add stored column for dedup (avoids immutable function error in indexes)
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS created_at_sec BIGINT
  GENERATED ALWAYS AS (EXTRACT(EPOCH FROM created_at)::BIGINT / 5) STORED;

-- Remove any broken indexes first
DROP INDEX IF EXISTS activity_logs_dedup_idx;
DROP INDEX IF EXISTS activity_logs_dedup_safe;
DROP INDEX IF EXISTS activity_logs_dedup_final;

-- Remove exact duplicate log rows (same id)
DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid) FROM activity_logs GROUP BY id
);

-- Remove near-duplicate rows (same content within 5 seconds)
DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM activity_logs
  GROUP BY type, description, COALESCE(actor, ''), created_at_sec
);

-- Safe dedup index using stored column (no immutable function error)
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_final
  ON activity_logs (type, description, COALESCE(actor, ''), created_at_sec);

CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx
  ON activity_logs (created_at DESC NULLS LAST);


-- ================================================================
-- SECTION 3 — ADMINS TABLE
-- Fix super admin — is_super_admin MUST be TRUE
-- ================================================================

CREATE TABLE IF NOT EXISTS admins (
  id                 TEXT PRIMARY KEY,
  email              TEXT UNIQUE,
  password           TEXT,
  password_set       BOOLEAN DEFAULT FALSE,
  is_super_admin     BOOLEAN DEFAULT FALSE,
  role               TEXT DEFAULT 'junior',
  can_delete_records BOOLEAN DEFAULT FALSE,
  can_add_admins     BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_set       BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_super_admin     BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role               TEXT DEFAULT 'junior';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS can_delete_records BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS can_add_admins     BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW();

-- Fix NULL roles
UPDATE admins SET role = 'junior'
WHERE role IS NULL OR role NOT IN ('junior', 'senior');

-- Delete and reinsert super admin with guaranteed correct values
DELETE FROM admins WHERE LOWER(email) = 'admin@system.com';
INSERT INTO admins (
  id, email, password, password_set, is_super_admin,
  role, can_delete_records, can_add_admins, created_at
) VALUES (
  'admin-super', 'admin@system.com', 'admin1',
  TRUE, TRUE, 'junior', TRUE, TRUE, NOW()
);


-- ================================================================
-- SECTION 4 — SETTINGS TABLE
-- id must be INTEGER = 1, exactly one row
-- ================================================================

DO $$
DECLARE
  col_type     TEXT;
  saved_footer TEXT;
  saved_qc     BOOLEAN;
  saved_nav    TEXT;
  saved_home   TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'settings' AND column_name = 'id';

  IF col_type IS NOT NULL AND col_type NOT IN ('integer','bigint') THEN
    BEGIN
      SELECT footer_text, qc_required, nav_logo, home_logo
      INTO saved_footer, saved_qc, saved_nav, saved_home
      FROM settings LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      saved_footer := 'Designed by workshop inventory';
      saved_qc     := FALSE;
    END;
    DROP TABLE IF EXISTS settings CASCADE;
    CREATE TABLE settings (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      footer_text TEXT    DEFAULT 'Designed by workshop inventory',
      qc_required BOOLEAN DEFAULT FALSE,
      nav_logo    TEXT,
      home_logo   TEXT
    );
    INSERT INTO settings (id, footer_text, qc_required, nav_logo, home_logo)
    VALUES (
      1,
      COALESCE(saved_footer, 'Designed by workshop inventory'),
      COALESCE(saved_qc, FALSE),
      saved_nav,
      saved_home
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  footer_text TEXT    DEFAULT 'Designed by workshop inventory',
  qc_required BOOLEAN DEFAULT FALSE,
  nav_logo    TEXT,
  home_logo   TEXT
);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_text TEXT DEFAULT 'Designed by workshop inventory';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS qc_required BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS nav_logo    TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS home_logo   TEXT;

-- Remove rogue data column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='data') THEN
    ALTER TABLE settings DROP COLUMN data;
  END IF;
END $$;

-- Ensure exactly one row with id = 1
DELETE FROM settings WHERE id <> 1;
INSERT INTO settings (id, footer_text, qc_required)
VALUES (1, 'Designed by workshop inventory', FALSE)
ON CONFLICT (id) DO UPDATE
  SET footer_text = COALESCE(settings.footer_text, 'Designed by workshop inventory'),
      qc_required = COALESCE(settings.qc_required, FALSE);


-- ================================================================
-- SECTION 5 — CHECKLIST TEMPLATES TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
  id                TEXT PRIMARY KEY,
  equipment_type_id TEXT,
  section_id        TEXT,
  items             JSONB DEFAULT '[]',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS equipment_type_id TEXT;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS section_id        TEXT;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS items             JSONB DEFAULT '[]';
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();


-- ================================================================
-- SECTION 6 — DEPARTMENTS / SECTIONS / EQUIPMENT_TYPES TABLES
-- ================================================================

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  department_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_status (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  last_updated  TIMESTAMPTZ DEFAULT NOW(),
  updated_table TEXT
);

INSERT INTO sync_status (id, last_updated, updated_table)
VALUES (1, NOW(), 'init')
ON CONFLICT (id) DO NOTHING;


-- ================================================================
-- SECTION 7 — DISABLE ROW LEVEL SECURITY ON ALL TABLES
-- CRITICAL: RLS with no policies returns 0 rows silently
-- This is the #1 cause of "data not loading" and "sync not working"
-- ================================================================

ALTER TABLE records             DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins              DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings            DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments         DISABLE ROW LEVEL SECURITY;
ALTER TABLE sections            DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types     DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_status         DISABLE ROW LEVEL SECURITY;


-- ================================================================
-- SECTION 8 — REPLICA IDENTITY FULL
-- Without this: DELETE events fire but payload.old = {}
-- So payload.old.id = undefined and records stay on other devices
-- ================================================================

ALTER TABLE records       REPLICA IDENTITY FULL;
ALTER TABLE activity_logs REPLICA IDENTITY FULL;
ALTER TABLE sync_status   REPLICA IDENTITY FULL;


-- ================================================================
-- SECTION 9 — ADD TABLES TO REALTIME PUBLICATION
-- #1 reason cross-device sync fails:
-- Tables not in this publication = WebSocket shows SUBSCRIBED
-- but fires ZERO events from other devices
-- ================================================================

DO $$
BEGIN
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

DO $$
BEGIN
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'sync_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sync_status;
    RAISE NOTICE 'Added sync_status to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'sync_status already in supabase_realtime publication';
  END IF;
END $$;


-- ================================================================
-- SECTION 10 — SYNC STATUS TRIGGER
-- Stamps sync_status.last_updated on every write to records/logs
-- The "last updated" indicator in the UI reads from this
-- ================================================================

CREATE OR REPLACE FUNCTION fn_stamp_sync_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sync_status
  SET last_updated  = NOW(),
      updated_table = TG_TABLE_NAME
  WHERE id = 1;
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stamp_records_sync    ON records;
DROP TRIGGER IF EXISTS trg_stamp_logs_sync        ON activity_logs;

CREATE TRIGGER trg_stamp_records_sync
  AFTER INSERT OR UPDATE OR DELETE ON records
  FOR EACH ROW EXECUTE FUNCTION fn_stamp_sync_status();

CREATE TRIGGER trg_stamp_logs_sync
  AFTER INSERT OR DELETE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION fn_stamp_sync_status();


-- ================================================================
-- SECTION 11 — AUTO LOG TRIGGER: RECORD INSERT
-- Creates activity log automatically when a record is submitted
-- 5-second dedup bucket prevents double-logging
-- ================================================================

CREATE OR REPLACE FUNCTION fn_log_record_insert()
RETURNS TRIGGER AS $$
DECLARE
  bucket   BIGINT;
  log_desc TEXT;
BEGIN
  bucket   := EXTRACT(EPOCH FROM NOW())::BIGINT / 5;
  log_desc := 'Checklist submitted by ' || COALESCE(NEW.technician, 'Unknown');

  IF NOT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type             = 'record_submitted'
      AND description      = log_desc
      AND COALESCE(actor,'') = COALESCE(NEW.technician, '')
      AND created_at_sec   = bucket
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid()::TEXT,
      'record_submitted',
      log_desc,
      NEW.technician,
      'submissions',
      NOW()
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_record_insert ON records;
CREATE TRIGGER trg_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW EXECUTE FUNCTION fn_log_record_insert();


-- ================================================================
-- SECTION 12 — AUTO LOG TRIGGER: RECORD DELETE
-- ================================================================

CREATE OR REPLACE FUNCTION fn_log_record_delete()
RETURNS TRIGGER AS $$
DECLARE
  bucket   BIGINT;
  log_desc TEXT;
BEGIN
  bucket   := EXTRACT(EPOCH FROM NOW())::BIGINT / 5;
  log_desc := 'Record deleted: ' || COALESCE(OLD.ref_id, OLD.id);

  IF NOT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type           = 'record_deleted'
      AND description    = log_desc
      AND created_at_sec = bucket
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid()::TEXT,
      'record_deleted',
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


-- ================================================================
-- SECTION 13 — GRANT PERMISSIONS TO ANON ROLE
-- Allows the anon JWT to read/write all tables
-- ================================================================

GRANT ALL ON TABLE records             TO anon;
GRANT ALL ON TABLE activity_logs       TO anon;
GRANT ALL ON TABLE admins              TO anon;
GRANT ALL ON TABLE settings            TO anon;
GRANT ALL ON TABLE checklist_templates TO anon;
GRANT ALL ON TABLE departments         TO anon;
GRANT ALL ON TABLE sections            TO anon;
GRANT ALL ON TABLE equipment_types     TO anon;
GRANT ALL ON TABLE sync_status         TO anon;

GRANT ALL ON TABLE records             TO authenticated;
GRANT ALL ON TABLE activity_logs       TO authenticated;
GRANT ALL ON TABLE admins              TO authenticated;
GRANT ALL ON TABLE settings            TO authenticated;
GRANT ALL ON TABLE checklist_templates TO authenticated;
GRANT ALL ON TABLE departments         TO authenticated;
GRANT ALL ON TABLE sections            TO authenticated;
GRANT ALL ON TABLE equipment_types     TO authenticated;
GRANT ALL ON TABLE sync_status         TO authenticated;

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;


-- ================================================================
-- SECTION 14 — VERIFICATION QUERIES
-- Run these after the script and check every result
-- ================================================================

-- 14A: Super admin — MUST show is_super_admin = true, password = admin1
SELECT id, email, password, password_set, is_super_admin, role
FROM admins
WHERE LOWER(email) = 'admin@system.com';

-- 14B: MUST show 3 rows — records, activity_logs, sync_status in publication
SELECT pubname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('records', 'activity_logs', 'sync_status')
ORDER BY tablename;

-- 14C: MUST show relreplident = 'f' (FULL) for records and activity_logs
SELECT relname, relreplident
FROM pg_class
WHERE relname IN ('records', 'activity_logs', 'sync_status')
ORDER BY relname;

-- 14D: MUST show 4 triggers
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN (
  'trg_log_record_insert',
  'trg_log_record_delete',
  'trg_stamp_records_sync',
  'trg_stamp_logs_sync'
)
ORDER BY trigger_name;

-- 14E: MUST show rowsecurity = false for ALL 9 tables
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN (
  'records','activity_logs','admins','settings',
  'checklist_templates','departments','sections',
  'equipment_types','sync_status'
)
ORDER BY relname;

-- 14F: Settings must have exactly 1 row with id = 1
SELECT id, footer_text, qc_required FROM settings;

-- 14G: Must return 0 rows — no duplicate ref_id values
SELECT ref_id, COUNT(*) AS cnt
FROM records WHERE ref_id IS NOT NULL
GROUP BY ref_id HAVING COUNT(*) > 1;

-- 14H: checklist column must be JSONB
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'records' AND column_name = 'checklist';

-- 14I: submitted_at must exist in records
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'records' AND column_name = 'submitted_at';

-- 14J: Must return 0 rows — no rogue columns in activity_logs
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'activity_logs'
  AND column_name IN ('event_type', 'color', 'data', 'payload');

-- 14K: anon role must have privileges on records table
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'records'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- 14L: Verify sync_status row exists
SELECT id, last_updated, updated_table FROM sync_status;

-- ================================================================
-- DONE — Check results 14A through 14L
-- All must pass for cross-device realtime to work correctly
-- ================================================================
