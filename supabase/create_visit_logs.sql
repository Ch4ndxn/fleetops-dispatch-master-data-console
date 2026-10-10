-- Migration: create visit_logs table
-- Run this once in Supabase SQL Editor → New Query → Run

create table if not exists public.visit_logs (
  id               text primary key,
  ticket_id        text,
  technician_id    text,
  technician_name  text,
  employee_id      text,
  center_name      text,
  vehicle_number   text,
  visit_date       text,
  check_in_time    text,
  check_out_time   text,
  outcome          text,
  notes            text,
  created_at       text,
  updated_at       text
);

-- Enable Row Level Security (match pattern of other tables)
alter table public.visit_logs enable row level security;

-- Allow anon read + write (same policy as tickets/attendance)
create policy "anon_all" on public.visit_logs
  for all
  to anon
  using (true)
  with check (true);
