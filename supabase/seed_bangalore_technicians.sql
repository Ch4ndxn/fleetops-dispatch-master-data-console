-- Seed: 3 Bangalore technicians
-- Run in Supabase SQL Editor — safe to re-run (upsert on id)

INSERT INTO technicians (
  id, employee_id, name, phone, role, vendor, city, zone,
  specialisation, status, joined_date, notes,
  starting_latitude, starting_longitude, default_dc,
  exclude_from_routing, created_at, updated_at
) VALUES
  ('tech-blr-1', 'BLR-3101', 'Gururaj', '', 'Field Engineer', 'In-House Ops', 'Bangalore', 'RR Nagar',
   'General Fleet', 'Active', '2026-10-13', 'Base: RR Nagar',
   12.9237, 77.5198, '', FALSE, '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z'),

  ('tech-blr-2', 'BLR-3102', 'Sandeep', '', 'Field Engineer', 'In-House Ops', 'Bangalore', 'Yelahanka',
   'General Fleet', 'Active', '2026-10-13', 'Base: Yelahanka',
   13.1006, 77.5963, '', FALSE, '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z'),

  ('tech-blr-3', 'BLR-3103', 'Mohsin', '', 'Field Engineer', 'In-House Ops', 'Bangalore', 'Shivajinagar',
   'General Fleet', 'Active', '2026-10-13', 'Base: Shivajinagar',
   12.9855, 77.6014, '', FALSE, '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z')

ON CONFLICT (id) DO UPDATE SET
  employee_id        = EXCLUDED.employee_id,
  name               = EXCLUDED.name,
  city               = EXCLUDED.city,
  zone               = EXCLUDED.zone,
  starting_latitude  = EXCLUDED.starting_latitude,
  starting_longitude = EXCLUDED.starting_longitude,
  notes              = EXCLUDED.notes,
  updated_at         = EXCLUDED.updated_at;
