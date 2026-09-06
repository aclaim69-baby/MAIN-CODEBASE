-- ============================================================
-- FIX_LOGO_CROSS_DEVICE.sql
-- Permanent fix: logo changes now propagate to ALL devices
-- Run once in Supabase SQL Editor → Run
-- ============================================================
--
-- ROOT CAUSE:
--   Logos are uploaded to a FIXED path ("logos/nav-logo",
--   "logos/home-logo") with a 1-year CDN cache header.
--   The public URL never changes, so browsers and Supabase CDN
--   serve the old cached image on every other device even after
--   the super admin uploads a new logo.
--
-- THIS FIX (DB side):
--   Adds nav_logo_v and home_logo_v (integer version counters)
--   to the settings table.  The app reads these counters and
--   appends ?v=<counter> to the public URL, making the URL
--   unique on every upload → forces all CDN/browser caches to
--   refetch the new image immediately.
--
-- COMPANION CODE CHANGES (sync.ts) are documented at the
--   bottom of this file.
-- ============================================================


-- ── STEP 1: Add version counter columns ──────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS nav_logo_v  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS home_logo_v INTEGER NOT NULL DEFAULT 1;

-- Initialise existing row so it starts at v=1
UPDATE settings SET
  nav_logo_v  = COALESCE(nav_logo_v,  1),
  home_logo_v = COALESCE(home_logo_v, 1)
WHERE id = 1;


-- ── STEP 2: Confirm settings is in Realtime publication ──────
-- (already done by FIX_SETTINGS_LOGS_SYNC.sql, but safe to repeat)
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

ALTER TABLE settings REPLICA IDENTITY FULL;


-- ── STEP 3: Confirm the columns exist ────────────────────────
SELECT
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'settings'
  AND column_name IN ('nav_logo', 'home_logo', 'nav_logo_v', 'home_logo_v')
ORDER BY column_name;


-- ── STEP 4: Show current settings row ────────────────────────
SELECT
  id,
  CASE WHEN nav_logo  IS NOT NULL THEN '✅ set' ELSE '— none' END AS nav_logo,
  CASE WHEN home_logo IS NOT NULL THEN '✅ set' ELSE '— none' END AS home_logo,
  nav_logo_v,
  home_logo_v,
  qc_required,
  footer_text,
  home_title,
  records_visibility
FROM settings
WHERE id = 1;

-- ============================================================
-- ✅ SQL DONE.
--
-- NOW APPLY THE TWO CODE CHANGES BELOW IN YOUR REPO.
-- These changes make the app append ?v=<counter> to every
-- logo URL so that CDN and browser caches are bypassed when
-- a new logo is uploaded.
--
-- ────────────────────────────────────────────────────────────
-- CHANGE A — src/lib/sync.ts
--
-- 1.  In the AppSettings type (or where nav_logo_v / home_logo_v
--     are mapped from DB rows), add the two version fields:
--
--       navLogoV:  number;   // maps from nav_logo_v
--       homeLogoV: number;   // maps from home_logo_v
--
-- 2.  In _uploadPublicAssetFromDataUrl, change cacheControl
--     from '31536000' (1 year) to '0' so Supabase Storage
--     does NOT cache at the CDN level:
--
--       .upload(path, blob, { upsert: true, contentType, cacheControl: '0' })
--                                                            ^^^
--
-- 3.  In syncUpsertSettings, BEFORE the .upsert() call,
--     increment the version counter whenever a new logo data
--     URL is being uploaded:
--
--       const nextNavV  = settings.navLogoUrl?.startsWith('data:')
--                           ? (settings.navLogoV ?? 0) + 1
--                           : (settings.navLogoV ?? 1);
--       const nextHomeV = settings.homeLogoUrl?.startsWith('data:')
--                           ? (settings.homeLogoV ?? 0) + 1
--                           : (settings.homeLogoV ?? 1);
--
--     Then include them in the upsert row:
--
--       nav_logo_v:  nextNavV,
--       home_logo_v: nextHomeV,
--
-- 4.  In fetchRemoteSettings, read the version columns back
--     and append ?v=<n> to the public URLs before returning:
--
--       .select('nav_logo, home_logo, nav_logo_v, home_logo_v,
--                qc_required, footer_text, home_title, records_visibility')
--       ...
--       const navV  = data.nav_logo_v  ?? 1;
--       const homeV = data.home_logo_v ?? 1;
--       return {
--         navLogoUrl:   data.nav_logo  ? data.nav_logo  + '?v=' + navV  : null,
--         homeLogoUrl:  data.home_logo ? data.home_logo + '?v=' + homeV : null,
--         navLogoV:     navV,
--         homeLogoV:    homeV,
--         ...
--       };
--
-- ────────────────────────────────────────────────────────────
-- CHANGE B — src/store.ts
--
-- Add navLogoV and homeLogoV to the AppSettings interface and
-- defaultSettings so the store carries the version counters:
--
--   interface AppSettings {
--     ...
--     navLogoV:  number;
--     homeLogoV: number;
--   }
--
--   const defaultSettings: AppSettings = {
--     ...
--     navLogoV:  1,
--     homeLogoV: 1,
--   };
--
-- In setNavLogo / setHomeLogo actions, increment the counter:
--
--   setNavLogo: (dataUrl) => {
--     set((s) => ({
--       settings: {
--         ...s.settings,
--         navLogoUrl: dataUrl,
--         navLogoV: dataUrl ? (s.settings.navLogoV ?? 0) + 1
--                           : s.settings.navLogoV,
--       }
--     }));
--     syncUpsertSettings(get().settings);
--   },
--
--   setHomeLogo: (dataUrl) => {
--     set((s) => ({
--       settings: {
--         ...s.settings,
--         homeLogoUrl: dataUrl,
--         homeLogoV: dataUrl ? (s.settings.homeLogoV ?? 0) + 1
--                            : s.settings.homeLogoV,
--       }
--     }));
--     syncUpsertSettings(get().settings);
--   },
--
-- ────────────────────────────────────────────────────────────
-- WHY THIS IS PERMANENT:
--
--   • Every new logo upload increments the version counter.
--   • The version is stored in Supabase settings row.
--   • The fetched URL becomes: https://.../logos/nav-logo?v=3
--   • Old cached URLs were ?v=2 — browsers treat ?v=3 as a
--     completely different resource and fetch it fresh.
--   • cacheControl: '0' on the Storage upload means Supabase's
--     own CDN will not serve a stale object either.
--   • Realtime notifies all open tabs/devices the moment
--     settings is updated → they call fetchRemoteSettings()
--     immediately → they get the new versioned URL → they
--     render the new logo within ~1 second on every device.
-- ============================================================
