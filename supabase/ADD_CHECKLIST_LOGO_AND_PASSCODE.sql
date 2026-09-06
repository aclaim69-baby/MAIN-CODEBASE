-- ============================================================
-- ADD_CHECKLIST_LOGO_AND_PASSCODE.sql
--
-- Adds two features to the `settings` table so they sync across
-- every device in real time via Supabase Realtime:
--
--   1. Checklist / Report Logo
--      - A dedicated logo shown on the Record Detail view banner
--        and on every PDF download (separate from the nav/home logos).
--
--   2. App Passcode Lock
--      - A 4 digit passcode required before the app loads.
--      - A super-admin controlled ON/OFF switch (passcode_enabled).
--      - A dedicated logo for the passcode lock screen.
--
-- Safe to run multiple times (IF NOT EXISTS everywhere).
-- Run once in Supabase SQL Editor → Run.
-- ============================================================

-- ── STEP 1: Checklist / Report Logo columns ──────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS checklist_logo   TEXT,
  ADD COLUMN IF NOT EXISTS checklist_logo_v INTEGER NOT NULL DEFAULT 1;

-- ── STEP 2: Passcode columns ──────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS app_passcode      TEXT DEFAULT '1234',
  ADD COLUMN IF NOT EXISTS passcode_logo     TEXT,
  ADD COLUMN IF NOT EXISTS passcode_logo_v   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS passcode_enabled  BOOLEAN NOT NULL DEFAULT FALSE;

-- ── STEP 3: Initialise / repair existing row ──────────────────
UPDATE settings SET
  checklist_logo_v = COALESCE(checklist_logo_v, 1),
  passcode_logo_v  = COALESCE(passcode_logo_v, 1),
  passcode_enabled = COALESCE(passcode_enabled, FALSE)
WHERE id = 1;

UPDATE settings
SET app_passcode = '1234'
WHERE app_passcode IS NULL OR app_passcode !~ '^[0-9]{4}$';

-- Make sure row id = 1 exists at all (fresh projects)
INSERT INTO settings (
  id, footer_text, qc_required,
  checklist_logo_v, app_passcode, passcode_logo_v, passcode_enabled
)
VALUES (1, 'Designed by workshop inventory', FALSE, 1, '1234', 1, FALSE)
ON CONFLICT (id) DO UPDATE
  SET checklist_logo_v = COALESCE(settings.checklist_logo_v, 1),
      app_passcode     = COALESCE(NULLIF(settings.app_passcode, ''), '1234'),
      passcode_logo_v  = COALESCE(settings.passcode_logo_v, 1),
      passcode_enabled = COALESCE(settings.passcode_enabled, FALSE);

-- ── STEP 4: Ensure settings is in the Realtime publication ───
-- (this makes every change — including passcode on/off — sync
--  live to all connected devices without a page refresh)
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
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add settings to supabase_realtime publication: %', SQLERRM;
END $$;

ALTER TABLE settings REPLICA IDENTITY FULL;

-- ── STEP 5: Make sure RLS-safe roles can read/write settings ─
GRANT ALL ON TABLE settings TO anon, authenticated, service_role;

-- ── STEP 6: Verify columns exist ───────────────────────────────
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'settings'
  AND column_name IN (
    'nav_logo', 'nav_logo_v',
    'home_logo', 'home_logo_v',
    'checklist_logo', 'checklist_logo_v',
    'passcode_logo', 'passcode_logo_v',
    'app_passcode', 'passcode_enabled'
  )
ORDER BY column_name;

-- ── STEP 7: Show current settings row ─────────────────────────
SELECT
  id,
  CASE WHEN nav_logo       IS NOT NULL THEN '✅ set' ELSE '— none' END AS nav_logo,
  CASE WHEN home_logo      IS NOT NULL THEN '✅ set' ELSE '— none' END AS home_logo,
  CASE WHEN checklist_logo IS NOT NULL THEN '✅ set' ELSE '— none' END AS checklist_logo,
  CASE WHEN passcode_logo  IS NOT NULL THEN '✅ set' ELSE '— none' END AS passcode_logo,
  app_passcode,
  passcode_enabled,
  nav_logo_v,
  home_logo_v,
  checklist_logo_v,
  passcode_logo_v
FROM settings
WHERE id = 1;

-- ============================================================
-- ✅ SQL done. Default state after running this script:
--   - checklist_logo  → empty (upload it from Admin → Settings)
--   - passcode_enabled → FALSE (app behaves exactly as before
--     until a Super Admin turns the passcode lock ON)
--   - app_passcode → '1234' (change it before enabling the lock!)
--
-- Companion code changes already applied in this codebase:
--   src/store.ts               — AppSettings interface + actions
--   src/lib/sync.ts            — syncUpsertSettings + fetchRemoteSettings
--   src/pdfUtils.ts            — branded header using checklistLogoUrl
--   src/pages/RecordsPage.tsx  — logo banner in detail view + PDF calls
--   src/pages/AdminPanel.tsx   — UploadZones + passcode ON/OFF + passcode input
--   src/App.tsx                — PasscodeGate lock screen
--   src/index.css              — .checklist-logo-banner styles
-- ============================================================
