-- ============================================================
--  DAILY CHECKING APP — REALTIME + HARDENING SQL
--  Supabase SQL Editor → paste entire file → Run
--
--  Safe to run multiple times (idempotent).
--  Does NOT drop tables. Does NOT delete valid data.
--  Column names match src/lib/db.ts exactly.
-- ============================================================


-- ==============================================================
-- SECTION 1 — RECORDS TABLE
-- Exact columns from RecordRow interface in src/lib/db.ts
-- ==============================================================

-- 1A. Ensure table exists with every required column
CREATE TABLE IF NOT EXISTS records (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  ref_id              TEXT        NOT NULL,
  department_id       TEXT        NOT NULL DEFAULT '',
  department_name     TEXT        NOT NULL DEFAULT '',
  section_id          TEXT        NOT NULL DEFAULT '',
  section_name        TEXT        NOT NULL DEFAULT '',
  equipment_type_id   TEXT        NOT NULL DEFAULT '',
  equipment_type_name TEXT        NOT NULL DEFAULT '',
  equipment_type_code TEXT        NOT NULL DEFAULT '',
  equipment_number    TEXT        NOT NULL DEFAULT '',
  date                TEXT        NOT NULL DEFAULT '',
  start_time          TEXT        NOT NULL DEFAULT '',
  completion_time     TEXT        NOT NULL DEFAULT '',
  hour_meter          TEXT        NOT NULL DEFAULT '',
  technician          TEXT        NOT NULL DEFAULT '',
  supervisor          TEXT        NOT NULL DEFAULT '',
  qc_verifier         TEXT                 DEFAULT '',
  checklist           JSONB                DEFAULT '[]'::JSONB,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1B. Add any missing columns to existing table (safe, skipped if already present)
ALTER TABLE records ADD COLUMN IF NOT EXISTS ref_id              TEXT        NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS department_id       TEXT        NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS department_name     TEXT        NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS section_id          TEXT        NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS section_name        TEXT        NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS equipment_type_id   TEXT        NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS equipment_type_name TEXT        NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS equipment_type_code TEXT        NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS equipment_number    TEXT                 DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS date                TEXT                 DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS start_time          TEXT                 DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS completion_time     TEXT                 DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS hour_meter          TEXT                 DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS technician          TEXT                 DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS supervisor          TEXT                 DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS qc_verifier         TEXT                 DEFAULT '';
ALTER TABLE records ADD COLUMN IF NOT EXISTS checklist           JSONB                DEFAULT '[]'::JSONB;
ALTER TABLE records ADD COLUMN IF NOT EXISTS submitted_at        TIMESTAMPTZ          DEFAULT NOW();

-- 1C. Ensure checklist column is JSONB (not TEXT)
--     Safe: only runs if the column is currently TEXT
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

-- 1D. Add UNIQUE constraint on ref_id (prevents duplicate submissions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'records_ref_id_key'
      AND conrelid = 'records'::REGCLASS
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_key UNIQUE (ref_id);
  END IF;
END $$;

-- 1E. Index on submitted_at for fast ordering (fetchRecords orders by this)
CREATE INDEX IF NOT EXISTS records_submitted_at_idx ON records (submitted_at DESC);


-- ==============================================================
-- SECTION 2 — ACTIVITY_LOGS TABLE
-- Exact columns from LogRow interface in src/lib/db.ts
-- ==============================================================

-- 2A. Ensure table exists
CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  section     TEXT        NOT NULL DEFAULT 'submissions',
  type        TEXT        NOT NULL DEFAULT 'record_submitted',
  description TEXT        NOT NULL DEFAULT '',
  actor       TEXT                 DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2B. Add any missing columns to existing table
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS section     TEXT DEFAULT 'submissions';
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS type        TEXT DEFAULT 'record_submitted';
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS actor       TEXT DEFAULT NULL;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- 2C. Index on created_at for fast ordering (fetchLogs orders by this DESC)
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON activity_logs (created_at DESC);

-- 2D. Remove exact duplicate log rows (same id inserted twice — old double-write bug)
DELETE FROM activity_logs a
USING activity_logs b
WHERE a.ctid > b.ctid
  AND a.id = b.id;

-- 2E. Remove near-duplicate logs (same type + description + actor + same second)
--     Keeps the oldest row per group
DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM activity_logs
  GROUP BY
    type,
    description,
    COALESCE(actor, ''),
    DATE_TRUNC('second', created_at)
);

-- 2F. Unique index to prevent future near-duplicates at DB level
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_idx
  ON activity_logs (
    type,
    description,
    COALESCE(actor, ''),
    DATE_TRUNC('second', created_at)
  );


-- ==============================================================
-- SECTION 3 — ADMINS TABLE
-- Exact columns from AdminRow interface in src/lib/db.ts
-- ==============================================================

-- 3A. Ensure table exists
CREATE TABLE IF NOT EXISTS admins (
  id                 TEXT    PRIMARY KEY,
  email              TEXT    NOT NULL UNIQUE,
  password           TEXT    NOT NULL DEFAULT '',
  password_set       BOOLEAN NOT NULL DEFAULT FALSE,
  is_super_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  role               TEXT    NOT NULL DEFAULT 'junior',
  can_delete_records BOOLEAN NOT NULL DEFAULT TRUE,
  can_add_admins     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 3B. Add any missing columns to existing table
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email              TEXT    NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password           TEXT    NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_set       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_super_admin     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role               TEXT    NOT NULL DEFAULT 'junior';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS can_delete_records BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS can_add_admins     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW();

-- 3C. Add UNIQUE on email if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admins_email_key'
      AND conrelid = 'admins'::REGCLASS
  ) THEN
    ALTER TABLE admins ADD CONSTRAINT admins_email_key UNIQUE (email);
  END IF;
END $$;

-- 3D. Remove duplicate admin rows — keep oldest per email
DELETE FROM admins a
USING admins b
WHERE a.ctid > b.ctid
  AND LOWER(a.email) = LOWER(b.email);

-- 3E. Fix NULL or invalid roles — only 'senior' is elevated, everything else = 'junior'
--     (super admins are identified by is_super_admin = TRUE, not by role)
UPDATE admins
SET role = 'junior'
WHERE role IS NULL
   OR role NOT IN ('junior', 'senior');

-- 3F. UPSERT the super admin row — this is the definitive fix for wrong role on login.
--     id = 'admin-super' matches the hardcoded seed ID in store.ts line 300.
--     is_super_admin = TRUE is what mapAdmin() in db.ts reads to set isSuperAdmin.
--     password = 'admin1' matches the current defaultAdmins seed in store.ts line 302.
INSERT INTO admins (
  id,
  email,
  password,
  password_set,
  is_super_admin,
  role,
  can_delete_records,
  can_add_admins
) VALUES (
  'admin-super',
  'admin@system.com',
  'admin1',
  TRUE,
  TRUE,
  'junior',
  TRUE,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  email              = EXCLUDED.email,
  password           = EXCLUDED.password,
  password_set       = EXCLUDED.password_set,
  is_super_admin     = EXCLUDED.is_super_admin,
  can_delete_records = EXCLUDED.can_delete_records,
  can_add_admins     = EXCLUDED.can_add_admins;
-- NOTE: role is intentionally NOT updated here.
-- The app identifies super admins via is_super_admin = TRUE, not via role.
-- mapAdmin() in src/lib/db.ts line 114: const isSuperAdmin = row.is_super_admin === true;


-- ==============================================================
-- SECTION 4 — SETTINGS TABLE
-- Exact columns from SettingsRow interface in src/lib/db.ts
-- id must be INTEGER (upsertSettings always uses id=1)
-- ==============================================================

-- 4A. Ensure table exists with integer id
CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  footer_text TEXT    NOT NULL DEFAULT 'Designed by workshop inventory',
  qc_required BOOLEAN NOT NULL DEFAULT FALSE,
  nav_logo    TEXT             DEFAULT NULL,
  home_logo   TEXT             DEFAULT NULL
);

-- 4B. Add any missing columns
ALTER TABLE settings ADD COLUMN IF NOT EXISTS footer_text TEXT    DEFAULT 'Designed by workshop inventory';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS qc_required BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS nav_logo    TEXT    DEFAULT NULL;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS home_logo   TEXT    DEFAULT NULL;

-- 4C. Remove any extra rows (only id=1 is valid)
--     Uses COALESCE to preserve nav_logo/home_logo if they exist on a non-1 row
DO $$
DECLARE
  v_nav  TEXT;
  v_home TEXT;
BEGIN
  -- Rescue any logo data from non-canonical rows before deleting
  SELECT nav_logo INTO v_nav  FROM settings WHERE id <> 1 AND nav_logo  IS NOT NULL LIMIT 1;
  SELECT home_logo INTO v_home FROM settings WHERE id <> 1 AND home_logo IS NOT NULL LIMIT 1;

  -- Delete all non-canonical rows
  DELETE FROM settings WHERE id <> 1;

  -- If we rescued logo data and the canonical row has nulls, update it
  IF v_nav IS NOT NULL THEN
    UPDATE settings SET nav_logo  = v_nav  WHERE id = 1 AND nav_logo  IS NULL;
  END IF;
  IF v_home IS NOT NULL THEN
    UPDATE settings SET home_logo = v_home WHERE id = 1 AND home_logo IS NULL;
  END IF;
END $$;

-- 4D. Ensure the canonical settings row exists (id=1)
INSERT INTO settings (id, footer_text, qc_required, nav_logo, home_logo)
VALUES (1, 'Designed by workshop inventory', FALSE, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  footer_text = COALESCE(settings.footer_text, EXCLUDED.footer_text),
  qc_required = COALESCE(settings.qc_required, EXCLUDED.qc_required);
-- NOTE: nav_logo and home_logo are intentionally NOT updated here
-- to preserve any logos already uploaded by the super admin.

-- 4E. Enforce single-row constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settings_single_row'
      AND conrelid = 'settings'::REGCLASS
  ) THEN
    ALTER TABLE settings ADD CONSTRAINT settings_single_row CHECK (id = 1);
  END IF;
END $$;


-- ==============================================================
-- SECTION 5 — CHECKLIST_TEMPLATES TABLE
-- Exact columns from TemplateRow interface in src/lib/db.ts
-- ==============================================================

CREATE TABLE IF NOT EXISTS checklist_templates (
  id                TEXT  PRIMARY KEY,
  equipment_type_id TEXT  NOT NULL DEFAULT '',
  section_id        TEXT  NOT NULL DEFAULT '',
  items             JSONB NOT NULL DEFAULT '[]'::JSONB
);

ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS equipment_type_id TEXT  NOT NULL DEFAULT '';
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS section_id        TEXT  NOT NULL DEFAULT '';
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS items             JSONB NOT NULL DEFAULT '[]'::JSONB;

-- Ensure items is JSONB not TEXT
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

-- Remove duplicate templates (same equipment_type_id + section_id)
DELETE FROM checklist_templates
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM checklist_templates
  GROUP BY equipment_type_id, section_id
);

-- Unique constraint on equipment_type_id + section_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_templates_eq_sec_key'
      AND conrelid = 'checklist_templates'::REGCLASS
  ) THEN
    ALTER TABLE checklist_templates
      ADD CONSTRAINT checklist_templates_eq_sec_key UNIQUE (equipment_type_id, section_id);
  END IF;
END $$;


-- ==============================================================
-- SECTION 6 — DEPARTMENTS TABLE
-- ==============================================================

CREATE TABLE IF NOT EXISTS departments (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT ''
);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';


-- ==============================================================
-- SECTION 7 — SECTIONS TABLE
-- ==============================================================

CREATE TABLE IF NOT EXISTS sections (
  id            TEXT PRIMARY KEY,
  department_id TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL DEFAULT ''
);

ALTER TABLE sections ADD COLUMN IF NOT EXISTS department_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sections ADD COLUMN IF NOT EXISTS name          TEXT NOT NULL DEFAULT '';


-- ==============================================================
-- SECTION 8 — EQUIPMENT_TYPES TABLE
-- ==============================================================

CREATE TABLE IF NOT EXISTS equipment_types (
  id   TEXT PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT ''
);

ALTER TABLE equipment_types ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
ALTER TABLE equipment_types ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';


-- ==============================================================
-- SECTION 9 — ROW LEVEL SECURITY
--
-- The app uses ONLY the publishable (anon) key from the frontend.
-- Supabase enables RLS by default. With no policies, the anon key
-- gets 0 rows silently — no error, just empty data.
--
-- We DISABLE RLS on all tables so the anon key can read/write
-- freely. This is correct for an internal tool.
--
-- If you need RLS in future, add policies BEFORE re-enabling:
--   CREATE POLICY "allow_all" ON records FOR ALL USING (true) WITH CHECK (true);
-- ==============================================================

ALTER TABLE records              DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs        DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins               DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings             DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates  DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments          DISABLE ROW LEVEL SECURITY;
ALTER TABLE sections             DISABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types      DISABLE ROW LEVEL SECURITY;


-- ==============================================================
-- SECTION 10 — REALTIME PUBLICATION (CRITICAL)
--
-- This is what makes submissions appear instantly in the UI
-- without a page refresh.
--
-- The app subscribes in App.tsx using:
--   supabase.channel('daily-checking-realtime')
--     .on('postgres_changes', { event: 'INSERT', table: 'records' }, ...)
--     .on('postgres_changes', { event: 'DELETE', table: 'records' }, ...)
--     .on('postgres_changes', { event: 'UPDATE', table: 'records' }, ...)
--     .on('postgres_changes', { event: 'INSERT', table: 'activity_logs' }, ...)
--     .on('postgres_changes', { event: 'DELETE', table: 'activity_logs' }, ...)
--
-- Both tables MUST be in supabase_realtime publication for
-- postgres_changes events to fire.
-- ==============================================================

-- Add records to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE records;
  END IF;
END $$;

-- Add activity_logs to realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
  END IF;
END $$;


-- ==============================================================
-- SECTION 11 — AUTO-LOG TRIGGER
--
-- When a record is inserted into the records table,
-- automatically insert an entry into activity_logs.
--
-- This is a DATABASE-LEVEL safety net.
-- The app already calls addLog() in store.ts after insertRecord().
-- This trigger ensures logs are created even if the frontend
-- call fails or is skipped.
--
-- The trigger checks for near-duplicates before inserting
-- (same type + description within the same second) to avoid
-- double-logging when both the app AND the trigger fire.
-- ==============================================================

-- Create the trigger function
CREATE OR REPLACE FUNCTION fn_auto_log_record_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_description TEXT;
  v_actor       TEXT;
  v_already     BOOLEAN;
BEGIN
  v_actor       := NEW.technician;
  v_description := 'Checklist submitted by ' || NEW.technician
                || ' — ' || NEW.equipment_type_name
                || ' (' || NEW.equipment_type_code || ')'
                || ' #' || NEW.equipment_number
                || ' | ' || NEW.section_name;

  -- Check for near-duplicate within the last 5 seconds
  -- (guards against double-logging when app + trigger both fire)
  SELECT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'record_submitted'
      AND description = v_description
      AND created_at  > NOW() - INTERVAL '5 seconds'
  ) INTO v_already;

  IF NOT v_already THEN
    INSERT INTO activity_logs (id, section, type, description, actor, created_at)
    VALUES (
      gen_random_uuid()::TEXT,
      'submissions',
      'record_submitted',
      v_description,
      v_actor,
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Attach the trigger to the records table (DROP first so re-running is safe)
DROP TRIGGER IF EXISTS trg_auto_log_record_insert ON records;

CREATE TRIGGER trg_auto_log_record_insert
  AFTER INSERT ON records
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_log_record_insert();


-- ==============================================================
-- SECTION 12 — AUTO-LOG TRIGGER FOR RECORD DELETION
--
-- When a record is deleted, automatically insert a deletion log.
-- Same near-duplicate guard as above.
-- ==============================================================

CREATE OR REPLACE FUNCTION fn_auto_log_record_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_description TEXT;
  v_already     BOOLEAN;
BEGIN
  v_description := 'Record ' || OLD.ref_id || ' deleted'
                || ' (' || OLD.technician
                || ' — ' || OLD.equipment_type_name || ')';

  SELECT EXISTS (
    SELECT 1 FROM activity_logs
    WHERE type        = 'record_deleted'
      AND description LIKE 'Record ' || OLD.ref_id || ' deleted%'
      AND created_at  > NOW() - INTERVAL '5 seconds'
  ) INTO v_already;

  IF NOT v_already THEN
    INSERT INTO activity_logs (id, section, type, description, actor, created_at)
    VALUES (
      gen_random_uuid()::TEXT,
      'deletions',
      'record_deleted',
      v_description,
      NULL,
      NOW()
    );
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_log_record_delete ON records;

CREATE TRIGGER trg_auto_log_record_delete
  AFTER DELETE ON records
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_log_record_delete();


-- ==============================================================
-- SECTION 13 — REPLICA IDENTITY (required for realtime DELETE)
--
-- Supabase Realtime needs REPLICA IDENTITY FULL on tables where
-- you want to receive DELETE payloads (payload.old).
-- Without this, DELETE events fire but payload.old is empty —
-- so the app cannot identify which record was deleted.
--
-- The app reads: const id = (payload.old as { id: string }).id;
-- This only works if REPLICA IDENTITY is FULL.
-- ==============================================================

ALTER TABLE records       REPLICA IDENTITY FULL;
ALTER TABLE activity_logs REPLICA IDENTITY FULL;


-- ==============================================================
-- SECTION 14 — VERIFICATION QUERIES
-- Run this script then inspect the results below.
-- ==============================================================

-- 14A. Confirm super admin row is correct
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
-- EXPECTED: is_super_admin = true, password = 'admin1', password_set = true

-- 14B. Confirm no duplicate admins
SELECT email, COUNT(*) AS count
FROM admins
GROUP BY LOWER(email)
HAVING COUNT(*) > 1;
-- EXPECTED: 0 rows

-- 14C. Confirm records table has correct structure
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'records'
ORDER BY ordinal_position;
-- EXPECTED: checklist is jsonb, submitted_at is timestamp with time zone

-- 14D. Confirm realtime publication includes both tables
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('records', 'activity_logs');
-- EXPECTED: 2 rows — records AND activity_logs

-- 14E. Confirm triggers exist
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN (
  'trg_auto_log_record_insert',
  'trg_auto_log_record_delete'
);
-- EXPECTED: 2 rows

-- 14F. Confirm replica identity is FULL on realtime tables
SELECT relname, relreplident
FROM pg_class
WHERE relname IN ('records', 'activity_logs');
-- EXPECTED: relreplident = 'f' (f = FULL) for both rows

-- 14G. Confirm RLS is disabled on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'records', 'activity_logs', 'admins',
    'settings', 'checklist_templates',
    'departments', 'sections', 'equipment_types'
  );
-- EXPECTED: rowsecurity = false for all 8 rows

-- 14H. Confirm settings has exactly 1 row
SELECT id, footer_text, qc_required FROM settings;
-- EXPECTED: exactly 1 row with id = 1

-- 14I. Confirm no duplicate activity logs
SELECT type, description, COALESCE(actor,''), DATE_TRUNC('second', created_at), COUNT(*)
FROM activity_logs
GROUP BY type, description, COALESCE(actor,''), DATE_TRUNC('second', created_at)
HAVING COUNT(*) > 1;
-- EXPECTED: 0 rows
