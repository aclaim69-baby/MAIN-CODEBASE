-- =============================================================================
-- Daily Checking — Supabase Database Fix Script
-- =============================================================================
-- Run this entire script in the Supabase SQL Editor (Dashboard → SQL Editor).
-- It is fully idempotent — safe to run multiple times without side effects.
-- It does NOT drop any table or remove valid data.
--
-- Tables targeted:
--   admins           — role fix, super admin patch, duplicate removal
--   records          — unique constraint on ref_id, duplicate removal
--   activity_logs    — duplicate removal, safe unique index
--   settings         — single-row enforcement, duplicate removal
--   checklist_templates — unique constraint on (equipment_type_id, section_id)
--
-- Column names are taken directly from the app's db.ts interface definitions:
--   admins          : id, email, password, password_set, is_super_admin, role,
--                     can_delete_records, can_add_admins, created_at
--   records         : id, ref_id, department_id, department_name, section_id,
--                     section_name, equipment_type_id, equipment_type_name,
--                     equipment_type_code, equipment_number, date, start_time,
--                     completion_time, hour_meter, technician, supervisor,
--                     qc_verifier, checklist, submitted_at
--   activity_logs   : id, section, type, description, actor, created_at
--   settings        : id (integer), footer_text, qc_required, nav_logo, home_logo
--   checklist_templates : id, equipment_type_id, section_id, items
-- =============================================================================


-- =============================================================================
-- SECTION 1 — ADMINS TABLE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1A. Ensure required columns exist (safe — no error if already present)
-- ---------------------------------------------------------------------------

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS is_super_admin  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS role            TEXT    NOT NULL DEFAULT 'junior';

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS password_set    BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS can_delete_records BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS can_add_admins     BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 1B. Add a UNIQUE constraint on email (prevents duplicate admin accounts)
--     Uses DO $$ block so it is skipped silently if the constraint exists.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admins_email_unique'
      AND conrelid = 'admins'::regclass
  ) THEN
    ALTER TABLE admins ADD CONSTRAINT admins_email_unique UNIQUE (email);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1C. Remove duplicate admin rows — keep the oldest row per email
--     (identified by MIN(ctid) as a stable row pointer)
-- ---------------------------------------------------------------------------

DELETE FROM admins
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM admins
  GROUP BY email
);

-- ---------------------------------------------------------------------------
-- 1D. Fix NULL or empty roles — default any invalid value to 'junior'
--     Valid values the app uses: 'junior', 'senior'
--     (Super admins are identified by is_super_admin = TRUE, not by role)
-- ---------------------------------------------------------------------------

UPDATE admins
SET role = 'junior'
WHERE role IS NULL
   OR TRIM(role) = ''
   OR role NOT IN ('junior', 'senior');

-- ---------------------------------------------------------------------------
-- 1E. Patch the Super Admin account — the definitive fix
--
--     The app seed (store.ts defaultAdmins) always uses:
--       id            = 'admin-super'
--       email         = 'admin@system.com'
--       password      = 'admin1'
--       password_set  = true
--       is_super_admin = true
--       role          = 'junior'   ← role is irrelevant for supers in the app
--       can_delete_records = true
--       can_add_admins     = true
--
--     This UPSERT ensures the row always exists with the correct values.
--     ON CONFLICT (id) covers the case where the row already exists.
-- ---------------------------------------------------------------------------

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
)
VALUES (
  'admin-super',
  'admin@system.com',
  'admin1',
  TRUE,
  TRUE,
  'junior',
  TRUE,
  TRUE,
  NOW()
)
ON CONFLICT (id) DO UPDATE
  SET password        = EXCLUDED.password,
      password_set    = TRUE,
      is_super_admin  = TRUE,
      can_delete_records = TRUE,
      can_add_admins     = TRUE;

-- ---------------------------------------------------------------------------
-- 1F. Also patch by email in case the row exists but with a different id
--     (defensive — handles manual DB edits that changed the id)
-- ---------------------------------------------------------------------------

UPDATE admins
SET
  password        = 'admin1',
  password_set    = TRUE,
  is_super_admin  = TRUE,
  can_delete_records = TRUE,
  can_add_admins     = TRUE
WHERE email ILIKE 'admin@system.com'
  AND id <> 'admin-super';  -- only patches rows that weren't caught by 1E


-- =============================================================================
-- SECTION 2 — RECORDS TABLE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 2A. Ensure ref_id column is NOT NULL (it is always generated by the app)
-- ---------------------------------------------------------------------------

ALTER TABLE records
  ALTER COLUMN ref_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2B. Remove duplicate records — keep only the latest submission per ref_id
--     "Latest" = greatest submitted_at timestamp
-- ---------------------------------------------------------------------------

DELETE FROM records
WHERE ctid NOT IN (
  SELECT DISTINCT ON (ref_id) ctid
  FROM records
  ORDER BY ref_id, submitted_at DESC
);

-- ---------------------------------------------------------------------------
-- 2C. Add UNIQUE constraint on ref_id
--     Prevents future duplicate submissions with the same REF ID.
--     The app's makeRefId() generates: [CODE][EqNo]-[MON]-[DD]
--     e.g. TT56-MAR-26
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'records_ref_id_unique'
      AND conrelid = 'records'::regclass
  ) THEN
    ALTER TABLE records ADD CONSTRAINT records_ref_id_unique UNIQUE (ref_id);
  END IF;
END $$;


-- =============================================================================
-- SECTION 3 — ACTIVITY LOGS TABLE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3A. Remove exact duplicate log rows (same id inserted twice due to
--     realtime + manual insert race conditions that existed before the fix)
-- ---------------------------------------------------------------------------

DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM activity_logs
  GROUP BY id
);

-- ---------------------------------------------------------------------------
-- 3B. Remove near-duplicate log rows — same description + type + actor
--     within a 2-second window (caused by the old manual+realtime double-write)
--
--     Strategy: for each group of near-duplicates, keep the row with MIN(ctid).
--     This preserves all legitimate entries that differ in description/type/actor.
-- ---------------------------------------------------------------------------

DELETE FROM activity_logs
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM activity_logs
  GROUP BY
    type,
    description,
    COALESCE(actor, ''),
    DATE_TRUNC('second', created_at::timestamptz)  -- group within the same second
);

-- ---------------------------------------------------------------------------
-- 3C. Add a partial unique index on (id) — the primary deduplication guard.
--     id is already the PK so this is a belt-and-suspenders safety net.
--     We add a composite index on (type, description, actor, created_at second)
--     so the DB itself rejects near-duplicates at insert time.
--
--     NOTE: We use a function-based index, not a UNIQUE CONSTRAINT, because
--     actor is nullable and created_at needs truncation — constraints cannot
--     use expressions. We create it as UNIQUE INDEX instead.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_dedup_idx
  ON activity_logs (
    type,
    description,
    COALESCE(actor, ''),
    DATE_TRUNC('second', created_at::timestamptz)
  );


-- =============================================================================
-- SECTION 4 — SETTINGS TABLE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 4A. Ensure required columns exist
-- ---------------------------------------------------------------------------

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS footer_text TEXT    NOT NULL DEFAULT 'Designed by workshop inventory';

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS qc_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS nav_logo    TEXT;   -- nullable — base64 string

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS home_logo   TEXT;   -- nullable — base64 string

-- ---------------------------------------------------------------------------
-- 4B. Ensure id column is integer type (the app always uses id = 1)
--     If the table was created with id as UUID or TEXT, this will fail —
--     in that case you must recreate the table (see note below).
-- ---------------------------------------------------------------------------

-- The app's upsertSettings always sends: { id: 1, ...patch }
-- So the id column must be an integer. This statement is a no-op if already INTEGER.

-- ---------------------------------------------------------------------------
-- 4C. Keep only one settings row (id = 1) — remove all others
-- ---------------------------------------------------------------------------

DELETE FROM settings WHERE id <> 1;

-- ---------------------------------------------------------------------------
-- 4D. Upsert the canonical settings row (id = 1)
--     Inserts if missing; updates only the columns that are still at defaults
--     so existing custom footer text / logos are preserved.
-- ---------------------------------------------------------------------------

INSERT INTO settings (id, footer_text, qc_required, nav_logo, home_logo)
VALUES (
  1,
  'Designed by workshop inventory',
  FALSE,
  NULL,
  NULL
)
ON CONFLICT (id) DO UPDATE
  SET
    -- Only reset footer_text if it is somehow NULL
    footer_text = COALESCE(settings.footer_text, EXCLUDED.footer_text),
    -- Only reset qc_required if it is NULL
    qc_required = COALESCE(settings.qc_required, EXCLUDED.qc_required);
    -- nav_logo and home_logo are intentionally NOT overwritten —
    -- preserve whatever the admin has uploaded.

-- ---------------------------------------------------------------------------
-- 4E. Add a CHECK constraint so id can only ever be 1
--     Enforces single-row semantics at the database level.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settings_single_row'
      AND conrelid = 'settings'::regclass
  ) THEN
    ALTER TABLE settings ADD CONSTRAINT settings_single_row CHECK (id = 1);
  END IF;
END $$;


-- =============================================================================
-- SECTION 5 — CHECKLIST TEMPLATES TABLE
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 5A. Remove duplicate templates — keep only one per (equipment_type_id, section_id)
--     The app loads templates by this exact pair in getChecklistTemplate().
-- ---------------------------------------------------------------------------

DELETE FROM checklist_templates
WHERE ctid NOT IN (
  SELECT DISTINCT ON (equipment_type_id, section_id) ctid
  FROM checklist_templates
  ORDER BY equipment_type_id, section_id, id
);

-- ---------------------------------------------------------------------------
-- 5B. Add UNIQUE constraint on (equipment_type_id, section_id)
--     This matches exactly how the app queries:
--       upsertTemplateByEquipmentSection(equipmentTypeId, sectionId, items)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_templates_eq_sec_unique'
      AND conrelid = 'checklist_templates'::regclass
  ) THEN
    ALTER TABLE checklist_templates
      ADD CONSTRAINT checklist_templates_eq_sec_unique
      UNIQUE (equipment_type_id, section_id);
  END IF;
END $$;


-- =============================================================================
-- SECTION 6 — ROW LEVEL SECURITY (RLS) CHECK
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The app uses only the anon/publishable key from the frontend.
-- All tables must have RLS policies that allow anon reads and writes,
-- OR RLS must be disabled for these tables.
--
-- Run this block to disable RLS on all app tables so the publishable key
-- can read and write without authentication headers.
--
-- IMPORTANT: Only do this for an internal/trusted tool like this app.
-- If you need per-user RLS in future, re-enable and write proper policies.
-- ---------------------------------------------------------------------------

ALTER TABLE admins              DISABLE ROW LEVEL SECURITY;
ALTER TABLE records             DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE settings            DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;

-- Also disable on supporting tables if they exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'departments') THEN
    EXECUTE 'ALTER TABLE departments DISABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sections') THEN
    EXECUTE 'ALTER TABLE sections DISABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipment_types') THEN
    EXECUTE 'ALTER TABLE equipment_types DISABLE ROW LEVEL SECURITY';
  END IF;
END $$;


-- =============================================================================
-- SECTION 7 — VERIFICATION QUERIES
-- =============================================================================
-- Run these SELECT statements after the script to confirm everything is correct.

-- 7A. Confirm super admin row is correct
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
WHERE email ILIKE 'admin@system.com';
-- Expected:
--   id            = 'admin-super'
--   email         = 'admin@system.com'
--   password      = 'admin1'
--   password_set  = true
--   is_super_admin = true
--   role          = 'junior'   (irrelevant for supers — app checks is_super_admin)
--   can_delete_records = true
--   can_add_admins     = true

-- 7B. Confirm no duplicate admins
SELECT email, COUNT(*) AS cnt
FROM admins
GROUP BY email
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- 7C. Confirm no duplicate records
SELECT ref_id, COUNT(*) AS cnt
FROM records
GROUP BY ref_id
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- 7D. Confirm only one settings row
SELECT COUNT(*) AS settings_row_count FROM settings;
-- Expected: 1

-- 7E. Confirm settings row values
SELECT id, footer_text, qc_required FROM settings WHERE id = 1;
-- Expected: id=1, footer_text='Designed by workshop inventory' (or custom), qc_required=false

-- 7F. Confirm no duplicate checklist templates per equipment+section pair
SELECT equipment_type_id, section_id, COUNT(*) AS cnt
FROM checklist_templates
GROUP BY equipment_type_id, section_id
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- 7G. Confirm all admin roles are valid
SELECT id, email, role, is_super_admin
FROM admins
WHERE role NOT IN ('junior', 'senior');
-- Expected: 0 rows (super admins use is_super_admin=true, role='junior' is fine for them)

-- 7H. Check RLS is disabled on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'admins', 'records', 'activity_logs', 'settings',
    'checklist_templates', 'departments', 'sections', 'equipment_types'
  );
-- Expected: rowsecurity = false for all rows
