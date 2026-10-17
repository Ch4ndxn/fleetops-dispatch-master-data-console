-- ============================================================
-- FleetOps: visit_logs table
-- Run this ONCE in your Supabase SQL Editor
-- ============================================================

create table if not exists public.visit_logs (
  id            uuid        primary key default gen_random_uuid(),
  employee_id   text        not null,
  tech_name     text        not null default '',
  ticket_id     text        not null,
  center_name   text        not null default '',
  lat           double precision not null,
  lng           double precision not null,
  accuracy      real,
  action        text        not null default 'arrived',  -- 'arrived' | 'completed'
  visited_at    timestamptz not null default now()
);

-- Enable Realtime so dispatcher sees visits instantly
alter publication supabase_realtime add table public.visit_logs;

-- RLS: anon key can insert and read
alter table public.visit_logs enable row level security;

create policy "Anyone can log visits"
  on public.visit_logs for insert with check (true);

create policy "Anyone can read visit logs"
  on public.visit_logs for select using (true);

-- ============================================================
-- Done.
-- ============================================================
