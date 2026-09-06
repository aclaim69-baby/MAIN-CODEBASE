-- ============================================================
--  SUPER ADMIN LOGIN LOG SUPPORT
--  Daily Checking App — Run this in Supabase SQL Editor
-- ============================================================
--
--  BACKGROUND
--  ----------
--  The `activity_logs` table already exists and already has
--  a `type` TEXT column that accepts any value.
--  The TypeScript interface already declares the 'admin_login'
--  type and the ActivityLogPage already renders it.
--
--  The ONLY gap was that the login() action in store.ts was
--  NOT calling addLog() after a successful super admin sign-in.
--  That is now fixed in the app code.
--
--  This migration:
--    1. Adds a partial index so login-log queries are fast
--       even when the table grows to thousands of rows.
--    2. Annotates the type column for documentation.
--    3. Provides verification queries.
--
--  CROSS-DEVICE SYNC
--  -----------------
--  Login entries are inserted via the existing addLog() →
--  syncInsertLog() → Supabase INSERT pipeline and replicated
--  through the existing Supabase Realtime subscription.
--  No new tables, triggers, or channels are required.
--
-- ============================================================

-- 1. Fast index for fetching only login entries
--    (partial index — only indexes rows where type = 'admin_login')
CREATE INDEX IF NOT EXISTS activity_logs_login_idx
  ON activity_logs (created_at DESC)
  WHERE type = 'admin_login';

-- 2. Document the valid type values
COMMENT ON COLUMN activity_logs.type IS
  'Event type. Valid values: record_submitted, record_deleted, '
  'admin_created, admin_removed, admin_permissions_updated, admin_login, '
  'department_added, department_removed, section_added, section_removed, '
  'equipment_added, equipment_removed. '
  'admin_login is written on every successful Super Admin sign-in.';

-- 3. Verification — check existing login entries (if any)
SELECT
  'Total activity log rows'            AS metric,
  COUNT(*)::TEXT                       AS value
FROM activity_logs

UNION ALL

SELECT
  'Admin login entries',
  COUNT(*)::TEXT
FROM activity_logs
WHERE type = 'admin_login'

UNION ALL

SELECT
  'Most recent login (UTC)',
  MAX(created_at)::TEXT
FROM activity_logs
WHERE type = 'admin_login';

-- ============================================================
--  DONE.
--  After running the app code update, every Super Admin login
--  will appear instantly in Settings → Login History and sync
--  to all devices through Supabase Realtime.
-- ============================================================
