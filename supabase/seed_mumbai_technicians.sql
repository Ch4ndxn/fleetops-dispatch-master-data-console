-- Mumbai Technicians — added 2026-10-12 from Technician_Mumbai_Sheet1.csv
-- Run in Supabase SQL Editor → SQL Editor → New Query

insert into technicians (id, employee_id, name, phone, alternate_phone, role, vendor, city, zone, specialisation, status, joined_date, notes, starting_latitude, starting_longitude, default_dc, created_at, updated_at)
values
  ('tech-mum-1', 'MUM-2101', 'Shani Yadav',     '', '', 'Field Engineer', 'In-House Ops', 'Mumbai', 'Ambernath East', 'General Fleet', 'Active', '2026-10-12', 'Base: Ambernath East',          19.2074, 73.1879, '', now(), now()),
  ('tech-mum-2', 'MUM-2102', 'Azad Sharma',     '', '', 'Field Engineer', 'In-House Ops', 'Mumbai', 'Kalyan East',    'General Fleet', 'Active', '2026-10-12', 'Base: Kalyan East',             19.2332, 73.1362, '', now(), now()),
  ('tech-mum-3', 'MUM-2103', 'Vishal Bharati',  '', '', 'Field Engineer', 'In-House Ops', 'Mumbai', 'Diva East',      'General Fleet', 'Active', '2026-10-12', 'Base: Diva East',               19.1830, 73.0780, '', now(), now()),
  ('tech-mum-4', 'MUM-2104', 'Chandan Rajbhar', '', '', 'Field Engineer', 'In-House Ops', 'Mumbai', 'Vikhroli West',  'General Fleet', 'Active', '2026-10-12', 'Base: Vikhroli West',           19.1084, 72.9270, '', now(), now()),
  ('tech-mum-5', 'MUM-2105', 'Lala Gupta',      '', '', 'Field Engineer', 'In-House Ops', 'Mumbai', 'Ulhasnagar',     'General Fleet', 'Active', '2026-10-12', 'Base: Ulhasnagar',              19.2183, 73.1526, '', now(), now()),
  ('tech-mum-6', 'MUM-2106', 'Krishn Lal',      '', '', 'Field Engineer', 'In-House Ops', 'Mumbai', 'Marol Naka',     'General Fleet', 'Active', '2026-10-12', 'Base: Marol Naka, Andheri East', 19.1136, 72.8697, '', now(), now()),
  ('tech-mum-7', 'MUM-2107', 'Mahesh',          '', '', 'Field Engineer', 'In-House Ops', 'Mumbai', 'Bhiwandi',       'General Fleet', 'Active', '2026-10-12', 'Base: Bhiwandi',                19.2967, 73.0580, '', now(), now())
on conflict (id) do update set
  employee_id        = excluded.employee_id,
  name               = excluded.name,
  city               = excluded.city,
  zone               = excluded.zone,
  role               = excluded.role,
  vendor             = excluded.vendor,
  specialisation     = excluded.specialisation,
  status             = excluded.status,
  joined_date        = excluded.joined_date,
  notes              = excluded.notes,
  starting_latitude  = excluded.starting_latitude,
  starting_longitude = excluded.starting_longitude,
  updated_at         = now();
