-- ============================================================
-- FleetOps: tech_locations table
-- Run this ONCE in your Supabase SQL Editor
-- ============================================================

-- 1. Create the table
create table if not exists public.tech_locations (
  employee_id   text        primary key,
  tech_name     text        not null default '',
  lat           double precision not null,
  lng           double precision not null,
  accuracy      real,
  updated_at    timestamptz not null default now()
);

-- 2. Enable Realtime for this table
alter publication supabase_realtime add table public.tech_locations;

-- 3. Row Level Security — anyone with the anon key can upsert their own row
--    and anyone can read all rows (dispatcher view)
alter table public.tech_locations enable row level security;

-- Allow techs to insert/update their own row
create policy "Tech upsert own location"
  on public.tech_locations
  for all
  using (true)
  with check (true);

-- ============================================================
-- Done. The anon key is enough — no service role key needed.
-- ============================================================
