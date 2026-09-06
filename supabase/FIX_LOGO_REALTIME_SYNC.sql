-- =============================================================================
-- FIX: Logo & Settings Not Syncing to Other Devices
-- =============================================================================
--
-- ROOT CAUSE:
-- The 'settings' table was NOT added to the supabase_realtime publication.
-- This means:
--   • The app subscribes to postgres_changes on the settings table ✓
--   • The channel reports status "SUBSCRIBED" ✓  (misleadingly correct)
--   • BUT: zero events are ever delivered to any subscriber ✗
--   • Result: when the super admin uploads a logo on Device A, Device B
--     never receives the Realtime notification and never fetches the new logo
--
-- HOW SUPABASE REALTIME WORKS:
-- Realtime uses a PostgreSQL publication called "supabase_realtime".
-- Only tables explicitly added to this publication emit change events.
-- Tables not in the publication are invisible to all Realtime subscribers.
--
-- HOW TO RUN:
--   1. Open Supabase Dashboard → SQL Editor
--   2. Paste this entire script and click Run
--   3. Verify the output at the bottom shows all tables
--   4. Deploy the new app build (fixed_v30) — no re-login needed
--
-- After running this + deploying v30, logo changes sync to all devices
-- within ~1-2 seconds via Realtime.
-- =============================================================================


-- =============================================================================
-- STEP 1: Add 'settings' to the supabase_realtime publication
-- THIS IS THE PRIMARY FIX — this is what was missing.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE settings;
    RAISE NOTICE 'settings table added to supabase_realtime publication ✅';
  ELSE
    RAISE NOTICE 'settings table was already in the publication (no change needed)';
  END IF;
END $$;

-- Enable REPLICA IDENTITY FULL so UPDATE events include the full old row.
-- Without this, UPDATE payloads only contain changed columns.
ALTER TABLE settings REPLICA IDENTITY FULL;


-- =============================================================================
-- STEP 2: Add all other tables used by the app to the publication
-- These were also missing, causing delayed sync for departments, sections, etc.
-- =============================================================================

DO $$
BEGIN
  -- departments
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'departments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE departments;
    RAISE NOTICE 'departments added ✅';
  END IF;

  -- sections
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'sections') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sections;
    RAISE NOTICE 'sections added ✅';
  END IF;

  -- equipment_types
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'equipment_types') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE equipment_types;
    RAISE NOTICE 'equipment_types added ✅';
  END IF;

  -- equipment_type_mappings (may not exist on all installs)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipment_type_mappings') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'equipment_type_mappings') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE equipment_type_mappings;
      RAISE NOTICE 'equipment_type_mappings added ✅';
    END IF;
  END IF;

  -- field_configs (may not exist on all installs)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'field_configs') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'field_configs') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE field_configs;
      RAISE NOTICE 'field_configs added ✅';
    END IF;
  END IF;
END $$;

-- Replica identity for structure tables
ALTER TABLE departments     REPLICA IDENTITY FULL;
ALTER TABLE sections        REPLICA IDENTITY FULL;
ALTER TABLE equipment_types REPLICA IDENTITY FULL;


-- =============================================================================
-- STEP 3: Ensure the settings row exists with correct logo columns
-- =============================================================================

-- Add columns if missing (safe to run on existing installs)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='nav_logo')     THEN ALTER TABLE settings ADD COLUMN nav_logo TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='home_logo')    THEN ALTER TABLE settings ADD COLUMN home_logo TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='nav_logo_v')   THEN ALTER TABLE settings ADD COLUMN nav_logo_v INTEGER DEFAULT 1; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='home_logo_v')  THEN ALTER TABLE settings ADD COLUMN home_logo_v INTEGER DEFAULT 1; END IF;
END $$;

-- Ensure the canonical settings row exists
INSERT INTO settings (id, nav_logo, home_logo, nav_logo_v, home_logo_v)
VALUES (1, NULL, NULL, 1, 1)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- VERIFICATION — Run this after the script to confirm everything is correct
-- =============================================================================

-- V1: settings MUST appear in this list
SELECT tablename AS "in_realtime_publication"
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- V2: Replica identity check — settings MUST show 'f' (FULL)
SELECT relname AS table_name,
  CASE relreplident
    WHEN 'f' THEN '✅ FULL (correct)'
    WHEN 'd' THEN '⚠ DEFAULT (update events incomplete)'
    WHEN 'n' THEN '❌ NOTHING (no events)'
    ELSE relreplident::text
  END AS replica_identity
FROM pg_class
WHERE relname IN ('settings', 'records', 'activity_logs', 'departments', 'sections', 'equipment_types')
ORDER BY relname;

-- V3: Settings row with logo columns
SELECT
  id,
  CASE WHEN nav_logo  IS NULL THEN 'empty' ELSE '✅ has value' END AS nav_logo_status,
  CASE WHEN home_logo IS NULL THEN 'empty' ELSE '✅ has value' END AS home_logo_status,
  nav_logo_v,
  home_logo_v
FROM settings WHERE id = 1;

-- =============================================================================
-- EXPECTED RESULTS:
-- V1: should include 'settings' in the list (along with records, activity_logs, etc.)
-- V2: settings should show '✅ FULL (correct)'
-- V3: id=1 row exists
--
-- After running this script:
-- • Upload a logo in Super Admin → Settings
-- • Open the app on another device/browser tab
-- • Logo should appear within 1-2 seconds automatically
-- =============================================================================
