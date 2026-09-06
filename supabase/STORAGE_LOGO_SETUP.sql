-- =============================================================================
-- STORAGE SETUP: app-assets bucket for logo images
-- =============================================================================
-- This script creates the Supabase Storage bucket used for nav/home logos
-- and sets up the correct RLS policies so logos are publicly readable and
-- only writable via the anon key (your app).
--
-- HOW TO RUN:
--   Open Supabase Dashboard → SQL Editor → paste and run this script.
--
-- IMPORTANT: If you previously ran SECURITY_RLS_ENABLE.sql, also run
-- the policy section at the bottom of this file to allow anon writes to Storage.
-- =============================================================================


-- =============================================================================
-- STEP 1: Create the 'app-assets' storage bucket (if it doesn't exist)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-assets',
  'app-assets',
  true,                                          -- publicly readable (logos must be viewable by all)
  2097152,                                       -- 2 MB per file limit (logos are small)
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public              = true,                    -- ensure it stays public
  file_size_limit     = 2097152,
  allowed_mime_types  = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];


-- =============================================================================
-- STEP 2: Storage RLS policies (Supabase Storage uses its own policy table)
-- =============================================================================

-- Drop existing policies on app-assets to start clean
DELETE FROM storage.policies WHERE bucket_id = 'app-assets';

-- Policy 1: Anyone can READ files (logos must be publicly viewable on all devices)
INSERT INTO storage.policies (id, name, bucket_id, operation, definition)
VALUES (
  'app-assets-public-read',
  'Public read access for app-assets',
  'app-assets',
  'SELECT',
  'true'    -- allow all reads (bucket is already public, this is belt-and-suspenders)
)
ON CONFLICT (id) DO UPDATE SET definition = 'true';

-- Policy 2: Anon key can INSERT (upload) files into app-assets
-- This is required for the logo upload in the Super Admin settings panel.
INSERT INTO storage.policies (id, name, bucket_id, operation, definition)
VALUES (
  'app-assets-anon-insert',
  'Anon can upload to app-assets',
  'app-assets',
  'INSERT',
  'true'    -- the app controls who can trigger the upload (super admin panel only)
)
ON CONFLICT (id) DO UPDATE SET definition = 'true';

-- Policy 3: Anon key can UPDATE (upsert/overwrite) existing files
-- Needed because logos use a fixed path ('logos/nav-logo', 'logos/home-logo').
-- Every new upload overwrites the previous file at the same path.
INSERT INTO storage.policies (id, name, bucket_id, operation, definition)
VALUES (
  'app-assets-anon-update',
  'Anon can overwrite files in app-assets',
  'app-assets',
  'UPDATE',
  'true'
)
ON CONFLICT (id) DO UPDATE SET definition = 'true';

-- Policy 4: Anon key can DELETE files (needed for logo removal)
INSERT INTO storage.policies (id, name, bucket_id, operation, definition)
VALUES (
  'app-assets-anon-delete',
  'Anon can delete from app-assets',
  'app-assets',
  'DELETE',
  'true'
)
ON CONFLICT (id) DO UPDATE SET definition = 'true';


-- =============================================================================
-- STEP 3: Ensure the settings table has the correct logo columns
-- =============================================================================

-- Add nav_logo and home_logo columns if they don't exist (run-safe)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'nav_logo') THEN
    ALTER TABLE settings ADD COLUMN nav_logo TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'home_logo') THEN
    ALTER TABLE settings ADD COLUMN home_logo TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'nav_logo_v') THEN
    ALTER TABLE settings ADD COLUMN nav_logo_v INTEGER DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'home_logo_v') THEN
    ALTER TABLE settings ADD COLUMN home_logo_v INTEGER DEFAULT 1;
  END IF;
END $$;


-- =============================================================================
-- STEP 4: Ensure the settings row exists (id = 1)
-- =============================================================================

INSERT INTO settings (id, nav_logo, home_logo, nav_logo_v, home_logo_v)
VALUES (1, NULL, NULL, 1, 1)
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- VERIFICATION
-- =============================================================================

-- V1: Bucket exists and is public
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'app-assets';

-- V2: All 4 policies exist
SELECT id, name, operation
FROM storage.policies
WHERE bucket_id = 'app-assets'
ORDER BY operation;

-- V3: Settings row has correct columns
SELECT id, nav_logo, home_logo, nav_logo_v, home_logo_v
FROM settings
WHERE id = 1;

-- =============================================================================
-- EXPECTED RESULTS:
-- V1: 1 row, public = true
-- V2: 4 rows (SELECT, INSERT, UPDATE, DELETE)
-- V3: 1 row (nav_logo and home_logo may be null until you upload)
--
-- After running this script:
-- 1. Upload a logo in the Super Admin → Settings panel
-- 2. The image should stay permanently (no disappearing)
-- 3. Other devices should see the logo within ~1-2 seconds via Realtime
-- =============================================================================
