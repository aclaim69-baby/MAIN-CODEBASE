-- ================================================================
-- FIX_EQUIPMENT_MAPPING_PERMANENT.sql
-- PERMANENT FIX — Run once in Supabase SQL Editor
-- ================================================================
--
-- ACTUAL ROOT CAUSE:
--   equipment_type_mappings.department_id   → UUID  (in your live DB)
--   equipment_type_mappings.section_id      → UUID  (in your live DB)
--   equipment_type_mappings.equipment_type_id → UUID (in your live DB)
--
--   BUT departments.id        → TEXT  (the app stores base36 strings)
--   BUT sections.id           → TEXT  (the app stores base36 strings)
--   BUT equipment_types.id    → TEXT  (the app stores base36 strings)
--
--   The app generates IDs like "abc123xyz" (base36, not UUID format).
--   PostgreSQL REJECTS inserting "abc123xyz" into a UUID column with:
--   "invalid input syntax for type uuid"
--
--   This error is silently swallowed — the UI appears to save, but
--   NOTHING is written to the database. Other devices see nothing
--   because nothing was ever stored.
--
-- THIS SCRIPT:
--   1. Drops the UUID constraints and converts columns to TEXT
--   2. Drops the duplicate unique constraint (two exist, only one needed)
--   3. Adds to Realtime publication (so other devices get live events)
--   4. Sets REPLICA IDENTITY FULL (so DELETE events carry full row)
--   5. Disables RLS (anon key used — RLS would silently block reads)
--   6. Grants permissions
--   7. Ensures sync trigger exists
--   8. Runs verification checks — ALL must show PASS
-- ================================================================


-- ── STEP 1: Convert UUID columns to TEXT ─────────────────────────────────────
--
-- Drop existing constraints first (can't change column type with constraints)

ALTER TABLE equipment_type_mappings
  DROP CONSTRAINT IF EXISTS equipment_type_mappings_pkey;

ALTER TABLE equipment_type_mappings
  DROP CONSTRAINT IF EXISTS equipment_type_mappings_department_id_section_id_equipment__key;

ALTER TABLE equipment_type_mappings
  DROP CONSTRAINT IF EXISTS equipment_type_mappings_unique;

-- Convert the id column from UUID to TEXT
ALTER TABLE equipment_type_mappings
  ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- Convert the foreign-key-like columns from UUID to TEXT
ALTER TABLE equipment_type_mappings
  ALTER COLUMN department_id TYPE TEXT USING department_id::TEXT;

ALTER TABLE equipment_type_mappings
  ALTER COLUMN section_id TYPE TEXT USING section_id::TEXT;

ALTER TABLE equipment_type_mappings
  ALTER COLUMN equipment_type_id TYPE TEXT USING equipment_type_id::TEXT;

-- Re-add primary key on id
ALTER TABLE equipment_type_mappings
  ADD CONSTRAINT equipment_type_mappings_pkey PRIMARY KEY (id);

-- Re-add ONE unique constraint (the original schema had two identical ones)
ALTER TABLE equipment_type_mappings
  ADD CONSTRAINT equipment_type_mappings_unique
  UNIQUE (department_id, section_id, equipment_type_id);

-- Ensure id defaults to a new UUID (as text) if not provided
ALTER TABLE equipment_type_mappings
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::TEXT;


-- ── STEP 2: REPLICA IDENTITY FULL ────────────────────────────────────────────
ALTER TABLE equipment_type_mappings REPLICA IDENTITY FULL;


-- ── STEP 3: Add to Realtime publication ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'equipment_type_mappings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE equipment_type_mappings;
    RAISE NOTICE '✅ Added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'ℹ️  Already in publication';
  END IF;
END $$;


-- ── STEP 4: Disable RLS ───────────────────────────────────────────────────────
ALTER TABLE equipment_type_mappings DISABLE ROW LEVEL SECURITY;


-- ── STEP 5: Permissions ───────────────────────────────────────────────────────
GRANT ALL ON TABLE equipment_type_mappings TO anon;
GRANT ALL ON TABLE equipment_type_mappings TO authenticated;
GRANT ALL ON TABLE equipment_type_mappings TO service_role;


-- ── STEP 6: Sync trigger ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_stamp_sync_status_on_mappings ON equipment_type_mappings;

CREATE TRIGGER trg_stamp_sync_status_on_mappings
  AFTER INSERT OR UPDATE OR DELETE
  ON equipment_type_mappings
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_stamp_sync_status();


-- ── STEP 7: VERIFICATION — all must show ✅ PASS ─────────────────────────────

SELECT 'CHECK 1 — department_id is TEXT' AS check_name,
  CASE WHEN data_type = 'text' THEN '✅ PASS'
       ELSE '❌ FAIL — still: ' || data_type END AS result
FROM information_schema.columns
WHERE table_name = 'equipment_type_mappings' AND column_name = 'department_id';

SELECT 'CHECK 2 — section_id is TEXT' AS check_name,
  CASE WHEN data_type = 'text' THEN '✅ PASS'
       ELSE '❌ FAIL — still: ' || data_type END AS result
FROM information_schema.columns
WHERE table_name = 'equipment_type_mappings' AND column_name = 'section_id';

SELECT 'CHECK 3 — equipment_type_id is TEXT' AS check_name,
  CASE WHEN data_type = 'text' THEN '✅ PASS'
       ELSE '❌ FAIL — still: ' || data_type END AS result
FROM information_schema.columns
WHERE table_name = 'equipment_type_mappings' AND column_name = 'equipment_type_id';

SELECT 'CHECK 4 — In Realtime publication' AS check_name,
  CASE WHEN COUNT(*) = 1 THEN '✅ PASS'
       ELSE '❌ FAIL — not in publication' END AS result
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'equipment_type_mappings';

SELECT 'CHECK 5 — REPLICA IDENTITY FULL' AS check_name,
  CASE WHEN relreplident = 'f' THEN '✅ PASS'
       ELSE '❌ FAIL — value: ' || relreplident::text END AS result
FROM pg_class WHERE relname = 'equipment_type_mappings';

SELECT 'CHECK 6 — RLS disabled' AS check_name,
  CASE WHEN relrowsecurity = false THEN '✅ PASS'
       ELSE '❌ FAIL — RLS is ON' END AS result
FROM pg_class WHERE relname = 'equipment_type_mappings';

SELECT 'CHECK 7 — Sync trigger exists' AS check_name,
  CASE WHEN COUNT(*) > 0 THEN '✅ PASS'
       ELSE '❌ FAIL — trigger missing' END AS result
FROM pg_trigger WHERE tgname = 'trg_stamp_sync_status_on_mappings';

-- Show current column types for all 4 key columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'equipment_type_mappings'
ORDER BY ordinal_position;
