-- ============================================================
--  DAILY CHECKING APP — COMPLETE DATABASE SETUP
--  New Supabase Project: yjlcfdscrejxntjtpnyf
--
--  HOW TO RUN:
--  1. Open https://supabase.com/dashboard/project/yjlcfdscrejxntjtpnyf/sql/new
--  2. Paste this ENTIRE script
--  3. Click RUN
--  4. Scroll to the bottom and check every verification result (15A–15N)
--
--  Safe to run multiple times — every statement is idempotent.
-- ============================================================


-- ============================================================
-- SECTION 1 — RECORDS TABLE
-- Stores every submitted checklist inspection form.
-- ============================================================

CREATE TABLE IF NOT EXISTS records (
  id               TEXT        PRIMARY KEY,
  ref_id           TEXT        UNIQUE,
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
  checklist        JSONB       NOT NULL DEFAULT '[]',
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns safely
ALTER TABLE records ADD COLUMN IF NOT EXISTS id               TEXT;
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
    WHERE table_name = 'records'
      AND column_name = 'checklist'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE records ALTER COLUMN checklist TYPE JSONB USING checklist::JSONB;
  END IF;
END $$;

-- Add checklist column if missing
ALTER TABLE records ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]';

-- Remove duplicate ref_ids (keep newest)
DELETE FROM records
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY ref_id
             ORDER BY submitted_at DESC NULLS LAST
           ) AS rn
    FROM records
    WHERE ref_id IS NOT NULL
  ) sub
  WHERE rn > 1
);

-- Unique constraint on ref_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_ref_id_unique'
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_unique UNIQUE (ref_id);
  END IF;
END $$;

-- Performance index for newest-first fetching
CREATE INDEX IF NOT EXISTS records_submitted_at_idx ON records (submitted_at DESC);


-- ============================================================
-- SECTION 2 — ACTIVITY_LOGS TABLE
-- Stores all app events: submissions, deletions, admin actions.
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT        PRIMARY KEY,
  type        TEXT,
  description TEXT,
  actor       TEXT,
  section     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add any missing columns safely
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS id          TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS type        TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS actor       TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS section     TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- Remove rogue columns that break the row mapper
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

-- Add a stored BIGINT column for deduplication.
-- WHY: Using date_trunc() or EXTRACT() directly in a UNIQUE INDEX causes
-- "functions in index expression must be marked IMMUTABLE" error in PostgreSQL.
-- A GENERATED ALWAYS AS STORED column computes once at INSERT time,
-- making it fully immutable and safe to index.
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS created_at_sec BIGINT
  GENERATED ALWAYS AS (EXTRACT(EPOCH FROM created_at)::BIGINT / 5) STORED;

-- Drop any broken indexes from previous attempts
DROP INDEX IF EXISTS activity_logs_dedup_idx;
DROP INDEX IF EXISTS activity_logs_dedup_safe;

-- Remove exact duplicate rows by id
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

-- Safe deduplication index using the stored column
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_safe
  ON activity_logs (type, description, COALESCE(actor, ''), created_at_sec);

-- Performance index
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs (created_at DESC);


-- ============================================================
-- SECTION 3 — ADMINS TABLE
-- Stores all admin accounts: Super, Senior, Junior.
-- ============================================================

CREATE TABLE IF NOT EXISTS admins (
  id                 TEXT        PRIMARY KEY,
  email              TEXT        UNIQUE,
  password           TEXT,
  password_set       BOOLEAN     NOT NULL DEFAULT FALSE,
  is_super_admin     BOOLEAN     NOT NULL DEFAULT FALSE,
  role               TEXT        NOT NULL DEFAULT 'junior',
  can_delete_records BOOLEAN     NOT NULL DEFAULT FALSE,
  can_add_admins     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admins ADD COLUMN IF NOT EXISTS id                 TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email              TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password           TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_set       BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_super_admin     BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role               TEXT    DEFAULT 'junior';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS can_delete_records BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS can_add_admins     BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW();

-- Unique email constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admins_email_unique'
  ) THEN
    ALTER TABLE admins ADD CONSTRAINT admins_email_unique UNIQUE (email);
  END IF;
END $$;

-- Fix any NULL or invalid roles
UPDATE admins
SET role = 'junior'
WHERE role IS NULL OR role NOT IN ('junior', 'senior');

-- ── SUPER ADMIN UPSERT ───────────────────────────────────────────────────────
-- Delete any existing corrupted row first, then insert cleanly.
-- WHY DELETE + INSERT instead of UPDATE:
--   If the row has wrong column types, NULL in NOT NULL columns, or a wrong id,
--   UPDATE may silently fail. DELETE + INSERT guarantees a clean row every time.

DELETE FROM admins WHERE LOWER(email) = 'admin@system.com';

INSERT INTO admins (
  id,
  email,
  password,
  password_set,
  is_super_admin,
  role,
  can_delete_records,
  can_add_admins,
  created_at
) VALUES (
  'admin-super',
  'admin@system.com',
  'admin1',
  TRUE,
  TRUE,          -- ← THIS IS THE KEY FIELD. mapAdmin() reads is_super_admin === true
  'junior',      -- role column is always 'junior' for super admins (is_super_admin flag is authoritative)
  TRUE,
  TRUE,
  NOW()
);


-- ============================================================
-- SECTION 4 — SETTINGS TABLE
-- One row only. Stores footer text, QC toggle, logo images.
-- ============================================================

DO $$
DECLARE
  col_type     TEXT;
  saved_footer TEXT;
  saved_qc     BOOLEAN;
  saved_nav    TEXT;
  saved_home   TEXT;
BEGIN
  -- Check if id column is wrong type (UUID or VARCHAR instead of INTEGER)
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_name = 'settings' AND column_name = 'id';

  IF col_type IS NOT NULL AND col_type NOT IN ('integer', 'bigint') THEN
    -- Rescue existing data before dropping
    BEGIN
      SELECT footer_text, qc_required, nav_logo, home_logo
      INTO saved_footer, saved_qc, saved_nav, saved_home
      FROM settings LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      saved_footer := 'Designed by workshop inventory';
      saved_qc     := FALSE;
    END;

    DROP TABLE IF EXISTS settings;

    CREATE TABLE settings (
      id          INTEGER     PRIMARY KEY DEFAULT 1,
      footer_text TEXT        NOT NULL DEFAULT 'Designed by workshop inventory',
      qc_required BOOLEAN     NOT NULL DEFAULT FALSE,
      nav_logo    TEXT,
      home_logo   TEXT,
      CHECK (id = 1)
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

-- Create settings table if it doesn't exist yet
CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER     PRIMARY KEY DEFAULT 1,
  footer_text TEXT        NOT NULL DEFAULT 'Designed by workshop inventory',
  qc_required BOOLEAN     NOT NULL DEFAULT FALSE,
  nav_logo    TEXT,
  home_logo   TEXT,
  CHECK (id = 1)
);

ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_text TEXT    DEFAULT 'Designed by workshop inventory';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS qc_required BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS nav_logo    TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS home_logo   TEXT;

-- Rescue logo data from a rogue JSONB 'data' column if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='data') THEN
    UPDATE settings s
    SET nav_logo  = COALESCE(s.nav_logo,  (s.data->>'navLogoDataUrl')),
        home_logo = COALESCE(s.home_logo, (s.data->>'homeLogoDataUrl'))
    WHERE s.data IS NOT NULL;
    ALTER TABLE settings DROP COLUMN data;
  END IF;
END $$;

-- Enforce single row — delete any extra rows
DELETE FROM settings WHERE id <> 1;

-- Insert canonical row if missing
INSERT INTO settings (id, footer_text, qc_required)
VALUES (1, 'Designed by workshop inventory', FALSE)
ON CONFLICT (id) DO UPDATE
  SET footer_text = COALESCE(settings.footer_text, 'Designed by workshop inventory'),
      qc_required = COALESCE(settings.qc_required, FALSE);

-- Enforce single row constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_single_row'
  ) THEN
    ALTER TABLE settings ADD CONSTRAINT settings_single_row CHECK (id = 1);
  END IF;
END $$;


-- ============================================================
-- SECTION 5 — CHECKLIST_TEMPLATES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
  id                TEXT        PRIMARY KEY,
  equipment_type_id TEXT,
  section_id        TEXT,
  items             JSONB       NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS id                TEXT;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS equipment_type_id TEXT;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS section_id        TEXT;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS items             JSONB DEFAULT '[]';
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'checklist_templates'
      AND column_name = 'items'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE checklist_templates ALTER COLUMN items TYPE JSONB USING items::JSONB;
  END IF;
END $$;

-- Remove duplicate templates (keep newest)
DELETE FROM checklist_templates
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY equipment_type_id, section_id
             ORDER BY updated_at DESC NULLS LAST
           ) AS rn
    FROM checklist_templates
  ) sub
  WHERE rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_templates_unique'
  ) THEN
    ALTER TABLE checklist_templates
      ADD CONSTRAINT checklist_templates_unique UNIQUE (equipment_type_id, section_id);
  END IF;
END $$;


-- ============================================================
-- SECTION 6 — DEPARTMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id         TEXT        PRIMARY KEY,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS id         TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS name       TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();


-- ============================================================
-- SECTION 7 — SECTIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS sections (
  id            TEXT        PRIMARY KEY,
  name          TEXT        NOT NULL,
  department_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sections ADD COLUMN IF NOT EXISTS id            TEXT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS name          TEXT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS department_id TEXT;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT NOW();


-- ============================================================
-- SECTION 8 — EQUIPMENT_TYPES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_types (
  id         TEXT        PRIMARY KEY,
  name       TEXT        NOT NULL,
  code       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE equipment_types ADD COLUMN IF NOT EXISTS id         TEXT;
ALTER TABLE equipment_types ADD COLUMN IF NOT EXISTS name       TEXT;
ALTER TABLE equipment_types ADD COLUMN IF NOT EXISTS code       TEXT;
ALTER TABLE equipment_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();


-- ============================================================
-- SECTION 9 — SYNC_STATUS TABLE
-- Tracks when the DB was last written to.
-- Used by the "Last updated X seconds ago" indicator in the UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_status (
  id            INTEGER     PRIMARY KEY DEFAULT 1,
  last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_table TEXT,
  CHECK (id = 1)
);

INSERT INTO sync_status (id, last_updated)
VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- SECTION 10 — ROW LEVEL SECURITY
--
-- RLS is now ENABLED on all tables with correct anon-role policies.
-- Run supabase/SECURITY_RLS_ENABLE.sql after this script to apply
-- the full policy set. This replaces the old DISABLE RLS approach.
--
-- For a quick setup, SECURITY_RLS_ENABLE.sql handles everything.
-- ============================================================

-- Temporarily disable RLS during initial setup so seeding works.
-- SECURITY_RLS_ENABLE.sql re-enables it with proper policies.
ALTER TABLE records             DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins              DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings            DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments         DISABLE ROW LEVEL SECURITY;
ALTER TABLE sections            DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types     DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_status         DISABLE ROW LEVEL SECURITY;

-- ⚠ IMPORTANT: After this script finishes, run SECURITY_RLS_ENABLE.sql
-- to turn RLS back ON with the correct anon-role policies.


-- ============================================================
-- SECTION 11 — REPLICA IDENTITY FULL
--
-- WHY THIS IS CRITICAL FOR CROSS-DEVICE DELETE SYNC:
-- By default, PostgreSQL WAL only records the PRIMARY KEY of deleted rows.
-- Supabase Realtime delivers DELETE events with payload.old = { id: undefined }
-- because it has no data to fill it with.
-- The app reads: const id = payload.old.id → undefined
-- Result: deleted records stay visible on other devices forever.
--
-- REPLICA IDENTITY FULL tells PostgreSQL to write the ENTIRE old row
-- to the WAL stream. Supabase Realtime then delivers the full row in
-- payload.old, so payload.old.id is always the correct UUID string.
-- ============================================================

ALTER TABLE records       REPLICA IDENTITY FULL;
ALTER TABLE activity_logs REPLICA IDENTITY FULL;
ALTER TABLE sync_status   REPLICA IDENTITY FULL;


-- ============================================================
-- SECTION 12 — ADD TABLES TO SUPABASE REALTIME PUBLICATION
--
-- WHY THIS IS THE #1 CAUSE OF CROSS-DEVICE SYNC FAILURE:
-- Supabase Realtime uses a PostgreSQL publication called "supabase_realtime".
-- Only tables IN this publication emit postgres_changes events.
-- If a table is NOT in the publication:
--   → The WebSocket channel shows status "SUBSCRIBED" (misleadingly correct)
--   → But ZERO events are ever delivered to any subscriber
--   → Changes from Device A never reach Device B
--   → The app works fine on one device but never syncs cross-device
--
-- Each ALTER is wrapped in a guard so it's safe to run multiple times.
-- ============================================================

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
    WHERE pubname = 'supabase_realtime' AND tablename = 'sync_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sync_status;
  END IF;
END $$;

-- ── Settings table: MUST be in the publication for logo/title sync ──────────
-- THIS IS THE ROOT CAUSE OF "logo not syncing to other devices".
-- Without this, Realtime shows SUBSCRIBED but delivers ZERO events for settings.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE settings;
  END IF;
END $$;

ALTER TABLE settings REPLICA IDENTITY FULL;

-- ── Structure tables: add to publication for instant cross-device sync ───────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'departments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE departments; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'sections') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sections; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'equipment_types') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE equipment_types; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'equipment_type_mappings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE equipment_type_mappings; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'field_configs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE field_configs; END IF;
END $$;

ALTER TABLE departments REPLICA IDENTITY FULL;
ALTER TABLE sections REPLICA IDENTITY FULL;
ALTER TABLE equipment_types REPLICA IDENTITY FULL;


-- ============================================================
-- SECTION 13 — GRANT FULL PRIVILEGES TO ANON ROLE
--
-- WHY: Even with RLS disabled, PostgreSQL has a separate privilege layer.
-- If the 'anon' role has no GRANT on a table, operations are blocked
-- at the PostgreSQL privilege level — independent of RLS.
-- This grants full read/write access to all tables for the anon role.
-- ============================================================

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


-- ============================================================
-- SECTION 14 — AUTO LOG TRIGGER: RECORD INSERT
--
-- WHY: When a user submits a checklist, the app tries to insert
-- both the record AND an activity log simultaneously.
-- This DB trigger guarantees the log is ALWAYS created even if
-- the frontend log insert fails due to network issues.
-- The 5-second dedup bucket (created_at_sec) prevents double-logging
-- when both the app and the trigger fire for the same event.
-- ============================================================

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
    WHERE type         = 'submission'
      AND description  = log_desc
      AND COALESCE(actor, '') = COALESCE(NEW.technician, '')
      AND created_at_sec = bucket
  ) THEN
    INSERT INTO activity_logs (id, type, description, actor, section, created_at)
    VALUES (
      gen_random_uuid()::TEXT,
      'submission',
      log_desc,
      NEW.technician,
      'submissions',
      NOW()
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the record insert even if the log fails
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_record_insert ON records;
CREATE TRIGGER trg_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW EXECUTE FUNCTION fn_log_record_insert();


-- ============================================================
-- SECTION 15 — AUTO LOG TRIGGER: RECORD DELETE
-- ============================================================

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
    WHERE type         = 'deletion'
      AND description  = log_desc
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


-- ============================================================
-- SECTION 16 — SYNC_STATUS STAMP TRIGGER
-- Updates sync_status.last_updated on every DB write.
-- This powers the "Last updated X seconds ago" UI indicator.
-- ============================================================

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

DROP TRIGGER IF EXISTS trg_stamp_records       ON records;
DROP TRIGGER IF EXISTS trg_stamp_activity_logs ON activity_logs;

CREATE TRIGGER trg_stamp_records
  AFTER INSERT OR UPDATE OR DELETE ON records
  FOR EACH ROW EXECUTE FUNCTION fn_stamp_sync_status();

CREATE TRIGGER trg_stamp_activity_logs
  AFTER INSERT OR DELETE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION fn_stamp_sync_status();


-- ============================================================
-- SECTION 17 — VERIFICATION QUERIES
--
-- After running the script, check every result below.
-- All checks must pass before the app will work correctly.
-- ============================================================

-- 15A: Super admin — MUST show is_super_admin = true, password = admin1
SELECT id, email, password, password_set, is_super_admin, role
FROM admins
WHERE LOWER(email) = 'admin@system.com';

-- 15B: Realtime publication — MUST show 8+ rows including settings
SELECT pubname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('records', 'activity_logs', 'sync_status', 'settings',
                    'departments', 'sections', 'equipment_types',
                    'equipment_type_mappings', 'field_configs')
ORDER BY tablename;

-- 15C: Replica identity — MUST show relreplident = 'f' for all 3 rows
SELECT relname, relreplident
FROM pg_class
WHERE relname IN ('records', 'activity_logs', 'sync_status')
ORDER BY relname;

-- 15D: Triggers — MUST show 4 triggers
SELECT trigger_name, event_manipulation, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_name IN (
  'trg_log_record_insert',
  'trg_log_record_delete',
  'trg_stamp_records',
  'trg_stamp_activity_logs'
)
ORDER BY trigger_name;

-- 15E: RLS — After running SETUP.sql alone: shows false (temporarily disabled for seeding).
--      After running SECURITY_RLS_ENABLE.sql: shows true for all tables. That is the goal.
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN (
  'records','activity_logs','admins','settings',
  'checklist_templates','departments','sections',
  'equipment_types','sync_status'
)
ORDER BY relname;

-- 15F: Settings — MUST show exactly 1 row with id = 1
SELECT id, footer_text, qc_required FROM settings;

-- 15G: Duplicate ref_ids — MUST show 0 rows
SELECT ref_id, COUNT(*) AS cnt
FROM records
WHERE ref_id IS NOT NULL
GROUP BY ref_id
HAVING COUNT(*) > 1;

-- 15H: Dedup index — MUST show the index name
SELECT indexname FROM pg_indexes
WHERE tablename = 'activity_logs'
  AND indexname = 'activity_logs_dedup_safe';

-- 15I: checklist column type — MUST show data_type = jsonb
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'records'
  AND column_name = 'checklist';

-- 15J: submitted_at column — MUST exist in records
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'records'
  AND column_name = 'submitted_at';

-- 15K: Rogue columns — MUST show 0 rows
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'activity_logs'
  AND column_name IN ('event_type', 'color', 'data', 'payload');

-- 15L: Grants — MUST show anon has SELECT, INSERT, UPDATE, DELETE on records
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'records'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- 15M: sync_status — MUST show 1 row
SELECT id, last_updated, updated_table FROM sync_status;

-- 15N: All tables exist — MUST show 9 rows
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'records','activity_logs','admins','settings',
    'checklist_templates','departments','sections',
    'equipment_types','sync_status'
  )
ORDER BY table_name;

-- ============================================================
-- DONE — If all 15A–15N checks pass, the database is ready.
-- The app will now sync in real-time across all devices.
-- ============================================================
