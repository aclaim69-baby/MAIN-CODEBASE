-- ============================================================
--  FIX SUPER ADMIN LOGIN — Daily Checking App
--  Paste this entire script into Supabase SQL Editor and Run.
-- ============================================================


-- STEP 1 — Disable Row Level Security on admins table
-- (RLS with no policies silently returns 0 rows to the anon key)
ALTER TABLE admins DISABLE ROW LEVEL SECURITY;


-- STEP 2 — Delete every row for admin@system.com
-- (clears any corrupted or duplicate rows before reinserting clean)
DELETE FROM admins
WHERE LOWER(email) = 'admin@system.com';


-- STEP 3 — Insert the super admin row with every field correct
INSERT INTO admins (
  id,
  email,
  password,
  password_set,
  is_super_admin,
  role,
  can_delete_records,
  can_add_admins
)
VALUES (
  'admin-super',
  'admin@system.com',
  'admin1',
  true,
  true,
  'junior',
  true,
  true
);


-- STEP 4 — Verify the row is correct (inspect the result below)
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
