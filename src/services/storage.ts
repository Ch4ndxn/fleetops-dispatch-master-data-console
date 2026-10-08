/**
 * FleetOps Storage Service
 * ─────────────────────────────────────────────────────────────────
 * Primary store: localStorage (synchronous — works with all existing components)
 * Background sync: Supabase PostgreSQL (when env vars are set)
 *
 * All read/write functions remain synchronous so zero component changes needed.
 * Supabase syncs happen silently in the background via syncToSupabase().
 * ─────────────────────────────────────────────────────────────────
 */

import {
  Technician, Center, Ticket, AttendanceRecord,
  ImportJob, DataQualityStats, TechnicianRoutePlan,
} from '../types';
import { normalizeCenterName, isValidLatitude, isValidLongitude } from './csvParser';
import { supabase, isDbEnabled } from '../lib/supabase';

// ─────────────────────────────────────────────────────────────────
// STORAGE KEYS
// ─────────────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  TECHNICIANS: 'fleetops_technicians_v2',
  CENTERS: 'fleetops_centers_v2',
  TICKETS: 'fleetops_tickets_v2',
  ATTENDANCE: 'fleetops_attendance_v2',
  IMPORT_JOBS: 'fleetops_import_jobs_v2',
  ROUTES: 'fleetops_routes_v2',
  DB_LOADED: 'fleetops_db_loaded',
};

// ─────────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────────
const INITIAL_CENTERS: Center[] = [
  { id: 'dc-1', name: 'Delhi_PatelNagar_D', normalizedName: normalizeCenterName('Delhi_PatelNagar_D'), city: 'Delhi', latitude: 28.6519, longitude: 77.1663, defaultDc: 'Central Delhi DC', active: true, notes: 'Major West-Central Delhi service and swap hub', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'dc-2', name: 'Delhi_Naraina_D', normalizedName: normalizeCenterName('Delhi_Naraina_D'), city: 'Delhi', latitude: 28.6289, longitude: 77.1382, defaultDc: 'West Delhi DC', active: true, notes: 'Industrial area hub with heavy commercial EV throughput', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'dc-3', name: 'Noida_Sector83_D', normalizedName: normalizeCenterName('Noida_Sector83_D'), city: 'Noida', latitude: 28.5145, longitude: 77.4086, defaultDc: 'Noida Main DC', active: true, notes: 'Key Expressway and Phase-2 distribution station', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'dc-4', name: 'Delhi_OkhlaPhase3_D', normalizedName: normalizeCenterName('Delhi_OkhlaPhase3_D'), city: 'Delhi', latitude: 28.5362, longitude: 77.2711, defaultDc: 'South Delhi DC', active: true, notes: 'High-density quick-repair and battery diagnostics facility', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'dc-5', name: 'Gurugram_UdyogVihar_D', normalizedName: normalizeCenterName('Gurugram_UdyogVihar_D'), city: 'Gurugram', latitude: 28.5028, longitude: 77.0878, defaultDc: 'Gurugram DC', active: true, notes: 'Cyber City and Industrial fleet support center', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'dc-6', name: 'Faridabad_Sector24_D', normalizedName: normalizeCenterName('Faridabad_Sector24_D'), city: 'Faridabad', latitude: 28.3752, longitude: 77.3155, defaultDc: 'Faridabad DC', active: true, notes: 'South NCR logistics and 3-wheeler repair depot', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

const INITIAL_TECHNICIANS: Technician[] = [
  { id: 'tech-1', employeeId: 'TECH-1001', name: 'Rajesh Sharma', phone: '9876543210', alternatePhone: '9876543219', role: 'Senior Technician', vendor: 'Zen Fleet Ops', city: 'Delhi', zone: 'West Delhi', specialisation: 'Electrical', status: 'Active', joinedDate: '2023-04-12', assignedStm: 'Amit Verma (STM)', notes: 'Expert in BMS and wiring harnesses', startingLatitude: 28.6448, startingLongitude: 77.1511, defaultDc: 'Central Delhi DC', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'tech-2', employeeId: 'TECH-1002', name: 'Vikram Singh', phone: '9812345678', alternatePhone: '9812345670', role: 'Field Engineer', vendor: 'Zen Fleet Ops', city: 'Noida', zone: 'Sector 83 / Expressway', specialisation: 'Motor', status: 'Active', joinedDate: '2023-08-01', assignedStm: 'Amit Verma (STM)', notes: 'Motor replacement & gearbox expert', startingLatitude: 28.5355, startingLongitude: 77.3910, defaultDc: 'Noida Main DC', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'tech-3', employeeId: 'TECH-1003', name: 'Sunil Kumar Yadav', phone: '9823456789', role: 'Battery Specialist', vendor: 'Switch Mobility', city: 'Delhi', zone: 'South Delhi', specialisation: 'Battery', status: 'Active', joinedDate: '2024-01-15', assignedStm: 'Deepak Rao (STM)', notes: 'Cell balancing & high-voltage safety certified', startingLatitude: 28.5284, startingLongitude: 77.2655, defaultDc: 'South Delhi DC', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'tech-4', employeeId: 'TECH-1004', name: 'Mohammad Tariq', phone: '9834567890', role: 'Field Engineer', vendor: 'Zen Fleet Ops', city: 'Gurugram', zone: 'Udyog Vihar', specialisation: 'Controller', status: 'Active', joinedDate: '2024-02-10', assignedStm: 'Deepak Rao (STM)', notes: 'ECU flashing and throttle recalibration', startingLatitude: 28.4988, startingLongitude: 77.0850, defaultDc: 'Gurugram DC', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'tech-5', employeeId: 'TECH-1005', name: 'Pooja Rawat', phone: '9845678901', role: 'Field Engineer', vendor: 'Zen Fleet Ops', city: 'Delhi', zone: 'North / West Delhi', specialisation: 'Diagnostics', status: 'On Leave', joinedDate: '2024-03-01', assignedStm: 'Amit Verma (STM)', notes: 'On medical leave till Friday', startingLatitude: 28.6692, startingLongitude: 77.1554, defaultDc: 'Central Delhi DC', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  // ── NCR Technicians (added 2026-10-09 from NCR_Technician sheet) ──
  { id: 'tech-ncr-1',  employeeId: 'NCR-1101', name: 'Mohit',           phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Delhi',     zone: 'Badharpur',       specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Badharpur',       startingLatitude: 28.5009, startingLongitude: 77.2890, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-2',  employeeId: 'NCR-1102', name: 'Rohit',           phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Delhi',     zone: 'Mandoli',         specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Mandoli',         startingLatitude: 28.7103, startingLongitude: 77.3025, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-3',  employeeId: 'NCR-1103', name: 'Abhishek',        phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Faridabad', zone: 'Faridabad',       specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Faridabad',       startingLatitude: 28.4089, startingLongitude: 77.3178, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-4',  employeeId: 'NCR-1104', name: 'Ganesh',          phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Noida',     zone: 'Noida Sec 11',    specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Noida Sec 11',    startingLatitude: 28.5708, startingLongitude: 77.3260, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-5',  employeeId: 'NCR-1105', name: 'Shivam',          phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Noida',     zone: 'Noida Sec 22',    specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Noida Sec 22',    startingLatitude: 28.5742, startingLongitude: 77.3598, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-6',  employeeId: 'NCR-1106', name: 'Rahul',           phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Noida',     zone: 'Noida Sec 22',    specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Noida Sec 22',    startingLatitude: 28.5762, startingLongitude: 77.3618, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-7',  employeeId: 'NCR-1107', name: 'Harsh',           phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Delhi',     zone: 'Dwarka Sec 03',   specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Dwarka Sec 03',   startingLatitude: 28.5921, startingLongitude: 77.0460, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-8',  employeeId: 'NCR-1108', name: 'Shivam Gupta',   phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Delhi',     zone: 'Jaitpur',         specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Jaitpur',         startingLatitude: 28.5048, startingLongitude: 77.3012, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-9',  employeeId: 'NCR-1109', name: 'Pramond',         phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Delhi',     zone: 'Basantpur',       specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Basantpur',       startingLatitude: 28.5553, startingLongitude: 77.2011, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-10', employeeId: 'NCR-1110', name: 'Neeraj',          phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Gurugram',  zone: 'Gurgaon Sec 110', specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Gurgaon Sec 110', startingLatitude: 28.3882, startingLongitude: 77.0650, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-11', employeeId: 'NCR-1111', name: 'Sujeet',          phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Gurugram',  zone: 'Manesar',         specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Manesar',         startingLatitude: 28.3580, startingLongitude: 77.1534, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-12', employeeId: 'NCR-1112', name: 'Abhishek Thakur', phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Gurugram',  zone: 'Manesar',         specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Manesar',         startingLatitude: 28.3595, startingLongitude: 77.1550, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-13', employeeId: 'NCR-1113', name: 'Aashish',         phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Gurugram',  zone: 'Manesar',         specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Manesar',         startingLatitude: 28.3565, startingLongitude: 77.1518, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
  { id: 'tech-ncr-14', employeeId: 'NCR-1114', name: 'Avnish',          phone: '', role: 'Field Engineer', vendor: 'In-House Ops', city: 'Gurugram',  zone: 'Manesar',         specialisation: 'General Fleet', status: 'Active', joinedDate: '2026-10-09', notes: 'Base: Manesar',         startingLatitude: 28.3610, startingLongitude: 77.1560, defaultDc: '', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z' },
];

const INITIAL_TICKETS: Ticket[] = [
  { id: 't-101', ticketId: 'INC-701', vehicleNumber: 'DL01EV1024', vendor: 'Zen', location: 'West Delhi', centerName: 'Delhi_PatelNagar_D', issue: 'Controller communication failure / vehicle limp mode', category: 'Electrical', status: 'Open', priority: 'CRITICAL', affectedSpare: 'Controller 48V', issueType: 'Breakdown', assignedTechnicianId: 'tech-1', assignedTechnicianName: 'Rajesh Sharma', createdAt: '2026-10-07T08:30:00Z', updatedAt: '2026-10-07T08:30:00Z' },
  { id: 't-102', ticketId: 'INC-702', vehicleNumber: 'UP16EV4482', vendor: 'Switch', location: 'Noida', centerName: 'Noida_Sector83_D', issue: 'BLDC motor phase short circuit, high vibration', category: 'Mechanical', status: 'Open', priority: 'HIGH', affectedSpare: 'Hub Motor Assembly', issueType: 'Breakdown', assignedTechnicianId: 'tech-2', assignedTechnicianName: 'Vikram Singh', createdAt: '2026-10-07T09:15:00Z', updatedAt: '2026-10-07T09:15:00Z' },
  { id: 't-103', ticketId: 'INC-703', vehicleNumber: 'DL04EV8890', vendor: 'Zen', location: 'South Delhi', centerName: 'Delhi_OkhlaPhase3_D', issue: 'BMS cut-off under 40% SoC, cell delta >150mV', category: 'Battery', status: 'Assigned', priority: 'HIGH', affectedSpare: 'BMS Module', issueType: 'Breakdown', assignedTechnicianId: 'tech-3', assignedTechnicianName: 'Sunil Kumar Yadav', createdAt: '2026-10-07T09:40:00Z', updatedAt: '2026-10-07T09:40:00Z' },
  { id: 't-104', ticketId: 'INC-704', vehicleNumber: 'HR26EV3012', vendor: 'Zen', location: 'Gurugram', centerName: 'Gurugram_UdyogVihar_D', issue: 'Throttle potentiometer erratic response', category: 'Electrical', status: 'Open', priority: 'MEDIUM', affectedSpare: 'Throttle Sensor', issueType: 'Periodic', assignedTechnicianId: 'tech-4', assignedTechnicianName: 'Mohammad Tariq', createdAt: '2026-10-07T10:10:00Z', updatedAt: '2026-10-07T10:10:00Z' },
  { id: 't-105', ticketId: 'INC-705', vehicleNumber: 'DL01EV9911', vendor: 'Zen', location: 'West Delhi', centerName: 'Delhi_Naraina_D', issue: 'Brake cut-off switch loose contact', category: 'Mechanical', status: 'Open', priority: 'LOW', affectedSpare: 'Brake Switch', issueType: 'Periodic', createdAt: '2026-10-07T10:30:00Z', updatedAt: '2026-10-07T10:30:00Z' },
];

const INITIAL_IMPORT_JOBS: ImportJob[] = [
  { id: 'job-init-1', importType: 'CENTER_CSV', fileName: 'delhi_ncr_master_centers_oct2026.csv', uploadedBy: 'chandanchatterjee4455@gmail.com', uploadedAt: '2026-10-07 09:00:00', totalRows: 6, insertedRows: 6, updatedRows: 0, skippedRows: 0, failedRows: 0, status: 'COMPLETED', observations: ['All 6 Delhi NCR centers geocoded and verified'] },
  { id: 'job-init-2', importType: 'TICKET_CSV', fileName: 'daily_fleet_open_tickets_07oct.csv', uploadedBy: 'chandanchatterjee4455@gmail.com', uploadedAt: '2026-10-07 10:45:00', totalRows: 5, insertedRows: 5, updatedRows: 0, skippedRows: 0, failedRows: 0, status: 'COMPLETED', newHighPriorityCount: 3, observations: ['5 tickets ingested with 3 critical/high breakdown cases'] },
];

// ─────────────────────────────────────────────────────────────────
// REACTIVITY
// ─────────────────────────────────────────────────────────────────
type StorageListener = () => void;
const listeners = new Set<StorageListener>();

export function subscribeToDataChanges(cb: StorageListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  listeners.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
}

// ─────────────────────────────────────────────────────────────────
// LOCALSTORAGE HELPERS (synchronous primary store)
// ─────────────────────────────────────────────────────────────────
function lsGet<T>(key: string, def: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : def; } catch { return def; }
}
function lsSet<T>(key: string, val: T): void {
  try { localStorage.setItem(key, JSON.stringify(val)); notify(); } catch (e) { console.error(e); }
}

// ─────────────────────────────────────────────────────────────────
// SUPABASE MAPPERS
// ─────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toCenter = (r: any): Center => ({ id: r.id, name: r.name, normalizedName: r.normalized_name, city: r.city, latitude: r.latitude, longitude: r.longitude, defaultDc: r.default_dc, active: r.active, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at });
const fromCenter = (c: Center) => ({ id: c.id, name: c.name, normalized_name: c.normalizedName, city: c.city, latitude: c.latitude, longitude: c.longitude, default_dc: c.defaultDc, active: c.active, notes: c.notes, created_at: c.createdAt, updated_at: c.updatedAt });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toTech = (r: any): Technician => ({ id: r.id, employeeId: r.employee_id, name: r.name, phone: r.phone, alternatePhone: r.alternate_phone, role: r.role, vendor: r.vendor, city: r.city, zone: r.zone, specialisation: r.specialisation, status: r.status, joinedDate: r.joined_date, assignedStm: r.assigned_stm, notes: r.notes, startingLatitude: r.starting_latitude, startingLongitude: r.starting_longitude, defaultDc: r.default_dc, createdAt: r.created_at, updatedAt: r.updated_at });
const fromTech = (t: Technician) => ({ id: t.id, employee_id: t.employeeId, name: t.name, phone: t.phone, alternate_phone: t.alternatePhone ?? '', role: t.role, vendor: t.vendor ?? '', city: t.city, zone: t.zone ?? '', specialisation: t.specialisation, status: t.status, joined_date: t.joinedDate ?? null, assigned_stm: t.assignedStm ?? '', notes: t.notes ?? '', starting_latitude: t.startingLatitude ?? null, starting_longitude: t.startingLongitude ?? null, default_dc: t.defaultDc ?? '', created_at: t.createdAt, updated_at: t.updatedAt });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toTicket = (r: any): Ticket => ({ id: r.id, ticketId: r.ticket_id, vehicleNumber: r.vehicle_number, vendor: r.vendor, location: r.location, centerName: r.center_name, issue: r.issue, category: r.category, status: r.status, priority: r.priority, affectedSpare: r.affected_spare, issueType: r.issue_type, assignedTechnicianId: r.assigned_technician_id, assignedTechnicianName: r.assigned_technician_name, scheduledSlot: r.scheduled_slot, isNew: r.is_new, createdAt: r.created_at, updatedAt: r.updated_at });
const fromTicket = (t: Ticket) => ({ id: t.id, ticket_id: t.ticketId, vehicle_number: t.vehicleNumber, vendor: t.vendor ?? '', location: t.location ?? '', center_name: t.centerName, issue: t.issue, category: t.category ?? '', status: t.status, priority: t.priority, affected_spare: t.affectedSpare ?? '', issue_type: t.issueType ?? '', assigned_technician_id: t.assignedTechnicianId ?? null, assigned_technician_name: t.assignedTechnicianName ?? null, scheduled_slot: t.scheduledSlot ?? null, is_new: t.isNew ?? false, created_at: t.createdAt, updated_at: t.updatedAt });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toAtt = (r: any): AttendanceRecord => ({ id: r.id, employeeId: r.employee_id, technicianName: r.technician_name, date: r.date, status: r.status, checkInTime: r.check_in_time, checkOutTime: r.check_out_time, notes: r.notes, verifiedBy: r.verified_by, updatedAt: r.updated_at });
const fromAtt = (a: AttendanceRecord) => ({ id: a.id, employee_id: a.employeeId, technician_name: a.technicianName, date: a.date, status: a.status, check_in_time: a.checkInTime ?? '', check_out_time: a.checkOutTime ?? '', notes: a.notes ?? '', verified_by: a.verifiedBy ?? 'System Admin', updated_at: a.updatedAt });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toJob = (r: any): ImportJob => ({ id: r.id, importType: r.import_type, fileName: r.file_name, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at, totalRows: r.total_rows, insertedRows: r.inserted_rows, updatedRows: r.updated_rows, skippedRows: r.skipped_rows, failedRows: r.failed_rows, status: r.status, errors: r.errors ?? [], observations: r.observations ?? [], newHighPriorityCount: r.new_high_priority_count ?? 0, missingCentersFound: r.missing_centers_found ?? [] });
const fromJob = (j: ImportJob) => ({ id: j.id, import_type: j.importType, file_name: j.fileName, uploaded_by: j.uploadedBy, uploaded_at: j.uploadedAt, total_rows: j.totalRows, inserted_rows: j.insertedRows, updated_rows: j.updatedRows, skipped_rows: j.skippedRows, failed_rows: j.failedRows, status: j.status, errors: j.errors ?? [], observations: j.observations ?? [], new_high_priority_count: j.newHighPriorityCount ?? 0, missing_centers_found: j.missingCentersFound ?? [] });

// ─────────────────────────────────────────────────────────────────
// SUPABASE BACKGROUND SYNC
// Pulls data from Supabase into localStorage on app start (once).
// All writes go to localStorage first, then replicate to Supabase silently.
// ─────────────────────────────────────────────────────────────────
async function pullFromSupabase(): Promise<void> {
  if (!isDbEnabled()) return;
  const db = supabase!;
  try {
    const [c, t, tk, a, j] = await Promise.all([
      db.from('centers').select('*').order('name'),
      db.from('technicians').select('*').order('name'),
      db.from('tickets').select('*').order('created_at', { ascending: false }),
      db.from('attendance').select('*').order('date', { ascending: false }),
      db.from('import_jobs').select('*').order('uploaded_at', { ascending: false }),
    ]);

    if (c.data?.length) lsSet(STORAGE_KEYS.CENTERS, c.data.map(toCenter));
    else if (!c.data?.length) {
      // seed centers
      await db.from('centers').insert(INITIAL_CENTERS.map(fromCenter));
    }

    if (t.data?.length) lsSet(STORAGE_KEYS.TECHNICIANS, t.data.map(toTech));
    else await db.from('technicians').insert(INITIAL_TECHNICIANS.map(fromTech));

    if (tk.data?.length) lsSet(STORAGE_KEYS.TICKETS, tk.data.map(toTicket));
    else await db.from('tickets').insert(INITIAL_TICKETS.map(fromTicket));

    if (a.data?.length) lsSet(STORAGE_KEYS.ATTENDANCE, a.data.map(toAtt));

    if (j.data?.length) lsSet(STORAGE_KEYS.IMPORT_JOBS, j.data.map(toJob));
    else await db.from('import_jobs').insert(INITIAL_IMPORT_JOBS.map(fromJob));

    localStorage.setItem(STORAGE_KEYS.DB_LOADED, '1');
    notify();
    console.log('[FleetOps] Supabase sync complete ✓');
  } catch (err) {
    console.error('[FleetOps] Supabase pull failed, using localStorage:', err);
  }
}

// Fire and forget on module load
pullFromSupabase();

// Helper: push a single record to Supabase silently
function pushToDb(table: string, row: object, conflict: string) {
  if (!isDbEnabled()) return;
  supabase!.from(table).upsert(row, { onConflict: conflict }).then(({ error }) => {
    if (error) console.error(`[FleetOps] Supabase upsert ${table}:`, error.message);
  });
}
function deleteFromDb(table: string, id: string) {
  if (!isDbEnabled()) return;
  supabase!.from(table).delete().eq('id', id).then(({ error }) => {
    if (error) console.error(`[FleetOps] Supabase delete ${table}:`, error.message);
  });
}

// ─────────────────────────────────────────────────────────────────
// CENTERS  (synchronous)
// ─────────────────────────────────────────────────────────────────
export function getCenters(): Center[] {
  return lsGet<Center[]>(STORAGE_KEYS.CENTERS, INITIAL_CENTERS);
}
export function saveCenters(centers: Center[]): void {
  lsSet(STORAGE_KEYS.CENTERS, centers);
}
export function findCenterByName(name: string): Center | undefined {
  const n = normalizeCenterName(name);
  return getCenters().find(c => c.normalizedName === n || normalizeCenterName(c.name) === n);
}
export function upsertCenter(input: Partial<Center> & { name: string; latitude: number; longitude: number }): { center: Center; isNew: boolean } {
  const now = new Date().toISOString();
  const normalized = normalizeCenterName(input.name);
  const centers = getCenters();
  const idx = centers.findIndex(c => c.normalizedName === normalized);
  if (idx >= 0) {
    const updated: Center = { ...centers[idx], ...input, normalizedName: normalized, updatedAt: now };
    centers[idx] = updated;
    saveCenters(centers);
    pushToDb('centers', fromCenter(updated), 'id');
    return { center: updated, isNew: false };
  }
  const newCenter: Center = { id: input.id || `dc-${Date.now()}`, name: input.name.trim(), normalizedName: normalized, city: input.city || 'Delhi', latitude: Number(input.latitude), longitude: Number(input.longitude), defaultDc: input.defaultDc || `${input.name} DC`, active: input.active !== undefined ? Boolean(input.active) : true, notes: input.notes || '', createdAt: now, updatedAt: now };
  centers.push(newCenter);
  saveCenters(centers);
  pushToDb('centers', fromCenter(newCenter), 'id');
  return { center: newCenter, isNew: true };
}
export function deleteCenter(id: string): void {
  saveCenters(getCenters().filter(c => c.id !== id));
  deleteFromDb('centers', id);
}

// ─────────────────────────────────────────────────────────────────
// TECHNICIANS  (synchronous)
// ─────────────────────────────────────────────────────────────────
export function getTechnicians(): Technician[] {
  return lsGet<Technician[]>(STORAGE_KEYS.TECHNICIANS, INITIAL_TECHNICIANS);
}
export function saveTechnicians(technicians: Technician[]): void {
  lsSet(STORAGE_KEYS.TECHNICIANS, technicians);
}
export function findTechnicianByEmployeeId(empId: string): Technician | undefined {
  if (!empId) return undefined;
  const clean = empId.trim().toUpperCase();
  return getTechnicians().find(t => t.employeeId.trim().toUpperCase() === clean);
}
export function upsertTechnician(input: Partial<Technician> & { employeeId: string; name: string }): { technician: Technician; isNew: boolean } {
  const now = new Date().toISOString();
  const cleanEmpId = input.employeeId.trim().toUpperCase();
  const techs = getTechnicians();
  const idx = techs.findIndex(t => t.employeeId.trim().toUpperCase() === cleanEmpId);
  if (idx >= 0) {
    const updated: Technician = { ...techs[idx], ...input, employeeId: cleanEmpId, updatedAt: now };
    techs[idx] = updated;
    saveTechnicians(techs);
    pushToDb('technicians', fromTech(updated), 'id');
    return { technician: updated, isNew: false };
  }
  const newTech: Technician = { id: input.id || `tech-${Date.now()}`, employeeId: cleanEmpId, name: input.name.trim(), phone: input.phone || '', alternatePhone: input.alternatePhone || '', role: input.role || 'Field Engineer', vendor: input.vendor || 'In-House Ops', city: input.city || 'Delhi', zone: input.zone || 'Central', specialisation: input.specialisation || 'General Fleet', status: input.status || 'Active', joinedDate: input.joinedDate || now.split('T')[0], assignedStm: input.assignedStm || '', notes: input.notes || '', startingLatitude: input.startingLatitude, startingLongitude: input.startingLongitude, defaultDc: input.defaultDc || '', createdAt: now, updatedAt: now };
  techs.push(newTech);
  saveTechnicians(techs);
  pushToDb('technicians', fromTech(newTech), 'id');
  return { technician: newTech, isNew: true };
}
export function deleteTechnician(id: string): void {
  saveTechnicians(getTechnicians().filter(t => t.id !== id));
  deleteFromDb('technicians', id);
}

// ─────────────────────────────────────────────────────────────────
// TICKETS  (synchronous)
// ─────────────────────────────────────────────────────────────────
export function getTickets(): Ticket[] {
  return lsGet<Ticket[]>(STORAGE_KEYS.TICKETS, INITIAL_TICKETS);
}
export function saveTickets(tickets: Ticket[]): void {
  lsSet(STORAGE_KEYS.TICKETS, tickets);
}
export function upsertTicket(input: Partial<Ticket> & { ticketId: string; vehicleNumber: string; centerName: string }): { ticket: Ticket; isNew: boolean } {
  const now = new Date().toISOString();
  const cleanTicketId = input.ticketId.trim().toUpperCase();
  const tickets = getTickets();
  const idx = tickets.findIndex(t => t.ticketId.trim().toUpperCase() === cleanTicketId);
  if (idx >= 0) {
    const updated: Ticket = { ...tickets[idx], ...input, ticketId: cleanTicketId, updatedAt: now };
    tickets[idx] = updated;
    saveTickets(tickets);
    pushToDb('tickets', fromTicket(updated), 'id');
    return { ticket: updated, isNew: false };
  }
  const newTicket: Ticket = { id: input.id || `ticket-${Date.now()}`, ticketId: cleanTicketId, vehicleNumber: input.vehicleNumber.trim().toUpperCase(), vendor: input.vendor || 'Zen', location: input.location || '', centerName: input.centerName.trim(), issue: input.issue || 'General Maintenance', category: input.category || 'Mechanical', status: input.status || 'Open', priority: input.priority || 'MEDIUM', affectedSpare: input.affectedSpare || '', issueType: input.issueType || 'Breakdown', assignedTechnicianId: input.assignedTechnicianId, assignedTechnicianName: input.assignedTechnicianName, scheduledSlot: input.scheduledSlot, createdAt: now, updatedAt: now, isNew: true };
  tickets.unshift(newTicket);
  saveTickets(tickets);
  pushToDb('tickets', fromTicket(newTicket), 'id');
  return { ticket: newTicket, isNew: true };
}
export function deleteTicket(id: string): void {
  saveTickets(getTickets().filter(t => t.id !== id));
  deleteFromDb('tickets', id);
}

// ─────────────────────────────────────────────────────────────────
// ATTENDANCE  (synchronous)
// ─────────────────────────────────────────────────────────────────
function defaultAttendance(): AttendanceRecord[] {
  const today = new Date().toISOString().split('T')[0];
  return [
    { id: 'att-1', employeeId: 'TECH-1001', technicianName: 'Rajesh Sharma', date: today, status: 'Present', checkInTime: '08:45', checkOutTime: '', notes: 'Morning shift reported at Central DC', verifiedBy: 'Ops Supervisor', updatedAt: new Date().toISOString() },
    { id: 'att-2', employeeId: 'TECH-1002', technicianName: 'Vikram Singh', date: today, status: 'Present', checkInTime: '09:00', checkOutTime: '', notes: 'On-site at Sector 83 DC', verifiedBy: 'Ops Supervisor', updatedAt: new Date().toISOString() },
    { id: 'att-3', employeeId: 'TECH-1003', technicianName: 'Sunil Kumar Yadav', date: today, status: 'Present', checkInTime: '08:50', notes: 'South Delhi battery bench', verifiedBy: 'Ops Supervisor', updatedAt: new Date().toISOString() },
    { id: 'att-4', employeeId: 'TECH-1004', technicianName: 'Mohammad Tariq', date: today, status: 'Present', checkInTime: '09:10', notes: 'Gurugram fleet check', verifiedBy: 'Ops Supervisor', updatedAt: new Date().toISOString() },
    { id: 'att-5', employeeId: 'TECH-1005', technicianName: 'Pooja Rawat', date: today, status: 'On Leave', notes: 'Approved sick leave', verifiedBy: 'Ops Supervisor', updatedAt: new Date().toISOString() },
  ];
}
export function getAttendance(): AttendanceRecord[] {
  return lsGet<AttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE, defaultAttendance());
}
export function saveAttendance(records: AttendanceRecord[]): void {
  lsSet(STORAGE_KEYS.ATTENDANCE, records);
}
export function upsertAttendanceRecord(record: Partial<AttendanceRecord> & { employeeId: string; date: string }): { record: AttendanceRecord; isNew: boolean } {
  const now = new Date().toISOString();
  const cleanEmpId = record.employeeId.trim().toUpperCase();
  const targetDate = record.date.trim();
  const tech = findTechnicianByEmployeeId(cleanEmpId);
  const techName = record.technicianName || tech?.name || cleanEmpId;
  const list = getAttendance();
  const idx = list.findIndex(r => r.employeeId.toUpperCase() === cleanEmpId && r.date === targetDate);
  if (idx >= 0) {
    const updated: AttendanceRecord = { ...list[idx], ...record, employeeId: cleanEmpId, technicianName: techName, date: targetDate, updatedAt: now };
    list[idx] = updated;
    saveAttendance(list);
    pushToDb('attendance', fromAtt(updated), 'id');
    return { record: updated, isNew: false };
  }
  const newRecord: AttendanceRecord = { id: record.id || `att-${Date.now()}`, employeeId: cleanEmpId, technicianName: techName, date: targetDate, status: record.status || 'Present', checkInTime: record.checkInTime || '09:00', checkOutTime: record.checkOutTime || '', notes: record.notes || '', verifiedBy: record.verifiedBy || 'System Admin', updatedAt: now };
  list.unshift(newRecord);
  saveAttendance(list);
  pushToDb('attendance', fromAtt(newRecord), 'id');
  return { record: newRecord, isNew: true };
}

// ─────────────────────────────────────────────────────────────────
// IMPORT JOBS  (synchronous)
// ─────────────────────────────────────────────────────────────────
export function getImportJobs(): ImportJob[] {
  return lsGet<ImportJob[]>(STORAGE_KEYS.IMPORT_JOBS, INITIAL_IMPORT_JOBS);
}
export function saveImportJob(job: ImportJob): void {
  const jobs = getImportJobs();
  const idx = jobs.findIndex(j => j.id === job.id);
  if (idx >= 0) jobs[idx] = job; else jobs.unshift(job);
  lsSet(STORAGE_KEYS.IMPORT_JOBS, jobs);
  pushToDb('import_jobs', fromJob(job), 'id');
}

// ─────────────────────────────────────────────────────────────────
// DATA QUALITY  (synchronous)
// ─────────────────────────────────────────────────────────────────
export function computeDataQuality(): DataQualityStats {
  const technicians = getTechnicians();
  const centers = getCenters();
  const tickets = getTickets();
  let techniciansMissingLocation = 0, centersMissingCoordinates = 0, invalidCoordinates = 0, ticketsWithoutCenter = 0, ticketsWithoutPriority = 0, ticketsWithoutAssignment = 0;
  technicians.forEach(t => { if (!t.startingLatitude || !t.startingLongitude || !isValidLatitude(t.startingLatitude) || !isValidLongitude(t.startingLongitude)) techniciansMissingLocation++; });
  centers.forEach(c => { if (c.latitude === undefined || c.longitude === undefined || isNaN(c.latitude) || isNaN(c.longitude)) centersMissingCoordinates++; else if (!isValidLatitude(c.latitude) || !isValidLongitude(c.longitude)) invalidCoordinates++; });
  tickets.forEach(tk => { if (!tk.centerName?.trim()) ticketsWithoutCenter++; if (!tk.priority) ticketsWithoutPriority++; if (!tk.assignedTechnicianId && tk.status !== 'Resolved' && tk.status !== 'Closed') ticketsWithoutAssignment++; });
  return { techniciansMissingLocation, centersMissingCoordinates, ticketsWithoutCenter, ticketsWithoutPriority, ticketsWithoutAssignment, invalidCoordinates };
}

// ─────────────────────────────────────────────────────────────────
// ROUTE PLANS  (localStorage only — ephemeral)
// ─────────────────────────────────────────────────────────────────
export function getRoutePlans(): TechnicianRoutePlan[] { return lsGet<TechnicianRoutePlan[]>(STORAGE_KEYS.ROUTES, []); }
export function saveRoutePlans(plans: TechnicianRoutePlan[]): void { lsSet(STORAGE_KEYS.ROUTES, plans); }

// ─────────────────────────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────────────────────────
export function resetToDemoData(): void {
  lsSet(STORAGE_KEYS.CENTERS, INITIAL_CENTERS);
  lsSet(STORAGE_KEYS.TECHNICIANS, INITIAL_TECHNICIANS);
  lsSet(STORAGE_KEYS.TICKETS, INITIAL_TICKETS);
  lsSet(STORAGE_KEYS.IMPORT_JOBS, INITIAL_IMPORT_JOBS);
  localStorage.removeItem(STORAGE_KEYS.ROUTES);
  localStorage.removeItem(STORAGE_KEYS.ATTENDANCE);
  // Also reset in Supabase
  if (isDbEnabled()) {
    const db = supabase!;
    Promise.all([
      db.from('centers').delete().neq('id', '').then(() => db.from('centers').insert(INITIAL_CENTERS.map(fromCenter))),
      db.from('technicians').delete().neq('id', '').then(() => db.from('technicians').insert(INITIAL_TECHNICIANS.map(fromTech))),
      db.from('tickets').delete().neq('id', '').then(() => db.from('tickets').insert(INITIAL_TICKETS.map(fromTicket))),
      db.from('attendance').delete().neq('id', ''),
      db.from('import_jobs').delete().neq('id', '').then(() => db.from('import_jobs').insert(INITIAL_IMPORT_JOBS.map(fromJob))),
    ]).catch(console.error);
  }
  notify();
}

// Export initDb for App.tsx to call
export async function initDb(): Promise<void> {
  await pullFromSupabase();
}
