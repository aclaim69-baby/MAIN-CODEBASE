-- ================================================================
-- FIX_MAPPING_STALE_UUID_ROWS.sql
-- Run this in Supabase SQL Editor IMMEDIATELY
-- ================================================================
--
-- WHAT HAPPENED:
--   The previous migration (FIX_EQUIPMENT_MAPPING_PERMANENT.sql)
--   converted UUID columns to TEXT — which is correct.
--
--   BUT: The table already contained rows with UUID-format IDs
--   like "550e8400-e29b-41d4-a716-446655440000" that were inserted
--   by Supabase's own default or by earlier admin saves.
--
--   The app stores department/section/equipment_type IDs as base36
--   strings like "abc123xyz" — NOT uuids.
--
--   After the migration:
--     - getMappedEquipmentTypeIds() finds mappings for the dept+section
--     - Returns UUID-format equipment_type_id values
--     - Tries to match against equipment_types[].id (base36 strings)
--     - NO MATCH → filteredEquipmentTypes = []
--     - Technician sees no equipment types → no checklist
--
-- THE FIX:
--   Delete all rows whose IDs do not match the base36 format the
--   app uses. This restores the "no mapping = show all" fallback,
--   which is the correct safe default.
--
--   After running this, admins must re-save their mappings from the
--   Admin Panel → Mapping tab. The mappings will now insert correctly
--   with base36 TEXT IDs that match the equipment_types table.
-- ================================================================


-- ── STEP 1: Delete all stale UUID-format mapping rows ────────────────────────
--
-- UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with dashes)
-- Base36 format: alphanumeric, NO dashes, typically 8-16 chars
--
-- We detect UUID rows by checking if department_id matches the UUID pattern.
-- If department_id is a UUID, the entire row is stale and must be removed.

DELETE FROM equipment_type_mappings
WHERE department_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR section_id    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR equipment_type_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';


-- ── STEP 2: Confirm the table is now empty (or only has valid rows) ───────────

SELECT
  'Rows deleted — table should be empty or contain only base36 IDs' AS status,
  COUNT(*) AS remaining_rows
FROM equipment_type_mappings;

-- Also show any remaining rows so you can inspect them
SELECT * FROM equipment_type_mappings LIMIT 20;


-- ── STEP 3: Confirm column types are all TEXT ─────────────────────────────────

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'equipment_type_mappings'
ORDER BY ordinal_position;


-- ── STEP 4: Confirm realtime publication ──────────────────────────────────────

SELECT
  CASE WHEN COUNT(*) = 1 THEN '✅ In Realtime publication'
       ELSE '❌ NOT in publication — run FIX_EQUIPMENT_MAPPING_PERMANENT.sql first' END AS realtime_status
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'equipment_type_mappings';


-- ================================================================
-- AFTER RUNNING THIS SCRIPT:
--
-- 1. All devices will immediately see no mappings (table is empty)
-- 2. "No mapping = show all equipment types" fallback kicks in
-- 3. Checklists are visible again for all technicians
-- 4. Go to Admin Panel → Mapping tab
-- 5. Re-configure your equipment type mappings for each dept+section
-- 6. Save — mappings now insert with correct base36 TEXT IDs
-- 7. All devices receive the update via Realtime instantly
-- ================================================================
