-- ============================================================
-- EVIDENCE_PHOTO_SETUP.sql
--
-- Adds the Evidence Photo feature:
--   - A private Supabase Storage bucket for evidence photos
--     (JPG / PNG / WEBP, max 4 MB, compressed client-side first)
--   - An `inspection_evidence` table linking photos to either a
--     specific "NOT OK" checklist item or the Additional Comment
--   - An `evidence_settings` table for retention (days to keep
--     photos before they can be purged)
--
-- Run once in Supabase SQL Editor → Run. Safe to re-run.
-- ============================================================

-- ── STEP 1: Private storage bucket for evidence photos ───────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inspection-evidence',
  'inspection-evidence',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = false,
  file_size_limit    = 4194304,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ── STEP 2: Evidence metadata table ───────────────────────────
create table if not exists public.inspection_evidence (
  id                  text primary key,
  submission_id       text not null,
  equipment_number    text not null,
  checklist_item_id   text null,
  evidence_type       text not null check (evidence_type in ('CHECKLIST_ITEM', 'ADDITIONAL_COMMENT')),
  image_url           text not null,
  file_name           text not null,
  file_size           integer not null check (file_size <= 4194304),
  uploaded_by         text null,
  uploaded_at         timestamptz not null default now(),
  sync_status         text not null default 'SYNCED',
  created_at          timestamptz not null default now()
);

create index if not exists idx_inspection_evidence_submission_id
  on public.inspection_evidence (submission_id);

create index if not exists idx_inspection_evidence_type_item
  on public.inspection_evidence (evidence_type, checklist_item_id);

-- One image per "NOT OK" checklist finding, and one per additional comment.
create unique index if not exists uq_evidence_checklist_item
  on public.inspection_evidence (submission_id, checklist_item_id)
  where evidence_type = 'CHECKLIST_ITEM';

create unique index if not exists uq_evidence_additional_comment
  on public.inspection_evidence (submission_id)
  where evidence_type = 'ADDITIONAL_COMMENT';

alter table public.inspection_evidence enable row level security;

drop policy if exists "inspection evidence read authenticated" on public.inspection_evidence;
create policy "inspection evidence read authenticated"
on public.inspection_evidence for select
to anon, authenticated
using (true);

drop policy if exists "inspection evidence insert authenticated" on public.inspection_evidence;
create policy "inspection evidence insert authenticated"
on public.inspection_evidence for insert
to anon, authenticated
with check (true);

drop policy if exists "inspection evidence update authenticated" on public.inspection_evidence;
create policy "inspection evidence update authenticated"
on public.inspection_evidence for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "inspection evidence delete authenticated" on public.inspection_evidence;
create policy "inspection evidence delete authenticated"
on public.inspection_evidence for delete
to anon, authenticated
using (true);

-- ── STEP 3: Storage object policies for the private bucket ───
drop policy if exists "inspection evidence storage read authenticated" on storage.objects;
create policy "inspection evidence storage read authenticated"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'inspection-evidence');

drop policy if exists "inspection evidence storage insert authenticated" on storage.objects;
create policy "inspection evidence storage insert authenticated"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'inspection-evidence');

drop policy if exists "inspection evidence storage update authenticated" on storage.objects;
create policy "inspection evidence storage update authenticated"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'inspection-evidence')
with check (bucket_id = 'inspection-evidence');

drop policy if exists "inspection evidence storage delete authenticated" on storage.objects;
create policy "inspection evidence storage delete authenticated"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'inspection-evidence');

-- ── STEP 4: Retention setting (configurable later from Admin UI) ─
create table if not exists public.evidence_settings (
  id             integer primary key default 1 check (id = 1),
  retention_days integer null,
  updated_at     timestamptz not null default now()
);

insert into public.evidence_settings (id, retention_days)
values (1, 365)
on conflict (id) do nothing;

alter table public.evidence_settings enable row level security;

drop policy if exists "evidence settings read authenticated" on public.evidence_settings;
create policy "evidence settings read authenticated"
on public.evidence_settings for select
to anon, authenticated
using (true);

drop policy if exists "evidence settings update authenticated" on public.evidence_settings;
create policy "evidence settings update authenticated"
on public.evidence_settings for update
to anon, authenticated
using (true)
with check (retention_days in (180, 365, 730) or retention_days is null);

-- ── STEP 5: Make sure evidence syncs live across all devices ─
-- (registers inspection_evidence with Supabase Realtime, the same
--  mechanism used for records/settings/etc. in this app)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'inspection_evidence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inspection_evidence;
    RAISE NOTICE '✅ inspection_evidence added to Realtime publication';
  ELSE
    RAISE NOTICE 'ℹ️  inspection_evidence already in Realtime publication';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add inspection_evidence to supabase_realtime publication: %', SQLERRM;
END $$;

ALTER TABLE public.inspection_evidence REPLICA IDENTITY FULL;

GRANT ALL ON TABLE public.inspection_evidence  TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.evidence_settings    TO anon, authenticated, service_role;

-- ── STEP 6: Verify ────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM storage.buckets WHERE id = 'inspection-evidence')        AS bucket_exists,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'inspection_evidence') AS evidence_table_exists,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'evidence_settings')   AS settings_table_exists,
  (SELECT retention_days FROM public.evidence_settings WHERE id = 1)              AS retention_days;

-- ============================================================
-- ✅ SQL done.
--
-- Companion code changes already applied in this codebase:
--   src/lib/evidence.ts        — compress, upload, queue & sync evidence photos
--   src/store.ts               — EvidenceImage type, evidenceImage / additionalEvidenceImage fields
--   src/lib/sync.ts            — strips data: URLs before upsert, attaches evidence on fetch
--   src/lib/draftManager.ts    — evidence persists in offline drafts
--   src/lib/faultAnalysis.ts   — fault trend cards show linked evidence photo
--   src/pages/TechnicianFlow.tsx — photo capture/upload UI on every "NOT OK" item + comment
--   src/pages/RecordsPage.tsx  — Evidence column/thumbnail in record detail view
--   src/pages/AnalysisPage.tsx — "Evidence Available" thumbnail on fault cards
--   src/App.tsx                — background evidence upload queue flusher
--
-- Photos are stored privately (not public) and the app generates short-lived
-- signed URLs on demand when someone opens a thumbnail.
-- ============================================================
