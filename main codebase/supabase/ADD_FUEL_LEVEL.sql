-- ============================================================
-- ADD_FUEL_LEVEL.sql
-- Run this once in the Supabase SQL Editor to add fuel-level
-- support across all devices.
-- ============================================================

-- 1. New column on records table
ALTER TABLE records
  ADD COLUMN IF NOT EXISTS fuel_level TEXT DEFAULT NULL;

-- 2. Partial index for fast low-fuel queries
CREATE INDEX IF NOT EXISTS idx_records_fuel_level
  ON records (fuel_level)
  WHERE fuel_level IS NOT NULL AND fuel_level <> '';

-- 3. Convenience view: low_fuel_alerts
--    Returns every record where fuel_level is a number < 20,
--    ordered most-recent-first.
CREATE OR REPLACE VIEW low_fuel_alerts AS
  SELECT
    id,
    ref_id,
    section,
    equipment_type,
    equipment_code,
    equipment_number,
    technician,
    date,
    submitted_at,
    fuel_level,
    CAST(fuel_level AS NUMERIC) AS fuel_pct
  FROM records
  WHERE
    fuel_level IS NOT NULL
    AND fuel_level <> ''
    AND fuel_level ~ '^[0-9]+(\.[0-9]+)?$'   -- guard non-numeric garbage
    AND CAST(fuel_level AS NUMERIC) < 20
  ORDER BY submitted_at DESC;

GRANT SELECT ON low_fuel_alerts TO anon, authenticated, service_role;
