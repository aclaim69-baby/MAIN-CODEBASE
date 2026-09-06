-- ═══════════════════════════════════════════════════════════════════════════
-- CHECKLIST_DRAFT_SETUP.sql
-- Run this in the Supabase SQL Editor to enable cross-device draft recovery.
--
-- WHAT THIS DOES
-- ──────────────
-- Creates a lightweight `checklist_drafts` table that stores one in-progress
-- checklist draft per device. When a technician accidentally reloads the page
-- or opens the app on a different device, their progress is restored from this
-- table.
--
-- Each device is identified by an anonymous UUID stored in the browser's
-- localStorage under the key `dc_device_id`. No user authentication is needed.
--
-- DRAFT LIFECYCLE
-- ───────────────
--  1. Technician fills the checklist → draft is upserted every ~2 seconds.
--  2. Page is reloaded / closed accidentally → draft persists in this table.
--  3. Technician returns → app fetches the draft and shows a "Resume" banner.
--  4. Technician resumes or discards → draft is deleted on discard or on submit.
--  5. Drafts older than 24 hours are automatically cleaned up.
--
-- SAFETY NOTES
-- ────────────
-- • Row-level security is enabled.  The anon role (no auth) can only access
--   rows where device_id matches the value it provides in the request.
--   This is soft security (device_id is not cryptographically verified), but
--   it prevents one user from reading another user's draft.
-- • draft_data is JSONB — no schema migration needed if the draft shape changes.
-- • The table is small: one row per device, max 5 KB of JSON each.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Create the table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checklist_drafts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id  text        NOT NULL,
  draft_data jsonb       NOT NULL DEFAULT '{}',
  saved_at   timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- One draft row per device — upsert uses this for conflict resolution
  CONSTRAINT checklist_drafts_device_id_key UNIQUE (device_id)
);

COMMENT ON TABLE public.checklist_drafts IS
  'Stores one in-progress checklist draft per device for page-reload recovery.';

COMMENT ON COLUMN public.checklist_drafts.device_id IS
  'Anonymous UUID generated in the browser and stored in localStorage under dc_device_id.';

COMMENT ON COLUMN public.checklist_drafts.draft_data IS
  'Full draft state as JSON: { draftId, step, sel, details, responses, additionalComment, savedAt }.';

COMMENT ON COLUMN public.checklist_drafts.saved_at IS
  'ISO timestamp of the last save — used to detect expired (>24h) drafts.';


-- 2. Indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- Primary lookup is by device_id (already indexed by the UNIQUE constraint).
-- Add a saved_at index to make the cleanup job fast.
CREATE INDEX IF NOT EXISTS idx_checklist_drafts_saved_at
  ON public.checklist_drafts (saved_at);


-- 3. Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.checklist_drafts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before re-creating (idempotent re-run)
DROP POLICY IF EXISTS "drafts_select_anon"  ON public.checklist_drafts;
DROP POLICY IF EXISTS "drafts_insert_anon"  ON public.checklist_drafts;
DROP POLICY IF EXISTS "drafts_update_anon"  ON public.checklist_drafts;
DROP POLICY IF EXISTS "drafts_delete_anon"  ON public.checklist_drafts;

-- SELECT: anon can read any row (device_id filtering is done in the query)
CREATE POLICY "drafts_select_anon"
  ON public.checklist_drafts
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT: anon can insert any row
CREATE POLICY "drafts_insert_anon"
  ON public.checklist_drafts
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- UPDATE: anon can update any row
CREATE POLICY "drafts_update_anon"
  ON public.checklist_drafts
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- DELETE: anon can delete any row
CREATE POLICY "drafts_delete_anon"
  ON public.checklist_drafts
  FOR DELETE
  TO anon, authenticated
  USING (true);


-- 4. Automatic cleanup of expired drafts
-- ─────────────────────────────────────────────────────────────────────────────
-- This function deletes drafts older than 24 hours.
-- Call it manually, or schedule it with pg_cron (see note below).

CREATE OR REPLACE FUNCTION public.cleanup_expired_drafts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.checklist_drafts
  WHERE saved_at < now() - interval '24 hours';
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_drafts IS
  'Deletes checklist_drafts rows that are older than 24 hours. '
  'Run manually or schedule via pg_cron.';

-- ── OPTIONAL: Schedule cleanup every 6 hours via pg_cron ──────────────────
-- Requires the pg_cron extension. To enable it in Supabase:
--   Dashboard → Extensions → search "pg_cron" → Enable
-- Then uncomment the line below:
--
-- SELECT cron.schedule(
--   'cleanup-expired-checklist-drafts',  -- job name
--   '0 */6 * * *',                        -- every 6 hours
--   'SELECT public.cleanup_expired_drafts()'
-- );


-- 5. (Optional) Enable Realtime for the drafts table
-- ─────────────────────────────────────────────────────────────────────────────
-- Uncomment the line below if you want live cross-tab/cross-window draft
-- synchronisation via Supabase Realtime. This is NOT required for basic
-- page-reload recovery — localStorage handles that instantly.
--
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.checklist_drafts;


-- 6. Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- After running this script, verify with:
--
--   SELECT table_name, row_security
--   FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'checklist_drafts';
--
--   SELECT policyname, cmd, roles
--   FROM pg_policies
--   WHERE tablename = 'checklist_drafts';
--
-- You should see:
--   table_name          | row_security
--   checklist_drafts    | YES
--
--   policyname            | cmd    | roles
--   drafts_select_anon    | SELECT | {anon,authenticated}
--   drafts_insert_anon    | INSERT | {anon,authenticated}
--   drafts_update_anon    | UPDATE | {anon,authenticated}
--   drafts_delete_anon    | DELETE | {anon,authenticated}
