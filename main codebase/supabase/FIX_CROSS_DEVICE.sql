-- ================================================================
--  DAILY CHECKING — CROSS-DEVICE SYNC FIX
--  Paste this entire script into Supabase SQL Editor → Run
--  Safe to run multiple times — all statements are idempotent
-- ================================================================


-- ================================================================
-- SECTION 1 — records TABLE (ensure all columns exist)
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

-- Convert checklist to JSONB if it was created as TEXT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'records' AND column_name = 'checklist'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE records ALTER COLUMN checklist TYPE JSONB USING checklist::JSONB;
  END IF;
END $$;

ALTER TABLE records ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]';

-- Index for ORDER BY submitted_at DESC
CREATE INDEX IF NOT EXISTS records_submitted_at_idx ON records (submitted_at DESC);

-- Unique constraint on ref_id prevents duplicate submissions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_ref_id_unique') THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_unique UNIQUE (ref_id);
  END IF;
END $$;


-- ================================================================
-- SECTION 2 — activity_logs TABLE (ensure all columns exist)
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

-- created_at_sec: stored BIGINT for safe dedup index (avoids immutable function error)
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS created_at_sec BIGINT
  GENERATED ALWAYS AS (EXTRACT(EPOCH FROM created_at)::BIGINT / 5) STORED;

-- Drop any broken indexes before recreating
DROP INDEX IF EXISTS activity_logs_dedup_idx;
DROP INDEX IF EXISTS activity_logs_dedup_safe;

-- Remove exact duplicate rows (same id inserted twice)
DELETE FROM activity_logs
WHERE ctid NOT IN (SELECT MIN(ctid) FROM activity_logs GROUP BY id);

-- Remove near-duplicate rows (same content within 5-second window)
DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM activity_logs
  GROUP BY type, description, COALESCE(actor, ''), created_at_sec
);

-- Safe dedup index using stored column
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_safe
  ON activity_logs (type, description, COALESCE(actor, ''), created_at_sec);

CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs (created_at DESC);


-- ================================================================
-- SECTION 3 — admins TABLE + Super Admin fix
-- ================================================================

CREATE TABLE IF NOT EXISTS admins (
  id                 TEXT PRIMARY KEY,
  email              TEXT,
  password           TEXT,
  password_set       BOOLEAN DEFAULT FALSE,
  is_super_admin     BOOLEAN DEFAULT FALSE,
  role               TEXT DEFAULT 'junior',
  can_delete_records BOOLEAN DEFAULT FALSE,
  can_add_admins     BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admins ADD COLUMN IF NOT EXISTS email              TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password           TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_set       BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_super_admin     BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role               TEXT DEFAULT 'junior';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS can_delete_records BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS can_add_admins     BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admins_email_unique') THEN
    ALTER TABLE admins ADD CONSTRAINT admins_email_unique UNIQUE (email);
  END IF;
END $$;

-- Fix NULL or invalid roles
UPDATE admins SET role = 'junior'
WHERE role IS NULL OR role NOT IN ('junior', 'senior');

-- Definitive super admin fix: delete corrupt row, insert clean
DELETE FROM admins WHERE LOWER(email) = 'admin@system.com';

INSERT INTO admins (id, email, password, password_set, is_super_admin, role, can_delete_records, can_add_admins, created_at)
VALUES ('admin-super', 'admin@system.com', 'admin1', TRUE, TRUE, 'junior', TRUE, TRUE, NOW());


-- ================================================================
-- SECTION 4 — settings TABLE (must use id = 1 INTEGER)
-- ================================================================

DO $$
DECLARE
  col_type    TEXT;
  sv_footer   TEXT;
  sv_qc       BOOLEAN;
  sv_nav      TEXT;
  sv_home     TEXT;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'settings' AND column_name = 'id';

  IF col_type = 'uuid' OR col_type = 'character varying' OR col_type = 'text' THEN
    BEGIN
      SELECT footer_text, qc_required, nav_logo, home_logo
      INTO sv_footer, sv_qc, sv_nav, sv_home
      FROM settings LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      sv_footer := 'Designed by workshop inventory';
      sv_qc     := FALSE;
    END;
    DROP TABLE IF EXISTS settings;
    CREATE TABLE settings (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      footer_text TEXT    DEFAULT 'Designed by workshop inventory',
      qc_required BOOLEAN DEFAULT FALSE,
      nav_logo    TEXT,
      home_logo   TEXT,
      CHECK (id = 1)
    );
    INSERT INTO settings (id, footer_text, qc_required, nav_logo, home_logo)
    VALUES (1, COALESCE(sv_footer,'Designed by workshop inventory'), COALESCE(sv_qc,FALSE), sv_nav, sv_home);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  footer_text TEXT    DEFAULT 'Designed by workshop inventory',
  qc_required BOOLEAN DEFAULT FALSE,
  nav_logo    TEXT,
  home_logo   TEXT,
  CHECK (id = 1)
);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_text TEXT    DEFAULT 'Designed by workshop inventory';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS qc_required BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS nav_logo    TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS home_logo   TEXT;

DELETE FROM settings WHERE id <> 1;

INSERT INTO settings (id, footer_text, qc_required)
VALUES (1, 'Designed by workshop inventory', FALSE)
ON CONFLICT (id) DO UPDATE
  SET footer_text = COALESCE(settings.footer_text, 'Designed by workshop inventory'),
      qc_required = COALESCE(settings.qc_required, FALSE);


-- ================================================================
-- SECTION 5 — Supporting tables
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
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checklist_templates_unique') THEN
    ALTER TABLE checklist_templates ADD CONSTRAINT checklist_templates_unique UNIQUE (equipment_type_id, section_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY, name TEXT, department_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equipment_types (
  id TEXT PRIMARY KEY, name TEXT, code TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ================================================================
-- SECTION 6 — DISABLE ROW LEVEL SECURITY
-- CRITICAL: RLS with no policies silently returns 0 rows to the anon key.
-- This is the #1 silent cause of empty data.
-- ================================================================

ALTER TABLE records             DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins              DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings            DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments         DISABLE ROW LEVEL SECURITY;
ALTER TABLE sections            DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types     DISABLE ROW LEVEL SECURITY;


-- ================================================================
-- SECTION 7 — REPLICA IDENTITY FULL
-- Required so DELETE realtime events carry payload.old.id.
-- Without this, DELETE fires but payload.old = {} → id = undefined
-- → record is never removed from the UI on receiving devices.
-- ================================================================

ALTER TABLE records       REPLICA IDENTITY FULL;
ALTER TABLE activity_logs REPLICA IDENTITY FULL;


-- ================================================================
-- SECTION 8 — REALTIME PUBLICATION
-- CRITICAL: Tables must be in supabase_realtime for WebSocket events to fire.
-- If not added here, the channel shows SUBSCRIBED but receives ZERO events.
-- ================================================================

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


-- ================================================================
-- SECTION 9 — AUTO LOG TRIGGER (INSERT)
-- When a record is inserted, auto-create an activity log.
-- 5-second dedup bucket prevents double-logging when both the
-- frontend call and this trigger fire simultaneously.
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
    WHERE type = 'record_submitted'
      AND description = log_desc
      AND COALESCE(actor, '') = COALESCE(NEW.technician, '')
      AND created_at_sec = bucket
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (gen_random_uuid()::TEXT, 'record_submitted', log_desc, NEW.technician, 'submissions', NOW());
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- never block the record insert
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_record_insert ON records;
CREATE TRIGGER trg_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW EXECUTE FUNCTION fn_log_record_insert();


-- ================================================================
-- SECTION 10 — AUTO LOG TRIGGER (DELETE)
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
    WHERE type = 'record_deleted'
      AND description = log_desc
      AND created_at_sec = bucket
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (gen_random_uuid()::TEXT, 'record_deleted', log_desc, NULL, 'deletions', NOW());
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
-- SECTION 11 — VERIFICATION
-- Run after the script — every check must pass
-- ================================================================

-- 11A: Super admin — must show is_super_admin = true, password = admin1
SELECT id, email, password, password_set, is_super_admin, role
FROM admins WHERE LOWER(email) = 'admin@system.com';

-- 11B: Must show 2 rows — records + activity_logs in realtime publication
SELECT pubname, tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('records', 'activity_logs');

-- 11C: Must show relreplident = 'f' (FULL) for both tables
SELECT relname, relreplident FROM pg_class
WHERE relname IN ('records', 'activity_logs');

-- 11D: Must show 2 triggers
SELECT trigger_name, event_object_table FROM information_schema.triggers
WHERE trigger_name IN ('trg_log_record_insert', 'trg_log_record_delete');

-- 11E: Must show rls_enabled = false for all 8 tables
SELECT relname, relrowsecurity AS rls_enabled FROM pg_class
WHERE relname IN (
  'records','activity_logs','admins','settings',
  'checklist_templates','departments','sections','equipment_types'
);

-- 11F: Exactly 1 settings row with id = 1
SELECT id, footer_text, qc_required FROM settings;

-- 11G: Zero duplicate ref_ids
SELECT ref_id, COUNT(*) FROM records
WHERE ref_id IS NOT NULL GROUP BY ref_id HAVING COUNT(*) > 1;

-- 11H: checklist column must be JSONB
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'records' AND column_name = 'checklist';

-- 11I: submitted_at must exist
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'records' AND column_name = 'submitted_at';

-- 11J: No rogue columns in activity_logs
SELECT column_name FROM information_schema.columns
WHERE table_name = 'activity_logs'
  AND column_name IN ('event_type', 'color', 'data', 'payload');

-- 11K: Dedup index must exist
SELECT indexname FROM pg_indexes
WHERE tablename = 'activity_logs' AND indexname = 'activity_logs_dedup_safe';

-- ================================================================
-- DONE — check results 11A through 11K
-- ================================================================
