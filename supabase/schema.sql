-- FleetOps Dispatch & Master Data Console
-- Run this SQL in your Supabase project → SQL Editor

-- ==================== CENTERS ====================
create table if not exists centers (
  id text primary key,
  name text not null unique,
  normalized_name text not null,
  city text not null default 'Delhi',
  latitude double precision not null,
  longitude double precision not null,
  default_dc text,
  active boolean not null default true,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==================== TECHNICIANS ====================
create table if not exists technicians (
  id text primary key,
  employee_id text not null unique,
  name text not null,
  phone text default '',
  alternate_phone text default '',
  role text not null default 'Field Engineer',
  vendor text default '',
  city text default 'Delhi',
  zone text default '',
  specialisation text default 'General Fleet',
  status text not null default 'Active',
  joined_date date,
  assigned_stm text default '',
  notes text default '',
  starting_latitude double precision,
  starting_longitude double precision,
  default_dc text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==================== TICKETS ====================
create table if not exists tickets (
  id text primary key,
  ticket_id text not null unique,
  vehicle_number text not null,
  vendor text default 'Zen',
  location text default '',
  center_name text not null,
  issue text not null default 'General Maintenance',
  category text default 'Mechanical',
  status text not null default 'Open',
  priority text not null default 'MEDIUM',
  affected_spare text default '',
  issue_type text default 'Breakdown',
  assigned_technician_id text,
  assigned_technician_name text,
  scheduled_slot text,
  is_new boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==================== ATTENDANCE ====================
create table if not exists attendance (
  id text primary key,
  employee_id text not null,
  technician_name text not null,
  date date not null,
  status text not null default 'Present',
  check_in_time text default '',
  check_out_time text default '',
  notes text default '',
  verified_by text default 'System Admin',
  updated_at timestamptz not null default now(),
  unique(employee_id, date)
);

-- ==================== IMPORT JOBS ====================
create table if not exists import_jobs (
  id text primary key,
  import_type text not null,
  file_name text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now(),
  total_rows int not null default 0,
  inserted_rows int not null default 0,
  updated_rows int not null default 0,
  skipped_rows int not null default 0,
  failed_rows int not null default 0,
  status text not null default 'COMPLETED',
  errors jsonb default '[]',
  observations jsonb default '[]',
  new_high_priority_count int default 0,
  missing_centers_found jsonb default '[]'
);

-- Enable Row Level Security (public read/write for now — tighten with auth later)
alter table centers enable row level security;
alter table technicians enable row level security;
alter table tickets enable row level security;
alter table attendance enable row level security;
alter table import_jobs enable row level security;

create policy "Allow all" on centers for all using (true) with check (true);
create policy "Allow all" on technicians for all using (true) with check (true);
create policy "Allow all" on tickets for all using (true) with check (true);
create policy "Allow all" on attendance for all using (true) with check (true);
create policy "Allow all" on import_jobs for all using (true) with check (true);

-- Updated_at triggers
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger centers_updated_at before update on centers for each row execute function update_updated_at();
create trigger technicians_updated_at before update on technicians for each row execute function update_updated_at();
create trigger tickets_updated_at before update on tickets for each row execute function update_updated_at();
create trigger attendance_updated_at before update on attendance for each row execute function update_updated_at();
