-- ================================================================
-- FIX_SETTINGS_LOGS_SYNC.sql
-- Run in Supabase SQL Editor
-- ================================================================
--
-- FIXES:
--   1. Logo uploads not syncing → settings table added to Realtime
--   2. Homepage title not editable → home_title column added
--   3. Logs not appearing on other devices → activity_logs Realtime confirmed
-- ================================================================


-- ── STEP 1: Add home_title column to settings ─────────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS home_title TEXT
  DEFAULT 'Workshop Department Inspection System';

-- Set it on the existing row if null
UPDATE settings
SET home_title = 'Workshop Department Inspection System'
WHERE home_title IS NULL;


-- ── STEP 2: Add settings to Realtime publication ──────────────────────────────
-- Without this, logo/title changes on Device A never fire Realtime events.
-- Other devices only see changes after the next broadcast+refresh cycle,
-- but even that was broken due to the adminDataFetched guard bug (fixed in code).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE settings;
    RAISE NOTICE '✅ settings added to Realtime publication';
  ELSE
    RAISE NOTICE 'ℹ️  settings already in publication';
  END IF;
END $$;

ALTER TABLE settings REPLICA IDENTITY FULL;
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE settings TO anon, authenticated, service_role;


-- ── STEP 3: Confirm activity_logs is in Realtime (for log sync) ───────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'activity_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
    RAISE NOTICE '✅ activity_logs added to Realtime publication';
  ELSE
    RAISE NOTICE 'ℹ️  activity_logs already in publication';
  END IF;
END $$;

ALTER TABLE activity_logs REPLICA IDENTITY FULL;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE activity_logs TO anon, authenticated, service_role;


-- ── STEP 4: Confirm records is in Realtime ────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE records;
  END IF;
END $$;

ALTER TABLE records REPLICA IDENTITY FULL;
ALTER TABLE records DISABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE records TO anon, authenticated, service_role;


-- ── STEP 5: Verification ─────────────────────────────────────────────────────

SELECT 'settings in Realtime' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'settings';

SELECT 'activity_logs in Realtime' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'activity_logs';

SELECT 'records in Realtime' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'records';

SELECT 'home_title column exists' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS' ELSE '❌ FAIL' END AS result
FROM information_schema.columns
WHERE table_name = 'settings' AND column_name = 'home_title';

SELECT 'settings REPLICA IDENTITY' AS check_name,
  CASE WHEN relreplident = 'f' THEN '✅ PASS (FULL)'
       ELSE '❌ FAIL — ' || relreplident::text END AS result
FROM pg_class WHERE relname = 'settings';

-- Show all tables now in Realtime
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
