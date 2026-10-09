/**
 * NCR Planner — the "NCR L3 Technician Planner" (hex clusters, spare hubs,
 * roster/tickets/tracker/attendance) running on live database data.
 *
 * The planner UI + algorithm live in ncrPlannerEngine.js (ported from the
 * standalone HTML). This component:
 *   • converts centers / tickets / technicians / attendance from storage
 *     (Supabase-backed) into the planner's data shape,
 *   • pushes fresh data into the planner whenever the database changes,
 *   • persists edits made in the planner back to the database.
 */
import React, { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import './ncrPlanner.css';
import { NCR_PLANNER_MARKUP } from './ncrPlannerMarkup';
import { mountNcrPlanner } from './ncrPlannerEngine.js';
import RAW_VEHICLES from '../../data/ncrVehicles.json';
import {
  getCenters, getTickets, getTechnicians, getAttendance,
  upsertTicket, upsertTechnician, upsertAttendanceRecord,
  subscribeToDataChanges, getSyncState, refreshFromDb,
} from '../../services/storage';
import type { Ticket, AttendanceStatus, TicketStatus } from '../../types';

const today = () => new Date().toISOString().split('T')[0]; // same date convention as the rest of the app
const LOCAL_KEY = () => `fo_ncr_planner_${today()}`;
const norm = (s: string) => (s || '').trim().toLowerCase();

type PlannerStatus = 'assigned' | 'visited' | 'closed';
const toPlannerStatus = (s: TicketStatus): PlannerStatus =>
  s === 'Resolved' || s === 'Closed' ? 'closed' : s === 'In Progress' || s === 'Pending Spares' ? 'visited' : 'assigned';
const fromPlannerStatus: Record<PlannerStatus, TicketStatus> = { assigned: 'Assigned', visited: 'In Progress', closed: 'Resolved' };
const ATT_IN: Record<AttendanceStatus, string> = { Present: 'present', 'Half-Day': 'halfday', Absent: 'absent', 'On Leave': 'absent' };
const ATT_OUT: Record<string, AttendanceStatus> = { present: 'Present', halfday: 'Half-Day', absent: 'Absent' };

// Vehicles per center ("Delhi_SheikhSarai_D (Delhi)" → "delhi_sheikhsarai_d")
const VEHICLES_BY_CENTER = new Map<string, string[]>();
(RAW_VEHICLES as Array<{ center: string; chassisNo: string; contractNo: string }>).forEach(v => {
  const key = norm(v.center.replace(/\s*\([^)]*\)\s*$/, ''));
  if (!VEHICLES_BY_CENTER.has(key)) VEHICLES_BY_CENTER.set(key, []);
  VEHICLES_BY_CENTER.get(key)!.push(v.chassisNo || v.contractNo);
});

/** Build the planner's data from the database copy. */
function buildPlannerData() {
  const T = today();
  const centers = getCenters().filter(c => c.active !== false && Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
  const dcs = centers.map(c => ({ c: c.name, city: c.city, lat: c.latitude, lon: c.longitude, v: VEHICLES_BY_CENTER.get(norm(c.name)) ?? [] }));
  const dcByName = new Map(dcs.map(d => [norm(d.c), d]));

  // Open tickets, plus tickets closed today so they stay on today's plan as ✓
  const relevant = getTickets().filter(t =>
    (t.status !== 'Resolved' && t.status !== 'Closed') || (t.updatedAt || '').startsWith(T));
  let unroutable = 0;
  const ticketStatus: Record<string, PlannerStatus> = {};
  const tickets = relevant.map((t: Ticket) => {
    const dc = dcByName.get(norm(t.centerName));
    if (!dc) unroutable++;
    const opened = (t.createdAt || '').slice(0, 10);
    const ageDays = opened ? Math.max(0, Math.floor((Date.now() - new Date(opened).getTime()) / 86400000)) : 0;
    ticketStatus[t.ticketId] = toPlannerStatus(t.status);
    return {
      ticket: t.ticketId, vehicle: t.vehicleNumber, month_rep: 1,
      center: dc ? dc.c : t.centerName, city: dc?.city ?? '',
      issue: t.issue, category: t.category ?? '', issue_type: t.issueType ?? '',
      breakdown_date: opened, downtime: ageDays, affected_spare: t.affectedSpare ?? '',
      tat_breach: '', penalty_cost: 0, quotation: 0, stm: '', sm: '', bucket: '',
      priority: t.priority,
    };
  });

  const allTechs = getTechnicians().filter(t => t.status === 'Active');
  const located = allTechs.filter(t => Number.isFinite(t.startingLatitude) && Number.isFinite(t.startingLongitude));
  const techs = located
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId))
    .map(t => ({ _id: t.id, employeeId: t.employeeId, name: t.name, zone: t.zone || t.city, homeLat: t.startingLatitude!, homeLon: t.startingLongitude! }));

  const attendance: Record<string, { status: string; timeIn: string; note: string }> = {};
  getAttendance().filter(a => a.date === T).forEach(a => {
    const tech = located.find(t => t.employeeId.toUpperCase() === a.employeeId.toUpperCase());
    if (tech) attendance[tech.id] = { status: ATT_IN[a.status] ?? 'present', timeIn: a.checkInTime || '09:00', note: a.notes || '' };
  });

  return {
    data: { dcs, tickets, techs, attendance, ticketStatus },
    issues: { unroutable, techsWithoutLocation: allTechs.length - located.length, ticketCount: tickets.length },
  };
}

export function PlannerPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{ update: (d: unknown) => void; destroy: () => void } | null>(null);
  const [, setTick] = useState(0);
  const [issues, setIssues] = useState(() => buildPlannerData().issues);
  const sync = getSyncState();

  useEffect(() => {
    const root = rootRef.current!;
    root.innerHTML = NCR_PLANNER_MARKUP;
    const initial = buildPlannerData();
    let lastSig = JSON.stringify(initial.data);
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(LOCAL_KEY()) || 'null'); } catch { /* ignore */ }

    const ticketById = (id: string) => getTickets().find(t => t.ticketId.toUpperCase() === id.toUpperCase());
    const hooks = {
      saveLocal: (state: unknown) => { try { localStorage.setItem(LOCAL_KEY(), JSON.stringify(state)); } catch { /* ignore */ } },
      onTicketStatus: (ticketId: string, st: PlannerStatus) => {
        const t = ticketById(ticketId); if (!t) return;
        upsertTicket({ ticketId: t.ticketId, vehicleNumber: t.vehicleNumber, centerName: t.centerName, status: fromPlannerStatus[st] });
      },
      onReassign: (ticketId: string, tech: { _id: string; name: string } | null) => {
        const t = ticketById(ticketId); if (!t || !tech) return;
        upsertTicket({
          ticketId: t.ticketId, vehicleNumber: t.vehicleNumber, centerName: t.centerName,
          assignedTechnicianId: tech._id, assignedTechnicianName: tech.name,
          ...(t.status === 'Open' ? { status: 'Assigned' as TicketStatus } : {}),
        });
      },
      onApplyAttendance: (rows: Array<{ tech: { employeeId: string; name: string }; status: string; timeIn: string; note: string }>) => {
        rows.forEach(r => upsertAttendanceRecord({
          employeeId: r.tech.employeeId, technicianName: r.tech.name, date: today(),
          status: ATT_OUT[r.status] ?? 'Present',
          checkInTime: r.status === 'absent' ? '' : (r.timeIn || '09:00'),
          notes: r.note || '',
        }));
      },
      onAddTech: ({ name, zone, lat, lon }: { name: string; zone: string; lat: number; lon: number }) => {
        const maxNum = getTechnicians().reduce((m, t) => Math.max(m, parseInt(t.employeeId.replace(/\D/g, ''), 10) || 0), 1100);
        upsertTechnician({ employeeId: `NCR-${maxNum + 1}`, name, zone, startingLatitude: lat, startingLongitude: lon, status: 'Active' });
      },
      onEditTech: (t: { employeeId: string; name: string; zone: string; homeLat: number; homeLon: number }) => {
        upsertTechnician({ employeeId: t.employeeId, name: t.name, zone: t.zone, startingLatitude: t.homeLat, startingLongitude: t.homeLon });
      },
      onRemoveTech: (t: { employeeId: string; name: string }) => {
        upsertTechnician({ employeeId: t.employeeId, name: t.name, status: 'Inactive' });
      },
    };

    engineRef.current = mountNcrPlanner(root, initial.data, hooks, saved);

    // Push fresh database data into the planner (debounced; skipped when nothing changed)
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToDataChanges(() => {
      setTick(n => n + 1);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = buildPlannerData();
        setIssues(next.issues);
        const sig = JSON.stringify(next.data);
        if (sig === lastSig) return;
        lastSig = sig;
        engineRef.current?.update(next.data);
      }, 300);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
      engineRef.current?.destroy();
      engineRef.current = null;
      root.innerHTML = '';
    };
  }, []);

  const dot = sync.saveError ? '#EF4444' : sync.status === 'synced' ? '#10B981' : sync.status === 'error' ? '#EF4444' : sync.status === 'loading' ? '#F59E0B' : '#94A3B8';
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1 text-[11px] bg-white border-b border-slate-200 text-slate-600">
        <span className="w-2 h-2 rounded-full" style={{ background: dot }} />
        <span className="truncate" title={[sync.error, ...(sync.warnings ?? [])].filter(Boolean).join('\n')}>
          {sync.status === 'synced' && `Live from database · updated ${new Date(sync.lastSyncedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          {sync.status === 'loading' && 'Loading from database…'}
          {sync.status === 'error' && `Couldn't load from database — showing cached data · ${sync.error}`}
          {sync.status === 'disabled' && 'No database configured — browser data only'}
        </span>
        {sync.saveError && (
          <span className="text-rose-700 font-semibold truncate" title={sync.saveError}>· {sync.saveError}</span>
        )}
        {issues.unroutable > 0 && (
          <span className="text-amber-700 font-semibold whitespace-nowrap" title="Their center is missing from Centers or has no coordinates">
            · {issues.unroutable} ticket{issues.unroutable > 1 ? 's' : ''} not on map (center has no coordinates)
          </span>
        )}
        {issues.techsWithoutLocation > 0 && (
          <span className="text-amber-700 font-semibold whitespace-nowrap">
            · {issues.techsWithoutLocation} technician{issues.techsWithoutLocation > 1 ? 's' : ''} without home location
          </span>
        )}
        {sync.status !== 'disabled' && (
          <button onClick={() => refreshFromDb()} className="ml-auto font-semibold text-teal-700 hover:underline">Refresh</button>
        )}
      </div>
      <div ref={rootRef} className="ncrp flex-1 min-h-0" />
    </div>
  );
}
