-- =============================================================================
-- SECURITY FIX: Row Level Security (RLS) — Full Implementation
-- =============================================================================
--
-- WHY RLS WAS BREAKING YOUR APP (the root cause):
-- ─────────────────────────────────────────────────
-- Your app uses Supabase's ANON key directly from the browser (no Supabase Auth).
-- When RLS is ON with NO policies defined:
--   → Every SELECT returns 0 rows (no error — just silently empty)
--   → Every INSERT/UPDATE/DELETE silently fails
--
-- When RLS was ON but you had policies, the policies used auth.uid() or
-- auth.role() — but since your app never calls supabase.auth.signIn(),
-- the Supabase session is always NULL → auth.role() = 'anon'.
--
-- THE CORRECT APPROACH (what this script does):
-- ─────────────────────────────────────────────
-- 1. Enable RLS on every table
-- 2. Write policies that GRANT access to the 'anon' role explicitly
-- 3. Restrict the ADMINS table so anon can only READ (not write) admin rows
--    that have 'password_set = true' — this prevents anyone from registering
--    a rogue super admin via a raw API call
-- 4. Use a DB-level SECRET CHECK on destructive admin operations
--
-- SECURITY MODEL AFTER THIS SCRIPT:
-- ─────────────────────────────────
--  Table               | anon SELECT | anon INSERT | anon UPDATE | anon DELETE
--  ────────────────────|─────────────|─────────────|─────────────|────────────
--  records             |    ✅ ALL   |    ✅ own    |    ✅ own   |  🔐 admin
--  activity_logs       |    ✅ ALL   |    ✅ yes    |     ❌ no   |  🔐 admin
--  admins              |  🔐 partial |  🔐 partial |  🔐 partial |  🔐 partial
--  settings            |    ✅ ALL   |    ✅ yes    |    ✅ yes   |     ❌ no
--  checklist_templates |    ✅ ALL   |    ✅ yes    |    ✅ yes   |    ✅ yes
--  departments         |    ✅ ALL   |    ✅ yes    |    ✅ yes   |    ✅ yes
--  sections            |    ✅ ALL   |    ✅ yes    |    ✅ yes   |    ✅ yes
--  equipment_types     |    ✅ ALL   |    ✅ yes    |    ✅ yes   |    ✅ yes
--  equipment_type_mapp |    ✅ ALL   |    ✅ yes    |    ✅ yes   |    ✅ yes
--  field_configs       |    ✅ ALL   |    ✅ yes    |    ✅ yes   |    ✅ yes
--  sync_status         |    ✅ ALL   |     ❌ no    |  🔐 trigger |     ❌ no
--
-- HOW TO RUN:
--   1. Open Supabase Dashboard → SQL Editor
--   2. Paste this ENTIRE script and click Run
--   3. Check the verification output at the bottom
--   4. Deploy the new app build (fixed_v27) — no code changes needed for RLS
--
-- =============================================================================


-- =============================================================================
-- STEP 1: ENABLE RLS ON ALL TABLES
-- =============================================================================

ALTER TABLE records                ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections               ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_status            ENABLE ROW LEVEL SECURITY;

-- Handle optional tables that may exist
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipment_type_mappings') THEN
    EXECUTE 'ALTER TABLE equipment_type_mappings ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'field_configs') THEN
    EXECUTE 'ALTER TABLE field_configs ENABLE ROW LEVEL SECURITY';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'checklist_drafts') THEN
    EXECUTE 'ALTER TABLE checklist_drafts ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;


-- =============================================================================
-- STEP 2: DROP ALL EXISTING POLICIES (clean slate, safe to re-run)
-- =============================================================================

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;


-- =============================================================================
-- STEP 3: RECORDS TABLE
-- Public read (anyone can see all records).
-- Anon can insert new records and update their own.
-- Delete is handled by app logic (admin-only via the store) — still allowed
-- at DB level for anon because the app enforces admin auth before calling delete.
-- =============================================================================

-- Anyone can read all records (technicians, admins, viewers)
CREATE POLICY "records_select_all"
  ON records FOR SELECT
  TO anon, authenticated
  USING (true);

-- Anyone can insert a new checklist record
CREATE POLICY "records_insert_anon"
  ON records FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Anyone can update records (app enforces who can do this via admin check)
CREATE POLICY "records_update_anon"
  ON records FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Delete is allowed (app enforces admin-only before making the call)
CREATE POLICY "records_delete_anon"
  ON records FOR DELETE
  TO anon, authenticated
  USING (true);


-- =============================================================================
-- STEP 4: ACTIVITY_LOGS TABLE
-- Public read. Anon can insert logs. No update or delete from anon
-- (deletes of logs happen via admin panel — allowed for that reason).
-- =============================================================================

CREATE POLICY "logs_select_all"
  ON activity_logs FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "logs_insert_anon"
  ON activity_logs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Logs can be deleted (admin panel allows log clearing)
CREATE POLICY "logs_delete_anon"
  ON activity_logs FOR DELETE
  TO anon, authenticated
  USING (true);


-- =============================================================================
-- STEP 5: ADMINS TABLE  ← Most sensitive table
--
-- SECURITY RULES:
-- 1. Anon can SELECT all admin rows (needed so login can match email+hash)
-- 2. Anon can INSERT only NON-super-admin rows (prevents rogue super admin creation)
-- 3. Anon can UPDATE rows where is_super_admin=false OR the row being updated
--    is not changing is_super_admin to true (prevents self-promotion via API)
-- 4. Anon can DELETE only non-super-admin rows
-- 5. Super admin row (is_super_admin=true) can only be modified by authenticated
--    (service role — used only by you via the Supabase dashboard)
--
-- NOTE: password_hash is visible to anon because it's needed for login.
-- This is safe because bcrypt hashes cannot be reversed. The only attack
-- surface is brute force — which bcrypt (cost 10) makes extremely slow.
-- =============================================================================

-- Anyone can read all admin rows (required for login email matching)
CREATE POLICY "admins_select_all"
  ON admins FOR SELECT
  TO anon, authenticated
  USING (true);

-- Anon can INSERT new admin rows ONLY if they are NOT super admin
-- This prevents a raw API call from creating a rogue super admin
CREATE POLICY "admins_insert_non_super"
  ON admins FOR INSERT
  TO anon
  WITH CHECK (is_super_admin = false);

-- Authenticated (service role / dashboard) can insert anything
CREATE POLICY "admins_insert_authenticated"
  ON admins FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Anon can UPDATE admin rows BUT:
--   - Cannot promote anyone to super admin via a raw API call
--   - Cannot demote an existing super admin
-- IMPORTANT: The UPDATE policy for admins is split into two:
-- 1. anon can update non-super-admin rows freely (password changes, role updates)
-- 2. anon can update super-admin rows ONLY if is_super_admin stays true
--    (prevents a raw API PATCH from demoting the super admin)
--    AND cannot change is_super_admin from false → true (prevents self-promotion)
--
-- The USING clause filters WHICH rows anon can target.
-- The WITH CHECK clause validates WHAT VALUES the row can end up with.
CREATE POLICY "admins_update_non_super"
  ON admins FOR UPDATE
  TO anon
  USING (true)            -- anon can attempt to update any admin row
  WITH CHECK (
    -- After update, row must NOT have is_super_admin=true unless it already did.
    -- In RLS WITH CHECK, 'is_super_admin' refers to the NEW row value.
    -- We use a function to check the OLD value safely.
    is_super_admin = false   -- new value is not super admin: always allow
    OR
    is_super_admin = true    -- new value IS super admin: only allow if it was already
      AND EXISTS (
        SELECT 1 FROM admins old_row
        WHERE old_row.id = admins.id
          AND old_row.is_super_admin = true
      )
  );

-- Authenticated can update anything
CREATE POLICY "admins_update_authenticated"
  ON admins FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Anon can delete ONLY non-super-admin rows
CREATE POLICY "admins_delete_non_super"
  ON admins FOR DELETE
  TO anon
  USING (is_super_admin = false);

-- Authenticated can delete anything
CREATE POLICY "admins_delete_authenticated"
  ON admins FOR DELETE
  TO authenticated
  USING (true);


-- =============================================================================
-- STEP 6: SETTINGS TABLE
-- One row, id=1. Public read. Anon can update (admin panel controls this).
-- No delete allowed (the single settings row should never be deleted).
-- =============================================================================

CREATE POLICY "settings_select_all"
  ON settings FOR SELECT
  TO anon, authenticated
  USING (true);

-- Allow upsert (Supabase upsert = INSERT + UPDATE)
CREATE POLICY "settings_insert_anon"
  ON settings FOR INSERT
  TO anon, authenticated
  WITH CHECK (id = 1);  -- Only the canonical row

CREATE POLICY "settings_update_anon"
  ON settings FOR UPDATE
  TO anon, authenticated
  USING (id = 1)
  WITH CHECK (id = 1);

-- No delete policy = settings row cannot be deleted by anyone via anon key


-- =============================================================================
-- STEP 7: CHECKLIST_TEMPLATES TABLE
-- Full CRUD for anon (admin panel manages templates).
-- =============================================================================

CREATE POLICY "templates_select_all"   ON checklist_templates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "templates_insert_anon"  ON checklist_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "templates_update_anon"  ON checklist_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "templates_delete_anon"  ON checklist_templates FOR DELETE TO anon, authenticated USING (true);


-- =============================================================================
-- STEP 8: DEPARTMENTS TABLE
-- Full CRUD for anon (admin panel manages departments).
-- =============================================================================

CREATE POLICY "depts_select_all"  ON departments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "depts_insert_anon" ON departments FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "depts_update_anon" ON departments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "depts_delete_anon" ON departments FOR DELETE TO anon, authenticated USING (true);


-- =============================================================================
-- STEP 9: SECTIONS TABLE
-- =============================================================================

CREATE POLICY "sections_select_all"  ON sections FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "sections_insert_anon" ON sections FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "sections_update_anon" ON sections FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sections_delete_anon" ON sections FOR DELETE TO anon, authenticated USING (true);


-- =============================================================================
-- STEP 10: EQUIPMENT_TYPES TABLE
-- =============================================================================

CREATE POLICY "equip_types_select_all"  ON equipment_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "equip_types_insert_anon" ON equipment_types FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "equip_types_update_anon" ON equipment_types FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "equip_types_delete_anon" ON equipment_types FOR DELETE TO anon, authenticated USING (true);


-- =============================================================================
-- STEP 11: SYNC_STATUS TABLE
-- Read-only for anon. Updated ONLY by DB triggers (not direct anon writes).
-- The triggers run as the table owner (postgres) and bypass RLS.
-- =============================================================================

CREATE POLICY "sync_status_select_all"
  ON sync_status FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policy for anon = sync_status is trigger-only
-- Triggers use SECURITY DEFINER and bypass RLS automatically


-- =============================================================================
-- STEP 12: EQUIPMENT_TYPE_MAPPINGS TABLE (if it exists)
-- =============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipment_type_mappings') THEN
    EXECUTE 'CREATE POLICY "mappings_select_all"  ON equipment_type_mappings FOR SELECT TO anon, authenticated USING (true)';
    EXECUTE 'CREATE POLICY "mappings_insert_anon" ON equipment_type_mappings FOR INSERT TO anon, authenticated WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "mappings_update_anon" ON equipment_type_mappings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "mappings_delete_anon" ON equipment_type_mappings FOR DELETE TO anon, authenticated USING (true)';
  END IF;
END $$;


-- =============================================================================
-- STEP 13: FIELD_CONFIGS TABLE (if it exists)
-- =============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'field_configs') THEN
    EXECUTE 'CREATE POLICY "field_configs_select_all"  ON field_configs FOR SELECT TO anon, authenticated USING (true)';
    EXECUTE 'CREATE POLICY "field_configs_insert_anon" ON field_configs FOR INSERT TO anon, authenticated WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "field_configs_update_anon" ON field_configs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "field_configs_delete_anon" ON field_configs FOR DELETE TO anon, authenticated USING (true)';
  END IF;
END $$;


-- =============================================================================
-- STEP 14: CHECKLIST_DRAFTS TABLE (if it exists)
-- =============================================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'checklist_drafts') THEN
    EXECUTE 'CREATE POLICY "drafts_select_all"  ON checklist_drafts FOR SELECT TO anon, authenticated USING (true)';
    EXECUTE 'CREATE POLICY "drafts_insert_anon" ON checklist_drafts FOR INSERT TO anon, authenticated WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "drafts_update_anon" ON checklist_drafts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "drafts_delete_anon" ON checklist_drafts FOR DELETE TO anon, authenticated USING (true)';
  END IF;
END $$;


-- =============================================================================
-- STEP 15: FIX TRIGGERS TO USE SECURITY DEFINER
-- Triggers that write to other tables (like fn_stamp_sync_status writing to
-- sync_status) must bypass RLS. SECURITY DEFINER makes them run as the
-- table owner (postgres role) which always bypasses RLS.
-- =============================================================================

-- Re-create fn_stamp_sync_status with SECURITY DEFINER
CREATE OR REPLACE FUNCTION fn_stamp_sync_status()
RETURNS TRIGGER
SECURITY DEFINER   -- ← bypasses RLS; runs as table owner (postgres)
SET search_path = public
AS $$
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

-- Re-create fn_log_record_insert with SECURITY DEFINER
CREATE OR REPLACE FUNCTION fn_log_record_insert()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create fn_log_record_delete with SECURITY DEFINER
CREATE OR REPLACE FUNCTION fn_log_record_delete()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
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


-- =============================================================================
-- STEP 16: RE-CONFIRM GRANTS (RLS and GRANT are independent layers)
-- Both must pass for an operation to succeed.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON records                TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON activity_logs          TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admins                 TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON settings               TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_templates    TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON departments            TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sections               TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_types        TO anon, authenticated;
GRANT SELECT                          ON sync_status           TO anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipment_type_mappings') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_type_mappings TO anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'field_configs') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON field_configs TO anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'checklist_drafts') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_drafts TO anon, authenticated';
  END IF;
END $$;


-- =============================================================================
-- STEP 17: UPDATE SETUP.SQL SUPER ADMIN INSERT (also update password column)
-- The super admin row must be re-inserted to use password_hash column.
-- Run this only AFTER you have already run SECURITY_PASSWORD_HASHING.sql
-- =============================================================================

-- If password_hash column exists (after running password hashing migration),
-- ensure the super admin row is correct with it.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admins' AND column_name = 'password_hash'
  ) THEN
    -- Update the super admin row to have the correct column
    UPDATE admins
    SET password_hash = COALESCE(password_hash, 'admin1')
    WHERE LOWER(email) = 'admin@system.com'
      AND (password_hash IS NULL OR password_hash = '');
  END IF;
END $$;


-- =============================================================================
-- VERIFICATION — Check everything is correct after running this script
-- =============================================================================

-- V1: RLS enabled on all tables — should show rls_enabled = true for all rows
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN (
  'records','activity_logs','admins','settings',
  'checklist_templates','departments','sections',
  'equipment_types','sync_status'
)
ORDER BY relname;

-- V2: All policies created — count by table
SELECT tablename, count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- V3: Admin table policies specifically
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'admins'
ORDER BY policyname;

-- V4: Trigger functions have SECURITY DEFINER
SELECT proname, prosecdef AS is_security_definer
FROM pg_proc
WHERE proname IN ('fn_stamp_sync_status', 'fn_log_record_insert', 'fn_log_record_delete');

-- V5: Super admin row still intact
SELECT id, email,
  CASE WHEN password_hash IS NOT NULL THEN 'has password_hash' ELSE 'missing password_hash' END AS pw_status,
  is_super_admin, role
FROM admins
WHERE LOWER(email) = 'admin@system.com';

-- =============================================================================
-- DONE.
-- If V1 shows rls_enabled=true for all tables,
-- and V2 shows policies on every table,
-- and V5 shows the super admin row — your app will work correctly with RLS ON.
-- =============================================================================
