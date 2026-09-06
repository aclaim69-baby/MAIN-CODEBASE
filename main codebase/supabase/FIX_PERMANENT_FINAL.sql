-- ================================================================
-- FIX_PERMANENT_FINAL.sql
-- PERMANENT & SAFE — Run in Supabase SQL Editor
-- ================================================================
--
-- THIS SCRIPT:
--   1. Clears ONLY the stale UUID-format rows from equipment_type_mappings
--      (rows whose IDs are UUID format, not base36 — they can never match
--       the app's departments/sections/equipment_types)
--   2. Does NOT touch checklist_templates — your configured checklists
--      are safe and will remain intact
--   3. Confirms the mapping table is clean and ready
--
-- WHAT CAUSED THE BROKEN CHECKLIST:
--   The stale UUID-format mapping rows meant getMappedEquipmentTypeIds()
--   returned UUID strings like "550e8400-..." instead of null.
--   filteredEquipmentTypes then filtered to [] (no match with base36 IDs).
--   Empty equipment list = no equipment to select = no checklist shown.
--
-- AFTER THIS SCRIPT:
--   - Mapping table is empty (clean slate)
--   - getMappedEquipmentTypeIds() returns null (no mapping found)
--   - Fallback: "no mapping = show ALL equipment types" activates
--   - Technicians can see all equipment types and their checklists again
--   - Admin can re-configure mappings from Admin Panel → Mapping tab
--   - New mappings insert with correct base36 TEXT IDs
--   - All devices receive updates instantly via Realtime
-- ================================================================


-- ── STEP 1: Delete ONLY stale UUID-format mapping rows ───────────────────────
-- UUID format is: 8-4-4-4-12 hex digits with dashes
-- Base36 format: alphanumeric only, no dashes
-- We only delete rows where the IDs are UUID format (not base36)

DELETE FROM equipment_type_mappings
WHERE department_id      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR section_id         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR equipment_type_id  ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';


-- ── STEP 2: Verify mappings table is clean ───────────────────────────────────

SELECT
  'Mapping rows remaining' AS label,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) = 0
       THEN '✅ Clean — fallback (show all) will activate'
       ELSE '⚠️  Some rows remain — inspect below'
  END AS status
FROM equipment_type_mappings;

-- Show any remaining rows so you can verify they are valid base36 IDs
SELECT * FROM equipment_type_mappings LIMIT 20;


-- ── STEP 3: Confirm checklist_templates are untouched ────────────────────────

SELECT
  'Checklist templates preserved' AS label,
  COUNT(*) AS count,
  CASE WHEN COUNT(*) > 0
       THEN '✅ Templates intact — checklists will display'
       ELSE '⚠️  No templates found — admin must configure checklists in Admin Panel'
  END AS status
FROM checklist_templates;

-- Show templates so you can confirm they have base36 IDs
SELECT id, equipment_type_id, section_id,
       jsonb_array_length(items) AS item_count
FROM checklist_templates
LIMIT 20;


-- ── STEP 4: Confirm column types are TEXT ────────────────────────────────────

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'equipment_type_mappings'
ORDER BY ordinal_position;


-- ── STEP 5: Confirm Realtime publication ─────────────────────────────────────

SELECT
  tablename,
  CASE WHEN tablename IS NOT NULL
       THEN '✅ In Realtime publication'
       ELSE '❌ Missing — run FIX_EQUIPMENT_MAPPING_PERMANENT.sql'
  END AS realtime_status
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename = 'equipment_type_mappings';
