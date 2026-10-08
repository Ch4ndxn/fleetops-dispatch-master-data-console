-- NCR Technicians — added 2026-10-09 from NCR_Technician_Sheet1.csv
-- Run in Supabase SQL Editor → SQL Editor → New Query

insert into technicians (id, employee_id, name, phone, alternate_phone, role, vendor, city, zone, specialisation, status, joined_date, notes, starting_latitude, starting_longitude, default_dc, created_at, updated_at)
values
  ('tech-ncr-1',  'NCR-1101', 'Mohit',           '', '', 'Field Engineer', 'In-House Ops', 'Delhi',    'Badharpur',       'General Fleet', 'Active', '2026-10-09', 'Base: Badharpur',       28.5009, 77.2890, '', now(), now()),
  ('tech-ncr-2',  'NCR-1102', 'Rohit',           '', '', 'Field Engineer', 'In-House Ops', 'Delhi',    'Mandoli',         'General Fleet', 'Active', '2026-10-09', 'Base: Mandoli',         28.7103, 77.3025, '', now(), now()),
  ('tech-ncr-3',  'NCR-1103', 'Abhishek',        '', '', 'Field Engineer', 'In-House Ops', 'Faridabad','Faridabad',       'General Fleet', 'Active', '2026-10-09', 'Base: Faridabad',       28.4089, 77.3178, '', now(), now()),
  ('tech-ncr-4',  'NCR-1104', 'Ganesh',          '', '', 'Field Engineer', 'In-House Ops', 'Noida',    'Noida Sec 11',    'General Fleet', 'Active', '2026-10-09', 'Base: Noida Sec 11',    28.5708, 77.3260, '', now(), now()),
  ('tech-ncr-5',  'NCR-1105', 'Shivam',          '', '', 'Field Engineer', 'In-House Ops', 'Noida',    'Noida Sec 22',    'General Fleet', 'Active', '2026-10-09', 'Base: Noida Sec 22',    28.5742, 77.3598, '', now(), now()),
  ('tech-ncr-6',  'NCR-1106', 'Rahul',           '', '', 'Field Engineer', 'In-House Ops', 'Noida',    'Noida Sec 22',    'General Fleet', 'Active', '2026-10-09', 'Base: Noida Sec 22',    28.5762, 77.3618, '', now(), now()),
  ('tech-ncr-7',  'NCR-1107', 'Harsh',           '', '', 'Field Engineer', 'In-House Ops', 'Delhi',    'Dwarka Sec 03',   'General Fleet', 'Active', '2026-10-09', 'Base: Dwarka Sec 03',   28.5921, 77.0460, '', now(), now()),
  ('tech-ncr-8',  'NCR-1108', 'Shivam Gupta',    '', '', 'Field Engineer', 'In-House Ops', 'Delhi',    'Jaitpur',         'General Fleet', 'Active', '2026-10-09', 'Base: Jaitpur',         28.5048, 77.3012, '', now(), now()),
  ('tech-ncr-9',  'NCR-1109', 'Pramond',         '', '', 'Field Engineer', 'In-House Ops', 'Delhi',    'Basantpur',       'General Fleet', 'Active', '2026-10-09', 'Base: Basantpur',       28.5553, 77.2011, '', now(), now()),
  ('tech-ncr-10', 'NCR-1110', 'Neeraj',          '', '', 'Field Engineer', 'In-House Ops', 'Gurugram', 'Gurgaon Sec 110', 'General Fleet', 'Active', '2026-10-09', 'Base: Gurgaon Sec 110', 28.3882, 77.0650, '', now(), now()),
  ('tech-ncr-11', 'NCR-1111', 'Sujeet',          '', '', 'Field Engineer', 'In-House Ops', 'Gurugram', 'Manesar',         'General Fleet', 'Active', '2026-10-09', 'Base: Manesar',         28.3580, 77.1534, '', now(), now()),
  ('tech-ncr-12', 'NCR-1112', 'Abhishek Thakur', '', '', 'Field Engineer', 'In-House Ops', 'Gurugram', 'Manesar',         'General Fleet', 'Active', '2026-10-09', 'Base: Manesar',         28.3595, 77.1550, '', now(), now()),
  ('tech-ncr-13', 'NCR-1113', 'Aashish',         '', '', 'Field Engineer', 'In-House Ops', 'Gurugram', 'Manesar',         'General Fleet', 'Active', '2026-10-09', 'Base: Manesar',         28.3565, 77.1518, '', now(), now()),
  ('tech-ncr-14', 'NCR-1114', 'Avnish',          '', '', 'Field Engineer', 'In-House Ops', 'Gurugram', 'Manesar',         'General Fleet', 'Active', '2026-10-09', 'Base: Manesar',         28.3610, 77.1560, '', now(), now())
on conflict (id) do update set
  name               = excluded.name,
  employee_id        = excluded.employee_id,
  city               = excluded.city,
  zone               = excluded.zone,
  starting_latitude  = excluded.starting_latitude,
  starting_longitude = excluded.starting_longitude,
  updated_at         = now();
