-- =============================================================================
-- ADMIN SYNC DIAGNOSTICS & FIX
-- =============================================================================
-- Run this in Supabase SQL Editor if junior/senior admins cannot log in
-- on new devices. Checks and fixes the most common causes.
-- =============================================================================

-- ── DIAGNOSTIC 1: Check all admin accounts in the database ───────────────────
SELECT
  id,
  email,
  CASE
    WHEN password_hash LIKE '$2a$%' OR password_hash LIKE '$2b$%' THEN '✅ bcrypt hash'
    WHEN password_hash IS NULL OR password_hash = ''               THEN '⚠️  empty (pending first login)'
    ELSE '⚠️  legacy plaintext (logs in but needs upgrade)'
  END AS password_status,
  password_set,
  is_super_admin,
  role,
  can_delete_records,
  can_add_admins,
  created_at
FROM admins
ORDER BY is_super_admin DESC, created_at ASC;

-- EXPECTED: You should see ALL admin accounts here (super + junior + senior).
-- If you only see 1 row (the super admin), admins were never synced to the DB.
-- Fix: The app now fetches admins on startup. Log in as super admin on the
--      ORIGINAL device and the app will re-push all admin rows to Supabase.

-- ── DIAGNOSTIC 2: Check RLS is enabled and policies exist ────────────────────
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname = 'admins';

SELECT policyname, cmd, roles::text
FROM pg_policies
WHERE tablename = 'admins'
ORDER BY policyname;

-- EXPECTED: rls_enabled = true, and 6+ policies listed for admins table.
-- If rls_enabled = false: Run SECURITY_RLS_ENABLE.sql
-- If 0 policies: Run SECURITY_RLS_ENABLE.sql

-- ── DIAGNOSTIC 3: Test that anon can SELECT from admins ──────────────────────
-- (Run as anon role — simulate what the app sees)
-- Note: In SQL Editor you run as postgres (superuser), so this just shows the
-- data. The RLS test below is more accurate.
SELECT COUNT(*) AS admin_count FROM admins;

-- ── DIAGNOSTIC 4: Check if password_hash column exists ───────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'admins'
ORDER BY ordinal_position;

-- EXPECTED columns: id, email, password_hash (NOT password), password_set,
-- is_super_admin, role, can_delete_records, can_add_admins, created_at
-- If you still have 'password' column: Run SECURITY_PASSWORD_HASHING.sql

-- ── FIX 1: If admin accounts are missing, re-insert them manually ────────────
-- Replace the values below with the actual admin data you want to restore.
-- Use this ONLY if the admins are completely gone from the database.
--
-- INSERT INTO admins (id, email, password_hash, password_set, is_super_admin, role, can_delete_records, can_add_admins, created_at)
-- VALUES
--   (gen_random_uuid()::TEXT, 'junior@example.com', '', FALSE, FALSE, 'junior', TRUE, FALSE, NOW()),
--   (gen_random_uuid()::TEXT, 'senior@example.com', '', FALSE, FALSE, 'senior', TRUE, TRUE,  NOW())
-- ON CONFLICT (email) DO NOTHING;
--
-- After inserting with password_hash='', the admin can log in for the
-- first time and set their own password (the app handles this flow).

-- ── FIX 2: Reset a specific admin's password (force them to re-set it) ───────
-- UPDATE admins
-- SET password_hash = '', password_set = FALSE
-- WHERE email = 'junior@example.com';
-- After this the admin logs in and is prompted to create a new password.

-- ── FIX 3: If super admin cannot log in (emergency recovery) ─────────────────
-- Step 1: Clear the existing super admin password so it falls back to legacy
-- UPDATE admins
-- SET password_hash = 'admin1', password_set = TRUE
-- WHERE is_super_admin = TRUE;
-- Step 2: Log in with password 'admin1' — it will auto-upgrade on login
-- Step 3: Change the password immediately from the admin panel

-- =============================================================================
-- SUMMARY OF WHAT CAUSED THE ORIGINAL BUG:
-- =============================================================================
-- The app was only fetching admin accounts from Supabase when the Admin Panel
-- page was opened (lazy loading). But the login form IS the admin panel gate —
-- so on a new device, the admin list only contained the hardcoded default
-- super admin. Junior/Senior admin credentials were only in Supabase.
--
-- FIX APPLIED IN v28:
-- 1. App now fetches all admins from Supabase on initial page load (boot)
-- 2. LoginScreen also fetches fresh admin list before every login attempt
-- 3. Both have network fallback — works offline using local/cached state
-- =============================================================================
