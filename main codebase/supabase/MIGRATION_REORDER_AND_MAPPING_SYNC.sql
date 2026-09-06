-- ============================================================
-- MIGRATION: Reordering + Mapping Sync Fix
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- Safe to run multiple times (idempotent)
-- ============================================================

-- ─── ISSUE 1: Ensure mapping table exists and is realtime-enabled ────────────

create table if not exists equipment_type_mappings (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null,
  section_id uuid not null,
  equipment_type_id uuid not null,
  created_at timestamptz default now(),
  unique (department_id, section_id, equipment_type_id)
);

-- Enable RLS
alter table equipment_type_mappings enable row level security;

-- Policies
drop policy if exists "read_mappings" on equipment_type_mappings;
create policy "read_mappings"
on equipment_type_mappings for select
using (true);

drop policy if exists "write_mappings" on equipment_type_mappings;
create policy "write_mappings"
on equipment_type_mappings for all
using (auth.role() = 'authenticated');

-- Enable realtime safely
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
    and tablename = 'equipment_type_mappings'
  ) then
    alter publication supabase_realtime add table equipment_type_mappings;
  end if;
end $$;

-- Ensure full payload for realtime (required for DELETE events to include old row)
alter table equipment_type_mappings replica identity full;


-- ─── ISSUE 2: Add position columns for reordering ────────────────────────────

alter table departments    add column if not exists position integer default 0;
alter table sections       add column if not exists position integer default 0;
alter table equipment_types add column if not exists position integer default 0;

-- Initialize positions based on creation order (only sets rows where position = 0)
-- This uses a safe update that won't overwrite existing non-zero positions.
update departments
set position = subquery.rn
from (
  select id, (row_number() over (order by created_at))::integer - 1 as rn
  from departments
) as subquery
where departments.id = subquery.id
  and departments.position = 0;

update sections
set position = subquery.rn
from (
  select id, department_id,
    (row_number() over (partition by department_id order by created_at))::integer - 1 as rn
  from sections
) as subquery
where sections.id = subquery.id
  and sections.position = 0;

update equipment_types
set position = subquery.rn
from (
  select id, (row_number() over (order by created_at))::integer - 1 as rn
  from equipment_types
) as subquery
where equipment_types.id = subquery.id
  and equipment_types.position = 0;

-- Enable full replica identity (required for realtime UPDATE/DELETE payloads)
alter table departments     replica identity full;
alter table sections        replica identity full;
alter table equipment_types replica identity full;

-- Ensure these tables are in the realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'departments'
  ) then
    alter publication supabase_realtime add table departments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'sections'
  ) then
    alter publication supabase_realtime add table sections;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'equipment_types'
  ) then
    alter publication supabase_realtime add table equipment_types;
  end if;
end $$;

-- ─── Verification queries ─────────────────────────────────────────────────────
-- Run these to confirm everything is set up correctly:

-- Check position columns exist:
-- select column_name, data_type from information_schema.columns
-- where table_name in ('departments','sections','equipment_types')
--   and column_name = 'position';

-- Check realtime publication:
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime';

-- Check current ordering:
-- select name, position from departments order by position;
-- select name, position from sections order by position;
-- select name, code, position from equipment_types order by position;
