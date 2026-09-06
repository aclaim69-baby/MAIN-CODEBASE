-- ================================================================
-- FIX_SETTINGS_COLUMNS_AND_TITLE.sql
-- Run ONCE in Supabase SQL Editor
-- ================================================================
--
-- FIXES:
--   1. records_visibility column missing  → Records "admin only" never synced
--   2. show_fill_button column missing    → Fill button setting never synced
--   3. home_title default was wrong name  → Updates to "Technical Department"
--   4. Ensures all 3 columns exist and
--      are included in Realtime publication
-- ================================================================


-- ── STEP 1: Add missing columns (safe — IF NOT EXISTS) ────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS home_title TEXT
  DEFAULT 'Technical Department Inspection System';

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS records_visibility TEXT
  DEFAULT 'general';

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS show_fill_button BOOLEAN
  DEFAULT false;


-- ── STEP 2: Correct the existing row's default title if it still
--            has the old "Workshop Department" value ─────────────────────────

UPDATE settings
SET home_title = 'Technical Department Inspection System'
WHERE home_title IS NULL
   OR home_title = 'Workshop Department Inspection System';

-- Set records_visibility default if null
UPDATE settings
SET records_visibility = 'general'
WHERE records_visibility IS NULL;

-- Set show_fill_button default if null
UPDATE settings
SET show_fill_button = false
WHERE show_fill_button IS NULL;


-- ── STEP 3: Ensure settings is in Realtime publication ───────────────────────
-- Without this, changes on one device never fire events to other devices.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE settings;
    RAISE NOTICE '✅ settings added to Realtime publication';
  ELSE
    RAISE NOTICE 'ℹ️  settings already in Realtime publication';
  END IF;
END $$;

-- REPLICA IDENTITY FULL is required for Realtime UPDATE events to carry
-- the full row (including changed columns) to subscribed clients.
ALTER TABLE settings REPLICA IDENTITY FULL;

-- Ensure anon/authenticated can read and write settings (super admin is
-- already validated in the application layer — RLS is not used here).
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE settings TO anon, authenticated, service_role;


-- ── STEP 4: Verification ─────────────────────────────────────────────────────

SELECT 'records_visibility column' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ EXISTS' ELSE '❌ MISSING' END AS result
FROM information_schema.columns
WHERE table_name = 'settings' AND column_name = 'records_visibility';

SELECT 'show_fill_button column' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ EXISTS' ELSE '❌ MISSING' END AS result
FROM information_schema.columns
WHERE table_name = 'settings' AND column_name = 'show_fill_button';

SELECT 'home_title column' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ EXISTS' ELSE '❌ MISSING' END AS result
FROM information_schema.columns
WHERE table_name = 'settings' AND column_name = 'home_title';

SELECT 'settings in Realtime' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'settings';

SELECT 'settings REPLICA IDENTITY FULL' AS check_name,
  CASE WHEN relreplident = 'f' THEN '✅ PASS' ELSE '❌ FAIL — run: ALTER TABLE settings REPLICA IDENTITY FULL' END AS result
FROM pg_class WHERE relname = 'settings';

-- Show current settings row so you can confirm values
SELECT id, home_title, records_visibility, show_fill_button, footer_text
FROM settings
LIMIT 1;
