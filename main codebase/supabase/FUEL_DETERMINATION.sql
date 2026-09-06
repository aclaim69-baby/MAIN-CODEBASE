-- ============================================================
-- FUEL_DETERMINATION.sql
-- Adds fuel determination columns, a synced Fuel Monitoring
-- visibility setting, and the fuel_monitoring view.
-- Run this in the Supabase SQL Editor before deploying the app.
-- ============================================================

-- Step 1: New record columns (fuel_level already exists from prior migration)
ALTER TABLE records
  ADD COLUMN IF NOT EXISTS fuel_can_determine       TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fuel_undetermined_reason TEXT DEFAULT NULL;

-- Step 2: Synced setting so super admins can make Fuel Monitoring visible to everyone
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS fuel_monitoring_visibility TEXT DEFAULT 'admin_only';

UPDATE settings
SET fuel_monitoring_visibility = COALESCE(NULLIF(fuel_monitoring_visibility, ''), 'admin_only')
WHERE id = 1;

-- Step 3: Index for fuel_can_determine (queries filter by this)
CREATE INDEX IF NOT EXISTS idx_records_fuel_can_determine
  ON records (fuel_can_determine)
  WHERE fuel_can_determine IS NOT NULL AND fuel_can_determine <> '';

-- Step 4: Drop old view
DROP VIEW IF EXISTS low_fuel_alerts;

-- Step 5: Comprehensive monitoring view
CREATE OR REPLACE VIEW fuel_monitoring AS
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
    fuel_can_determine,
    fuel_level,
    fuel_undetermined_reason,
    CASE
      WHEN fuel_can_determine = 'yes'
        AND fuel_level IS NOT NULL
        AND fuel_level <> ''
        AND fuel_level ~ '^[0-9]+(\.[0-9]+)?$'
        AND CAST(fuel_level AS NUMERIC) < 20
      THEN 'low_fuel'
      WHEN fuel_can_determine = 'no'
      THEN 'undetermined'
      ELSE NULL
    END AS alert_type
  FROM records
  WHERE
    fuel_can_determine IS NOT NULL
    AND fuel_can_determine <> ''
    AND (
      (
        fuel_can_determine = 'yes'
        AND fuel_level IS NOT NULL
        AND fuel_level <> ''
        AND fuel_level ~ '^[0-9]+(\.[0-9]+)?$'
        AND CAST(fuel_level AS NUMERIC) < 20
      )
      OR
      (fuel_can_determine = 'no')
    )
  ORDER BY submitted_at DESC;

GRANT SELECT ON fuel_monitoring TO anon, authenticated, service_role;
