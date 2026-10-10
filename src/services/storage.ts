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
  ImportJob, DataQualityStats, TechnicianRoutePlan, VisitLog, RouteStop,
} from '../types';
import { normalizeCenterName, isValidLatitude, isValidLongitude } from './csvParser';
import { supabase, isDbEnabled } from '../lib/supabase';
import { localDate } from '../lib/date';

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
  VISIT_LOGS: 'fleetops_visit_logs_v1',
  DB_LOADED: 'fleetops_db_loaded',
  CLUSTER_ROSTER: 'fleetops_cluster_roster_v1',
};

// ─────────────────────────────────────────────────────────────────
// INITIAL DATA  (real technicians only — no dummy data)
// ─────────────────────────────────────────────────────────────────
const INITIAL_CENTERS: Center[] = [];

const INITIAL_TECHNICIANS: Technician[] = [
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

const INITIAL_TICKETS: Ticket[] = [];

const INITIAL_IMPORT_JOBS: ImportJob[] = [];

/** Unique id — timestamps alone collide when many rows are created in one loop (CSV import, Apply attendance). */
export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

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

// Does the tickets table have the exclude_from_routing column? Only send it if so,
// otherwise every ticket save would fail. Until confirmed, the flag is kept in this browser.
let ignoreColumn: 'unknown' | 'yes' | 'no' = 'unknown';
export function ignoreSyncedToDb(): boolean { return ignoreColumn === 'yes'; }
const LOCAL_IGNORED_KEY = 'fleetops_ignored_tickets'; // ticket.id list (also used by older Hex Zone Map)
function localIgnored(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LOCAL_IGNORED_KEY) || '[]')); } catch { return new Set(); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toTicket = (r: any): Ticket => ({ id: r.id, ticketId: r.ticket_id, vehicleNumber: r.vehicle_number, vendor: r.vendor, location: r.location, centerName: r.center_name, issue: r.issue, category: r.category, status: r.status, priority: r.priority, affectedSpare: r.affected_spare, issueType: r.issue_type, assignedTechnicianId: r.assigned_technician_id, assignedTechnicianName: r.assigned_technician_name, scheduledSlot: r.scheduled_slot, isNew: r.is_new, ignoreForRouting: r.exclude_from_routing ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at });
const fromTicket = (t: Ticket) => ({ id: t.id, ticket_id: t.ticketId, vehicle_number: t.vehicleNumber, vendor: t.vendor ?? '', location: t.location ?? '', center_name: t.centerName, issue: t.issue, category: t.category ?? '', status: t.status, priority: t.priority, affected_spare: t.affectedSpare ?? '', issue_type: t.issueType ?? '', assigned_technician_id: t.assignedTechnicianId ?? null, assigned_technician_name: t.assignedTechnicianName ?? null, scheduled_slot: t.scheduledSlot ?? null, is_new: t.isNew ?? false, ...(ignoreColumn === 'yes' ? { exclude_from_routing: Boolean(t.ignoreForRouting) } : {}), created_at: t.createdAt, updated_at: t.updatedAt });

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
export type SyncStatus = 'disabled' | 'loading' | 'synced' | 'error';
export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  /** Non-fatal problems, e.g. one table missing — data from the other tables is still live. */
  warnings: string[];
  /** Most recent failed save (reading can still be fine). Cleared by the next successful save. */
  saveError: string | null;
}
let syncState: SyncState = { status: isDbEnabled() ? 'loading' : 'disabled', lastSyncedAt: null, error: null, warnings: [], saveError: null };
export function getSyncState(): SyncState { return syncState; }
function setSyncState(patch: Partial<SyncState>) { syncState = { ...syncState, ...patch }; notify(); }

// Writes still in flight — a pull must not overwrite local data with an older DB copy.
let pendingWrites = 0;
const MIGRATED_KEY = 'fleetops_db_migrated_v2'; // v2: re-run after repairing duplicate ids

/** Older versions gave records created in the same millisecond the same id. Give each its own. */
function repairDuplicateIds(): void {
  const keys: Array<[string, string]> = [
    [STORAGE_KEYS.CENTERS, 'dc'], [STORAGE_KEYS.TECHNICIANS, 'tech'],
    [STORAGE_KEYS.TICKETS, 'ticket'], [STORAGE_KEYS.ATTENDANCE, 'att'],
  ];
  for (const [key, prefix] of keys) {
    const list = rawLocal<{ id: string }>(key);
    const seen = new Set<string>();
    let fixed = 0;
    list.forEach(r => { if (seen.has(r.id)) { r.id = newId(prefix); fixed++; } seen.add(r.id); });
    if (fixed) {
      localStorage.setItem(key, JSON.stringify(list));
      console.log(`[FleetOps] Repaired ${fixed} duplicate ${prefix} ids`);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawLocal<T>(key: string): T[] { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : []; } catch { return []; } }

/**
 * One-time: upload rows that only ever lived in this browser (older versions
 * saved most edits locally only), so making the DB authoritative loses nothing.
 * Local rows win when they are missing from the DB or have a newer updatedAt.
 */
async function migrateLocalOnlyRows(): Promise<void> {
  if (localStorage.getItem(MIGRATED_KEY)) return;
  repairDuplicateIds();
  const db = supabase!;
  // table, local key, row mapper, DB columns forming the unique business key, same key from a local row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const specs: Array<{ table: string; key: string; toRow: (x: any) => object; cols: string; bizDb: (r: any) => string; bizLocal: (l: any) => string }> = [
    { table: 'centers', key: STORAGE_KEYS.CENTERS, toRow: fromCenter, cols: 'name',
      bizDb: r => String(r.name).trim().toLowerCase(), bizLocal: l => String(l.name).trim().toLowerCase() },
    { table: 'technicians', key: STORAGE_KEYS.TECHNICIANS, toRow: fromTech, cols: 'employee_id',
      bizDb: r => String(r.employee_id).toUpperCase(), bizLocal: l => String(l.employeeId).toUpperCase() },
    { table: 'tickets', key: STORAGE_KEYS.TICKETS, toRow: fromTicket, cols: 'ticket_id',
      bizDb: r => String(r.ticket_id).toUpperCase(), bizLocal: l => String(l.ticketId).toUpperCase() },
    { table: 'attendance', key: STORAGE_KEYS.ATTENDANCE, toRow: fromAtt, cols: 'employee_id, date',
      bizDb: r => `${String(r.employee_id).toUpperCase()}|${r.date}`, bizLocal: l => `${String(l.employeeId).toUpperCase()}|${l.date}` },
  ];
  for (const spec of specs) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const local = rawLocal<any>(spec.key);
      if (!local.length) continue;
      const { data, error } = await db.from(spec.table).select(`id, updated_at, ${spec.cols}`);
      if (error) throw error;
      const remoteById = new Map((data ?? []).map((r: any) => [r.id, r.updated_at as string]));
      const remoteBiz = new Map((data ?? []).map((r: any) => [spec.bizDb(r), r.id as string]));
      const seen = new Set<string>();
      const toPush = local.filter(l => {
        const biz = spec.bizLocal(l);
        if (seen.has(biz)) return false;                 // duplicate within local data
        seen.add(biz);
        const dbIdForBiz = remoteBiz.get(biz);
        if (dbIdForBiz && dbIdForBiz !== l.id) return false; // same record exists in DB under another id → DB wins
        if (!remoteById.has(l.id)) return true;          // only exists locally
        return Boolean(l.updatedAt && l.updatedAt > (remoteById.get(l.id) ?? ''));
      });
      if (toPush.length) {
        const { error: upErr } = await db.from(spec.table).upsert(toPush.map(spec.toRow), { onConflict: 'id' });
        if (upErr) throw upErr;
        console.log(`[FleetOps] Uploaded ${toPush.length} local-only ${spec.table} rows to Supabase`);
      }
    } catch (e) {
      // Never block syncing on this one-time cleanup — the DB copy is used as-is.
      console.warn(`[FleetOps] Skipped uploading local ${spec.table} rows:`, (e as { message?: string })?.message ?? e);
    }
  }
  localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
}

let pulling = false;
/** Pull everything from Supabase. The database is the source of truth: empty tables clear the local copy. */
export async function refreshFromDb(): Promise<void> {
  if (!isDbEnabled() || pulling) return;
  if (pendingWrites > 0) { setTimeout(refreshFromDb, 1500); return; }
  pulling = true;
  const db = supabase!;
  try {
    await migrateLocalOnlyRows();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables: Array<{ table: string; key: string; map: (r: any) => unknown; order: string; asc: boolean; core: boolean }> = [
      { table: 'centers',     key: STORAGE_KEYS.CENTERS,     map: toCenter,   order: 'name',        asc: true,  core: true },
      { table: 'technicians', key: STORAGE_KEYS.TECHNICIANS, map: toTech,     order: 'name',        asc: true,  core: true },
      { table: 'tickets',     key: STORAGE_KEYS.TICKETS,     map: toTicket,   order: 'created_at',  asc: false, core: true },
      { table: 'attendance',  key: STORAGE_KEYS.ATTENDANCE,  map: toAtt,      order: 'date',        asc: false, core: true },
      { table: 'import_jobs', key: STORAGE_KEYS.IMPORT_JOBS, map: toJob,      order: 'uploaded_at', asc: false, core: false },
      { table: 'visit_logs',  key: STORAGE_KEYS.VISIT_LOGS,  map: toVisitLog, order: 'created_at',  asc: false, core: false },
    ];
    const results = await Promise.all(tables.map(t => db.from(t.table).select('*').order(t.order, { ascending: t.asc })));
    if (pendingWrites > 0) { pulling = false; setTimeout(refreshFromDb, 1500); return; } // a write started mid-pull

    const coreErrors: string[] = [];
    const warnings: string[] = [];
    results.forEach((res, idx) => {
      const t = tables[idx];
      if (res.error) {
        const msg = `${t.table}: ${res.error.message}`;
        console.error('[FleetOps] Supabase read failed —', msg);
        (t.core ? coreErrors : warnings).push(msg);
        return; // keep the cached copy of this table
      }
      writeLocal(t.key, (res.data ?? []).map(t.map));
    });
    // Detect the exclude_from_routing column
    if (ignoreColumn !== 'yes') {
      const tkRes = results[tables.findIndex(t => t.table === 'tickets')];
      let has: boolean;
      if (!tkRes.error && tkRes.data && tkRes.data.length) has = 'exclude_from_routing' in tkRes.data[0];
      else has = !(await db.from('tickets').select('exclude_from_routing').limit(1)).error;
      ignoreColumn = has ? 'yes' : 'no';
      if (has) {
        // Move ignore flags kept in this browser onto the tickets in the database
        const local = localIgnored();
        if (local.size) {
          const list = lsGet<Ticket[]>(STORAGE_KEYS.TICKETS, []);
          saveTickets(list.map(t => (local.has(t.id) && !t.ignoreForRouting ? { ...t, ignoreForRouting: true, updatedAt: new Date().toISOString() } : t)));
          localStorage.removeItem(LOCAL_IGNORED_KEY);
        }
      }
      notify();
    }
    localStorage.setItem(STORAGE_KEYS.DB_LOADED, '1');
    if (coreErrors.length) {
      setSyncState({ status: 'error', error: coreErrors.join('; '), warnings });
    } else {
      setSyncState({ status: 'synced', lastSyncedAt: new Date().toISOString(), error: null, warnings });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
    console.error('[FleetOps] Supabase pull failed, showing cached data:', msg);
    setSyncState({ status: 'error', error: msg });
  } finally {
    pulling = false;
  }
}

/** Write to localStorage only if the content actually changed (avoids needless re-renders). */
function writeLocal<T>(key: string, val: T): void {
  try {
    const next = JSON.stringify(val);
    if (localStorage.getItem(key) === next) return;
    localStorage.setItem(key, next);
    notify();
  } catch (e) { console.error(e); }
}

/** Upsert rows that are new/changed and delete rows that were removed, in two batched calls. */
function syncListToDb<T extends { id: string }>(table: string, prev: T[], next: T[], toRow: (x: T) => object) {
  if (!isDbEnabled()) return;
  const prevById = new Map(prev.map(p => [p.id, JSON.stringify(p)]));
  const nextIds = new Set(next.map(n => n.id));
  // one row per id (Postgres rejects an upsert that touches the same row twice)
  const changedById = new Map<string, T>();
  next.forEach(n => { if (prevById.get(n.id) !== JSON.stringify(n)) changedById.set(n.id, n); });
  const changed = [...changedById.values()];
  const removed = prev.filter(p => !nextIds.has(p.id)).map(p => p.id);
  const db = supabase!;
  const done = (what: string) => ({ error }: { error: { message: string } | null }) => {
    pendingWrites--;
    if (error) {
      console.error(`[FleetOps] Supabase ${what} ${table}:`, error.message);
      setSyncState({ saveError: `Couldn't save ${table}: ${error.message}` });
    } else if (syncState.saveError) {
      setSyncState({ saveError: null });
    }
  };
  if (changed.length) {
    pendingWrites++;
    db.from(table).upsert(changed.map(toRow), { onConflict: 'id' }).then(done('upsert'));
  }
  if (removed.length) {
    pendingWrites++;
    db.from(table).delete().in('id', removed).then(done('delete'));
  }
}

// Initial load, then keep the local copy current:
//  • realtime push from Supabase (if Realtime is enabled on the tables)
//  • every 60 s while the tab is visible, and whenever the tab regains focus
if (isDbEnabled() && typeof window !== 'undefined') {
  refreshFromDb();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { clearTimeout(debounce); debounce = setTimeout(refreshFromDb, 800); };
  try {
    supabase!.channel('fleetops-db')
      .on('postgres_changes', { event: '*', schema: 'public' }, soon)
      .subscribe();
  } catch (e) { console.warn('[FleetOps] Realtime unavailable, polling only', e); }
  setInterval(() => { if (document.visibilityState === 'visible') refreshFromDb(); }, 60_000);
  window.addEventListener('focus', soon);
}

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
  const prev = lsGet<Center[]>(STORAGE_KEYS.CENTERS, []);
  lsSet(STORAGE_KEYS.CENTERS, centers);
  syncListToDb('centers', prev, centers, fromCenter);
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
    return { center: updated, isNew: false };
  }
  const newCenter: Center = { id: input.id || newId('dc'), name: input.name.trim(), normalizedName: normalized, city: input.city || 'Delhi', latitude: Number(input.latitude), longitude: Number(input.longitude), defaultDc: input.defaultDc || `${input.name} DC`, active: input.active !== undefined ? Boolean(input.active) : true, notes: input.notes || '', createdAt: now, updatedAt: now };
  centers.push(newCenter);
  saveCenters(centers);
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
  return lsGet<Technician[]>(STORAGE_KEYS.TECHNICIANS, isDbEnabled() ? [] : INITIAL_TECHNICIANS);
}
export function saveTechnicians(technicians: Technician[]): void {
  const prev = lsGet<Technician[]>(STORAGE_KEYS.TECHNICIANS, []);
  lsSet(STORAGE_KEYS.TECHNICIANS, technicians);
  syncListToDb('technicians', prev, technicians, fromTech);
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
    return { technician: updated, isNew: false };
  }
  const newTech: Technician = { id: input.id || newId('tech'), employeeId: cleanEmpId, name: input.name.trim(), phone: input.phone || '', alternatePhone: input.alternatePhone || '', role: input.role || 'Field Engineer', vendor: input.vendor || 'In-House Ops', city: input.city || 'Delhi', zone: input.zone || 'Central', specialisation: input.specialisation || 'General Fleet', status: input.status || 'Active', joinedDate: input.joinedDate || now.split('T')[0], assignedStm: input.assignedStm || '', notes: input.notes || '', startingLatitude: input.startingLatitude, startingLongitude: input.startingLongitude, defaultDc: input.defaultDc || '', createdAt: now, updatedAt: now };
  techs.push(newTech);
  saveTechnicians(techs);
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
  const raw = lsGet<Ticket[]>(STORAGE_KEYS.TICKETS, INITIAL_TICKETS);
  // Assignee name always comes from the technician record (one source of truth)
  const techName = new Map(lsGet<Technician[]>(STORAGE_KEYS.TECHNICIANS, []).map(t => [t.id, t.name]));
  const list = raw.map(t => {
    const n = t.assignedTechnicianId ? techName.get(t.assignedTechnicianId) : undefined;
    return n && n !== t.assignedTechnicianName ? { ...t, assignedTechnicianName: n } : t;
  });
  if (ignoreColumn === 'yes') return list;
  const local = localIgnored();
  return list.map(t => (Boolean(t.ignoreForRouting) === local.has(t.id) ? t : { ...t, ignoreForRouting: local.has(t.id) }));
}

/** Open tickets that route planners should schedule. */
export function isRoutable(t: Ticket): boolean {
  return t.status !== 'Resolved' && t.status !== 'Closed' && !t.ignoreForRouting;
}

/** Ignore (or stop ignoring) tickets for route planning. Synced to the database when the column exists. */
export function setTicketsIgnored(ticketIds: string[], ignored: boolean): void {
  const ids = new Set(ticketIds);
  if (ignoreColumn === 'yes') {
    saveTickets(getTickets().map(t => (ids.has(t.id) && Boolean(t.ignoreForRouting) !== ignored ? { ...t, ignoreForRouting: ignored, updatedAt: new Date().toISOString() } : t)));
    return;
  }
  const local = localIgnored();
  ids.forEach(id => (ignored ? local.add(id) : local.delete(id)));
  try { localStorage.setItem(LOCAL_IGNORED_KEY, JSON.stringify([...local])); } catch { /* ignore */ }
  notify();
}
export function getIgnoredTicketIds(): Set<string> {
  return new Set(getTickets().filter(t => t.ignoreForRouting).map(t => t.id));
}
export function saveTickets(tickets: Ticket[]): void {
  const prev = lsGet<Ticket[]>(STORAGE_KEYS.TICKETS, []);
  lsSet(STORAGE_KEYS.TICKETS, tickets);
  syncListToDb('tickets', prev, tickets, fromTicket);
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
    return { ticket: updated, isNew: false };
  }
  const newTicket: Ticket = { id: input.id || newId('ticket'), ticketId: cleanTicketId, vehicleNumber: input.vehicleNumber.trim().toUpperCase(), vendor: input.vendor || 'Zen', location: input.location || '', centerName: input.centerName.trim(), issue: input.issue || 'General Maintenance', category: input.category || 'Mechanical', status: input.status || 'Open', priority: input.priority || 'MEDIUM', affectedSpare: input.affectedSpare || '', issueType: input.issueType || 'Breakdown', assignedTechnicianId: input.assignedTechnicianId, assignedTechnicianName: input.assignedTechnicianName, scheduledSlot: input.scheduledSlot, createdAt: now, updatedAt: now, isNew: true };
  tickets.unshift(newTicket);
  saveTickets(tickets);
  return { ticket: newTicket, isNew: true };
}
export function deleteTicket(id: string): void {
  saveTickets(getTickets().filter(t => t.id !== id));
  deleteFromDb('tickets', id);
}

/** Remove all Resolved/Closed tickets from localStorage AND Supabase in one shot. */
export async function clearResolvedTickets(): Promise<{ removed: number; error?: string }> {
  const all = getTickets();
  const kept = all.filter(t => t.status !== 'Resolved' && t.status !== 'Closed');
  const removedIds = all.filter(t => t.status === 'Resolved' || t.status === 'Closed').map(t => t.id);
  // Update local store immediately
  lsSet(STORAGE_KEYS.TICKETS, kept);
  notify();
  if (removedIds.length === 0) return { removed: 0 };
  // Direct bulk delete in Supabase (single round-trip)
  if (isDbEnabled()) {
    const { error } = await supabase!.from('tickets').delete().in('status', ['Resolved', 'Closed']);
    if (error) {
      console.error('[FleetOps] clearResolvedTickets:', error.message);
      return { removed: removedIds.length, error: error.message };
    }
  }
  return { removed: removedIds.length };
}

// ─────────────────────────────────────────────────────────────────
// ATTENDANCE  (synchronous)
// ─────────────────────────────────────────────────────────────────
export function getAttendance(): AttendanceRecord[] {
  return lsGet<AttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE, []);
}
export function saveAttendance(records: AttendanceRecord[]): void {
  const prev = lsGet<AttendanceRecord[]>(STORAGE_KEYS.ATTENDANCE, []);
  lsSet(STORAGE_KEYS.ATTENDANCE, records);
  syncListToDb('attendance', prev, records, fromAtt);
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
    return { record: updated, isNew: false };
  }
  const newRecord: AttendanceRecord = { id: record.id || newId('att'), employeeId: cleanEmpId, technicianName: techName, date: targetDate, status: record.status || 'Present', checkInTime: record.checkInTime || '09:00', checkOutTime: record.checkOutTime || '', notes: record.notes || '', verifiedBy: record.verifiedBy || 'System Admin', updatedAt: now };
  list.unshift(newRecord);
  saveAttendance(list);
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
// Route plans are kept consistent with tickets: the ticket's assignee and status are the truth.
function roadKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, t = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * t / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin((lon2 - lon1) * t / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) * 1.3;
}
function withTotals(plan: TechnicianRoutePlan): TechnicianRoutePlan {
  let km = 0, lat = plan.startLat, lng = plan.startLng;
  const stops = plan.stops.map((s, i) => {
    km += roadKm(lat, lng, s.latitude, s.longitude); lat = s.latitude; lng = s.longitude;
    return s.stopOrder === i + 1 ? s : { ...s, stopOrder: i + 1 };
  });
  return { ...plan, stops, totalDistanceKm: Math.round(km * 10) / 10,
    totalEstimatedMins: stops.reduce((a, s) => a + (s.estimatedDurationMins || 45), 0) + Math.round(km * 2.5) };
}

/**
 * Saved route plans, reconciled with the tickets:
 *  • a stop whose ticket now belongs to another technician moves to that technician's route
 *  • a stop whose ticket was unassigned, deleted or ignored is dropped
 *  • open tickets assigned to a technician but missing from every plan are appended
 *  • every stop carries the ticket's live status, priority and details
 */
export function getRoutePlans(): TechnicianRoutePlan[] {
  const stored = lsGet<TechnicianRoutePlan[]>(STORAGE_KEYS.ROUTES, []);
  const tickets = getTickets();
  const byTicketId = new Map(tickets.map(t => [t.ticketId, t]));
  const techs = new Map(getTechnicians().map(t => [t.id, t]));
  const centers = new Map(getCenters().map(c => [c.name.trim().toLowerCase(), c]));

  const plans = new Map<string, TechnicianRoutePlan>();
  const ensurePlan = (techId: string): TechnicianRoutePlan | null => {
    if (plans.has(techId)) return plans.get(techId)!;
    const tech = techs.get(techId);
    if (!tech || tech.startingLatitude == null || tech.startingLongitude == null) return null;
    const plan: TechnicianRoutePlan = { technicianId: tech.id, technicianName: tech.name, employeeId: tech.employeeId,
      startLat: tech.startingLatitude, startLng: tech.startingLongitude, defaultDc: tech.defaultDc ?? '',
      stops: [], totalDistanceKm: 0, totalEstimatedMins: 0, status: 'Draft' };
    plans.set(techId, plan);
    return plan;
  };
  stored.forEach(p => { if (techs.has(p.technicianId)) plans.set(p.technicianId, { ...p, technicianName: techs.get(p.technicianId)!.name, stops: [] }); });

  const placed = new Set<string>();
  const place = (stop: RouteStop, t: Ticket) => {
    if (!t.assignedTechnicianId || t.ignoreForRouting || placed.has(t.ticketId)) return;
    const plan = ensurePlan(t.assignedTechnicianId);
    if (!plan) return;
    placed.add(t.ticketId);
    plan.stops.push({ ...stop, ticketId: t.ticketId, vehicleNumber: t.vehicleNumber, centerName: t.centerName,
      issue: t.issue, priority: t.priority, ticketStatus: t.status });
  };
  // 1. existing stops, in their saved order, follow their ticket
  stored.forEach(p => p.stops.forEach(s => { const t = byTicketId.get(s.ticketId); if (t) place(s, t); }));
  // 2. assigned tickets that no plan contains yet: open ones, plus ones finished today (shown as done)
  const today = localDate();
  const doneToday = (t: Ticket) => (t.status === 'Resolved' || t.status === 'Closed') && Boolean(t.updatedAt) && localDate(new Date(t.updatedAt)) === today;
  tickets.filter(t => t.assignedTechnicianId && !placed.has(t.ticketId) && ((t.status !== 'Resolved' && t.status !== 'Closed') || doneToday(t)))
    .forEach(t => {
      const c = centers.get(t.centerName.trim().toLowerCase());
      if (!c) return;
      place({ stopOrder: 0, ticketId: t.ticketId, centerName: t.centerName, vehicleNumber: t.vehicleNumber, issue: t.issue,
        priority: t.priority, latitude: c.latitude, longitude: c.longitude, estimatedArrival: t.scheduledSlot || '—',
        estimatedDurationMins: t.priority === 'CRITICAL' ? 60 : 45 }, t);
    });
  return [...plans.values()].filter(p => p.stops.length > 0).map(withTotals);
}

/** Save route plans and make the tickets match them (assign stops; unassign removed stops). */
export function saveRoutePlans(plans: TechnicianRoutePlan[]): void {
  const previous = lsGet<TechnicianRoutePlan[]>(STORAGE_KEYS.ROUTES, []);
  lsSet(STORAGE_KEYS.ROUTES, plans);
  const techs = new Map(getTechnicians().map(t => [t.id, t]));
  const want = new Map<string, string>(); // ticketId → techId
  plans.forEach(p => p.stops.forEach(s => want.set(s.ticketId, p.technicianId)));
  const was = new Map<string, string>();
  previous.forEach(p => p.stops.forEach(s => was.set(s.ticketId, p.technicianId)));
  const now = new Date().toISOString();
  let changed = false;
  const tickets = lsGet<Ticket[]>(STORAGE_KEYS.TICKETS, []).map(t => {
    const target = want.get(t.ticketId);
    if (target) {
      if (t.assignedTechnicianId === target) return t;
      changed = true;
      return { ...t, assignedTechnicianId: target, assignedTechnicianName: techs.get(target)?.name ?? t.assignedTechnicianName,
        status: t.status === 'Open' ? 'Assigned' : t.status, updatedAt: now };
    }
    // removed from the plan it was in → unassign (only if still assigned to that technician)
    const prevTech = was.get(t.ticketId);
    if (prevTech && t.assignedTechnicianId === prevTech && t.status !== 'Resolved' && t.status !== 'Closed') {
      changed = true;
      return { ...t, assignedTechnicianId: undefined, assignedTechnicianName: undefined,
        status: t.status === 'Assigned' ? 'Open' : t.status, updatedAt: now };
    }
    return t;
  });
  if (changed) saveTickets(tickets);
}

// ─────────────────────────────────────────────────────────────────
// VISIT LOGS  (localStorage + Supabase)
// ─────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toVisitLog = (r: any): VisitLog => ({
  id: r.id,
  ticketId: r.ticket_id,
  technicianId: r.technician_id,
  technicianName: r.technician_name,
  employeeId: r.employee_id,
  centerName: r.center_name,
  vehicleNumber: r.vehicle_number,
  visitDate: r.visit_date,
  checkInTime: r.check_in_time ?? undefined,
  checkOutTime: r.check_out_time ?? undefined,
  outcome: r.outcome,
  notes: r.notes ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const fromVisitLog = (v: VisitLog) => ({
  id: v.id,
  ticket_id: v.ticketId,
  technician_id: v.technicianId,
  technician_name: v.technicianName,
  employee_id: v.employeeId,
  center_name: v.centerName,
  vehicle_number: v.vehicleNumber,
  visit_date: v.visitDate,
  check_in_time: v.checkInTime ?? null,
  check_out_time: v.checkOutTime ?? null,
  outcome: v.outcome,
  notes: v.notes ?? null,
  created_at: v.createdAt,
  updated_at: v.updatedAt,
});

export function getVisitLogs(): VisitLog[] {
  return lsGet<VisitLog[]>(STORAGE_KEYS.VISIT_LOGS, []);
}
export function saveVisitLogs(logs: VisitLog[]): void {
  lsSet(STORAGE_KEYS.VISIT_LOGS, logs);
}
export function upsertVisitLog(input: Omit<VisitLog, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): VisitLog {
  const now = new Date().toISOString();
  const logs = getVisitLogs();
  const existingIdx = input.id ? logs.findIndex(l => l.id === input.id) : -1;
  if (existingIdx >= 0) {
    const updated: VisitLog = { ...logs[existingIdx], ...input, id: logs[existingIdx].id, updatedAt: now };
    logs[existingIdx] = updated;
    saveVisitLogs(logs);
    pushToDb('visit_logs', fromVisitLog(updated), 'id');
    return updated;
  }
  const newLog: VisitLog = {
    id: `vl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  logs.unshift(newLog);
  saveVisitLogs(logs);
  pushToDb('visit_logs', fromVisitLog(newLog), 'id');
  return newLog;
}
export function deleteVisitLog(id: string): void {
  saveVisitLogs(getVisitLogs().filter(l => l.id !== id));
  deleteFromDb('visit_logs', id);
}
export function getVisitLogsForTicket(ticketId: string): VisitLog[] {
  return getVisitLogs().filter(l => l.ticketId === ticketId);
}
export function getVisitLogsForTech(technicianId: string): VisitLog[] {
  return getVisitLogs().filter(l => l.technicianId === technicianId);
}

// ─────────────────────────────────────────────────────────────────
// CLUSTER ROSTER  (manual tech-per-cluster overrides)
// Maps clusterId (number, as string key) → technicianId
// ─────────────────────────────────────────────────────────────────
export function getClusterRoster(): Record<string, string> {
  return lsGet<Record<string, string>>(STORAGE_KEYS.CLUSTER_ROSTER, {});
}
export function saveClusterRoster(roster: Record<string, string>): void {
  lsSet(STORAGE_KEYS.CLUSTER_ROSTER, roster);
  // no notify() — cluster roster changes don't need to re-trigger ticket/center listeners
}

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
  // Also clear in Supabase (keep only real technicians)
  if (isDbEnabled()) {
    const db = supabase!;
    Promise.all([
      db.from('centers').delete().neq('id', ''),
      db.from('tickets').delete().neq('id', ''),
      db.from('attendance').delete().neq('id', ''),
      db.from('import_jobs').delete().neq('id', ''),
    ]).catch(console.error);
  }
  notify();
}

// Export initDb for App.tsx to call
export async function initDb(): Promise<void> {
  await refreshFromDb();
}
