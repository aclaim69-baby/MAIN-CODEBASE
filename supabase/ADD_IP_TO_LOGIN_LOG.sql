-- ============================================================
--  SUPER ADMIN LOGIN LOG — IP ADDRESS + ACTIVITY LOG PRIVACY
--  Daily Checking App — Run this in Supabase SQL Editor
-- ============================================================
--
--  WHAT THIS DOES
--  --------------
--  1. Adds an `ip` column to activity_logs to store the public
--     IP address captured at the time of each Super Admin login.
--  2. Rebuilds the partial index to cover the new column.
--  3. Provides verification queries.
--
--  PRIVACY DESIGN
--  --------------
--  Login entries (type = 'admin_login') are now EXCLUDED from
--  the public Activity Log page. They are only visible to the
--  Super Admin inside Settings → Login History. This is enforced
--  purely in the frontend — the rows still live in activity_logs
--  so they sync across all admin devices via Realtime.
--
--  IP ADDRESS CAPTURE
--  ------------------
--  The public IP is fetched from https://api.ipify.org at login
--  time (4-second timeout, graceful fallback to 'Unavailable').
--  The IP is stored in the `ip` column and displayed in the
--  Settings → Login History table alongside date and time.
--
--  CROSS-DEVICE SYNC
--  -----------------
--  Login entries flow through the existing addLog() → Supabase
--  INSERT → Realtime broadcast pipeline — no new infrastructure
--  is required.
--
-- ============================================================

-- ── Step 1: Add the ip column (safe, idempotent) ─────────────────────────────
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS ip TEXT;

COMMENT ON COLUMN activity_logs.ip IS
  'Public IP address of the client at login time. '
  'Only populated for rows where type = ''admin_login''. '
  'Captured via api.ipify.org with a 4-second timeout; '
  'stored as NULL or ''Unavailable'' when the lookup fails.';

-- ── Step 2: Rebuild the partial index to include ip ──────────────────────────
-- Drop the old index (from previous migration) and recreate with ip included.
DROP INDEX IF EXISTS activity_logs_login_idx;

CREATE INDEX IF NOT EXISTS activity_logs_login_idx
  ON activity_logs (created_at DESC)
  INCLUDE (ip)
  WHERE type = 'admin_login';

-- ── Step 3: Verification queries ─────────────────────────────────────────────
SELECT
  'Total activity_logs rows'    AS metric,
  COUNT(*)::TEXT                AS value
FROM activity_logs

UNION ALL

SELECT
  'admin_login entries',
  COUNT(*)::TEXT
FROM activity_logs
WHERE type = 'admin_login'

UNION ALL

SELECT
  'Login entries WITH ip captured',
  COUNT(*)::TEXT
FROM activity_logs
WHERE type = 'admin_login'
  AND ip IS NOT NULL
  AND ip NOT IN ('Unknown', 'Unavailable')

UNION ALL

SELECT
  'Most recent login (UTC)',
  MAX(created_at)::TEXT
FROM activity_logs
WHERE type = 'admin_login'

UNION ALL

SELECT
  'Most recent login IP',
  (SELECT ip FROM activity_logs
   WHERE type = 'admin_login' AND ip IS NOT NULL
   ORDER BY created_at DESC LIMIT 1)::TEXT;

-- ── Step 4: Preview the login history (most recent 20) ───────────────────────
SELECT
  id,
  actor,
  ip,
  created_at
FROM activity_logs
WHERE type = 'admin_login'
ORDER BY created_at DESC
LIMIT 20;

-- ============================================================
--  DONE.
--  After deploying the app code, every Super Admin login will:
--    • Record date, time, and public IP in activity_logs
--    • Appear ONLY in Settings → Login History (not Activity Log)
--    • Sync to every device via Supabase Realtime
-- ============================================================
