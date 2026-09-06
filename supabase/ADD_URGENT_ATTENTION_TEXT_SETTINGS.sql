-- ============================================================
-- ADD_URGENT_ATTENTION_TEXT_SETTINGS.sql
-- Adds urgent_attention_question_text / urgent_attention_definition_text
-- columns to the settings table (the same id=1 row that already stores
-- home_title, footer_text, logos, etc).
--
-- PURPOSE
--   Lets a Super Admin edit the question label and explanatory definition
--   text shown on the Urgent Attention Assessment step of the technician
--   checklist flow, without a code deployment.
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent via IF NOT EXISTS)
-- SAFE FOR AN EXISTING PRODUCTION DATABASE — only adds columns to the
-- existing settings row; does not touch any other table or data.
--
-- IMPORTANT: Run this BEFORE deploying the updated frontend build. The
-- frontend's settings query explicitly lists column names (matching the
-- existing pattern used for every other settings field), so it will fail
-- to load settings at all if these columns don't exist yet.
-- ============================================================

-- ── 1. Add the columns (safe if they already exist) ───────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS urgent_attention_question_text TEXT NOT NULL DEFAULT '';

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS urgent_attention_definition_text TEXT NOT NULL DEFAULT '';

-- ── 2. Confirm ─────────────────────────────────────────────────────────────
-- An empty string is intentional here — the app falls back to its built-in
-- default wording (DEFAULT_URGENT_ATTENTION_QUESTION_TEXT /
-- DEFAULT_URGENT_ATTENTION_DEFINITION_TEXT in src/store.ts) whenever these
-- columns are empty, so no back-fill is needed for existing installs.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'settings'
      AND column_name = 'urgent_attention_question_text'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'settings'
      AND column_name = 'urgent_attention_definition_text'
  ) THEN
    RAISE NOTICE 'SUCCESS: urgent_attention_question_text and urgent_attention_definition_text columns are present on the settings table.';
  ELSE
    RAISE EXCEPTION 'FAILED: urgent attention text columns were not added. Check permissions.';
  END IF;
END;
$$;
